import { STREAMER_CONTROL_EVENT_ACK_TIMEOUT_MS } from "@uurc/shared/streamer/signalSession";
import { normalizeSignalGatewayInboundEventsAsync } from "@uurc/shared/signalGateway/events";
import { normalizeSignalGatewayPayload } from "@uurc/shared/signalGateway/payload";
import type { RemoteSignalGatewayEvent } from "@uurc/shared/signalGateway/model";
import { SIGNAL_MAX_FRAME_BYTES } from "@uurc/shared/signalGateway/status";

import {
  ENGINE_IO_CLOSE,
  ENGINE_IO_MESSAGE,
  ENGINE_IO_OPEN,
  ENGINE_IO_PING,
  ENGINE_IO_PONG,
  SOCKET_IO_NAMESPACE,
  buildEngineIoWebSocketUrl,
  deconstructBinary,
  encodeSocketIoPacket,
  parseEngineOpenPacket,
  parseSocketIoPacket,
  prefixEngineIoBinaryFrame,
  reconstructBinaryPlaceholders,
  stripEngineIoBinaryFramePrefix,
  type SocketIoPacket,
} from "./socketIoWire.js";
import { toWebSocketBytes, workerSignalGatewayBinary } from "./workerSignalBinaryCodec.js";

type JsonRecord = Record<string, unknown>;

interface PendingAck {
  event: string;
  timeout: ReturnType<typeof setTimeout>;
  resolve(ack: unknown[]): void;
  reject(error: Error): void;
}

interface PendingBinaryPacket {
  packet: SocketIoPacket;
  buffers: Uint8Array[];
}

interface WorkerSignalSocketCallbacks {
  onEvent(event: Omit<RemoteSignalGatewayEvent, "id" | "receivedAt">): void;
  onClose(reason: string): void;
  onError(reason: string): void;
}

interface HandshakeCallbacks {
  onConnected(): void;
  onConnectError(error: Error): void;
}

export class WorkerSignalSocket {
  private socket: WebSocket | null = null;
  private connectAbortController: AbortController | null = null;
  private handshakeCallbacks: HandshakeCallbacks | null = null;
  private messageQueue: Promise<void> = Promise.resolve();
  private queuedBytes = 0;
  private nextAckId = 0;
  private pendingAcks = new Map<number, PendingAck>();
  private pendingBinaryPacket: PendingBinaryPacket | null = null;
  private namespaceConnected = false;
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimeoutMs = 45_000;

  connectionId: string | undefined;

  constructor(private readonly callbacks: WorkerSignalSocketCallbacks) {}

  get connected(): boolean {
    return this.socket !== null && this.namespaceConnected;
  }

  async connect(signalServer: string, headers: Record<string, string>, timeoutMs = 10_000): Promise<void> {
    if (this.socket || this.connectAbortController) throw new Error("signal socket is already connecting or connected");

    const controller = new AbortController();
    this.connectAbortController = controller;
    let socket: WebSocket | null = null;
    try {
      socket = await openSignalWebSocket(signalServer, headers, controller, timeoutMs);
      if (controller !== this.connectAbortController || controller.signal.aborted) {
        closeWebSocket(socket, "gateway superseded");
        throw new Error("signal gateway start was superseded");
      }

      this.socket = socket;
      this.messageQueue = Promise.resolve();
      this.installSocketListeners(socket);
      await this.completeHandshake(socket, timeoutMs);
      if (socket !== this.socket || !this.namespaceConnected) {
        throw new Error("signal gateway start was superseded");
      }
    } catch (error) {
      if (socket && socket === this.socket)
        this.releaseSocket(socket, "signal socket connect failed", "connect failed");
      throw error;
    } finally {
      if (this.connectAbortController === controller) this.connectAbortController = null;
    }
  }

  emitWithAck(event: string, payload: JsonRecord, ackTimeoutMs: number): Promise<unknown[]> {
    const ackId = this.emitSocketEvent(event, payload);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAcks.delete(ackId);
        reject(new Error(`signal event ${event} ack timed out after ${ackTimeoutMs}ms`));
      }, ackTimeoutMs);
      this.pendingAcks.set(ackId, { event, timeout, resolve, reject });
    });
  }

  emitWithOptionalAck(event: string, payload: JsonRecord, onAck: (ack: unknown[]) => void): void {
    const ackId = this.emitSocketEvent(event, payload);
    const timeout = setTimeout(() => this.pendingAcks.delete(ackId), STREAMER_CONTROL_EVENT_ACK_TIMEOUT_MS);
    this.pendingAcks.set(ackId, {
      event,
      timeout,
      resolve: onAck,
      reject: () => {},
    });
  }

  close(): void {
    this.cancelPendingConnect();
    this.rejectHandshake(new Error("signal gateway start was superseded"));
    const socket = this.socket;
    const wasConnected = this.namespaceConnected;
    if (!socket) {
      this.resetProtocolState();
      this.rejectPendingAcks("signal socket closed");
      return;
    }

    this.releaseSocket(socket, "signal socket closed", "gateway stopped", false);
    try {
      if (wasConnected) socket.send(`${ENGINE_IO_MESSAGE}${ENGINE_IO_CLOSE}`);
    } catch {
      // The transport may already have closed before the disconnect packet is sent.
    }
    closeWebSocket(socket, "gateway stopped");
  }

  private async completeHandshake(socket: WebSocket, timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (complete: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (this.handshakeCallbacks === callbacks) this.handshakeCallbacks = null;
        complete();
      };
      const callbacks: HandshakeCallbacks = {
        onConnected: () => finish(resolve),
        onConnectError: (error) => finish(() => reject(error)),
      };
      this.handshakeCallbacks = callbacks;
      const timeout = setTimeout(
        () => callbacks.onConnectError(new Error(`signal socket connect timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      if (socket !== this.socket) callbacks.onConnectError(new Error("signal gateway start was superseded"));
    });
  }

  private installSocketListeners(socket: WebSocket): void {
    socket.addEventListener("message", (event) => this.enqueueSocketMessage(socket, event.data));
    socket.addEventListener("close", (event) => {
      this.handleRemoteDisconnect(
        socket,
        `signal socket closed code=${event.code} reason=${event.reason}`,
        `signal socket closed before pending ack code=${event.code} reason=${event.reason}`,
      );
    });
    socket.addEventListener("error", () => {
      this.handleSocketError(socket, "signal socket error");
    });
  }

  private enqueueSocketMessage(socket: WebSocket, value: unknown): void {
    const byteLength =
      typeof value === "string"
        ? new TextEncoder().encode(value).byteLength
        : value instanceof Blob
          ? value.size
          : value instanceof ArrayBuffer || ArrayBuffer.isView(value)
            ? value.byteLength
            : 0;
    if (byteLength > SIGNAL_MAX_FRAME_BYTES || this.queuedBytes + byteLength > 4 * SIGNAL_MAX_FRAME_BYTES) {
      this.handleSocketError(socket, "signal message size limit exceeded");
      return;
    }
    this.queuedBytes += byteLength;
    this.messageQueue = this.messageQueue
      .then(async () => {
        if (socket !== this.socket) return;
        await this.handleSocketMessage(socket, value);
      })
      .catch((error) => {
        if (socket !== this.socket) return;
        this.handleSocketError(socket, `invalid signal socket frame: ${errorMessage(error)}`);
      })
      .finally(() => {
        this.queuedBytes -= byteLength;
      });
  }

  private async handleSocketMessage(socket: WebSocket, value: unknown): Promise<void> {
    if (typeof value === "string") {
      await this.handleTextFrame(socket, value);
      return;
    }
    const bytes = await toWebSocketBytes(value);
    if (socket !== this.socket) return;
    await this.handleBinaryFrame(socket, bytes);
  }

  private async handleTextFrame(socket: WebSocket, frame: string): Promise<void> {
    if (frame.startsWith(ENGINE_IO_OPEN)) {
      const opened = parseEngineOpenPacket(frame.slice(1));
      this.connectionId = opened.sid;
      this.heartbeatTimeoutMs = opened.pingInterval + opened.pingTimeout;
      this.renewHeartbeat(socket);
      this.sendRaw(`${ENGINE_IO_MESSAGE}0`);
      return;
    }
    if (frame === ENGINE_IO_PING) {
      this.renewHeartbeat(socket);
      this.sendRaw(ENGINE_IO_PONG);
      return;
    }
    if (frame === ENGINE_IO_CLOSE) {
      this.handleRemoteDisconnect(socket, "signal socket received Engine.IO close");
      return;
    }
    if (!frame.startsWith(ENGINE_IO_MESSAGE)) return;

    const packet = parseSocketIoPacket(frame.slice(1));
    if (packet.type === 0) {
      const data = asRecord(packet.data);
      this.connectionId = typeof data?.sid === "string" ? data.sid : this.connectionId;
      this.namespaceConnected = true;
      this.handshakeCallbacks?.onConnected();
      return;
    }
    if (packet.type === 1) {
      this.handleRemoteDisconnect(socket, "signal socket received Socket.IO disconnect");
      return;
    }
    if (packet.type === 4) {
      this.handleSocketError(socket, `socket.io connect error: ${safeJson(packet.data)}`);
      return;
    }
    if (packet.attachments > 0) {
      if (this.pendingBinaryPacket) throw new Error("Previous binary packet is incomplete");
      this.pendingBinaryPacket = { packet, buffers: [] };
      return;
    }
    await this.processSocketIoPacket(socket, packet);
  }

  private async handleBinaryFrame(socket: WebSocket, rawBytes: Uint8Array): Promise<void> {
    const bytes = stripEngineIoBinaryFramePrefix(rawBytes);
    const pending = this.pendingBinaryPacket;
    if (!pending) {
      this.callbacks.onEvent({
        direction: "inbound",
        event: "binary",
        payload: normalizeSignalGatewayPayload(bytes, workerSignalGatewayBinary),
      });
      return;
    }

    pending.buffers.push(bytes);
    if (pending.buffers.reduce((total, buffer) => total + buffer.byteLength, 0) > SIGNAL_MAX_FRAME_BYTES)
      throw new Error("Binary packet size limit exceeded");
    if (pending.buffers.length < pending.packet.attachments) return;
    this.pendingBinaryPacket = null;
    await this.processSocketIoPacket(socket, {
      ...pending.packet,
      data: reconstructBinaryPlaceholders(pending.packet.data, pending.buffers),
    });
  }

  private async processSocketIoPacket(socket: WebSocket, packet: SocketIoPacket): Promise<void> {
    if (packet.type === 2 || packet.type === 5) {
      await this.processSocketIoEvent(socket, packet.data);
      return;
    }
    if (packet.type === 3 || packet.type === 6) this.resolveAck(packet);
  }

  private async processSocketIoEvent(socket: WebSocket, data: unknown): Promise<void> {
    if (!Array.isArray(data) || typeof data[0] !== "string") return;
    const event = data[0];
    const payload = data.slice(1);
    const normalizedEvents = await normalizeSignalGatewayInboundEventsAsync(event, payload, workerSignalGatewayBinary);
    if (socket !== this.socket) return;
    for (const normalized of normalizedEvents) {
      console.log(`[uurc-do] inbound ${normalized.event}`);
      this.callbacks.onEvent({
        direction: "inbound",
        event: normalized.event,
        payload: normalizeSignalGatewayPayload(normalized.payload, workerSignalGatewayBinary),
      });
      if (socket !== this.socket) return;
    }
  }

  private resolveAck(packet: SocketIoPacket): void {
    if (packet.id === undefined) return;
    const pending = this.pendingAcks.get(packet.id);
    if (!pending) return;
    this.pendingAcks.delete(packet.id);
    clearTimeout(pending.timeout);
    pending.resolve(Array.isArray(packet.data) ? packet.data : [packet.data]);
  }

  private emitSocketEvent(event: string, payload: JsonRecord): number {
    if (!this.connected) throw new Error("signal gateway socket is not connected");
    const ackId = this.nextAckId++;
    const deconstructed = deconstructBinary([event, payload]);
    const encoded = encodeSocketIoPacket({
      type: deconstructed.buffers.length > 0 ? 5 : 2,
      namespace: SOCKET_IO_NAMESPACE,
      attachments: deconstructed.buffers.length,
      id: ackId,
      data: deconstructed.data,
    });
    this.sendRaw(`${ENGINE_IO_MESSAGE}${encoded}`);
    for (const buffer of deconstructed.buffers) this.sendRaw(prefixEngineIoBinaryFrame(buffer));
    return ackId;
  }

  private sendRaw(frame: string | Uint8Array): void {
    this.socket?.send(frame);
  }

  private handleRemoteDisconnect(socket: WebSocket, reason: string, pendingAckReason = reason): void {
    if (socket !== this.socket) return;
    console.log(`[uurc-do] upstream socket close reason=${reason}`);
    const wasConnecting = this.rejectHandshake(new Error(reason));
    this.releaseSocket(socket, pendingAckReason, "remote disconnect");
    if (!wasConnecting) this.callbacks.onClose(reason);
  }

  private handleSocketError(socket: WebSocket, reason: string): void {
    if (socket !== this.socket) return;
    console.log(`[uurc-do] upstream socket error reason=${reason}`);
    const wasConnecting = this.rejectHandshake(new Error(reason));
    this.releaseSocket(socket, reason, "protocol error");
    if (!wasConnecting) this.callbacks.onError(reason);
  }

  private releaseSocket(socket: WebSocket, pendingAckReason: string, closeReason: string, close = true): void {
    if (socket !== this.socket) return;
    this.cancelPendingConnect();
    this.socket = null;
    this.messageQueue = Promise.resolve();
    this.resetProtocolState();
    this.rejectPendingAcks(pendingAckReason);
    if (close) closeWebSocket(socket, closeReason);
  }

  private cancelPendingConnect(): void {
    const controller = this.connectAbortController;
    this.connectAbortController = null;
    controller?.abort();
  }

  private rejectHandshake(error: Error): boolean {
    const callbacks = this.handshakeCallbacks;
    if (!callbacks) return false;
    callbacks.onConnectError(error);
    return true;
  }

  private resetProtocolState(): void {
    if (this.heartbeatTimer !== undefined) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    this.connectionId = undefined;
    this.namespaceConnected = false;
    this.pendingBinaryPacket = null;
    this.nextAckId = 0;
  }

  private renewHeartbeat(socket: WebSocket): void {
    if (this.heartbeatTimer !== undefined) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(
      () => this.handleRemoteDisconnect(socket, "signal heartbeat timed out"),
      this.heartbeatTimeoutMs,
    );
  }

  private rejectPendingAcks(message: string): void {
    const pendingAcks = [...this.pendingAcks.values()];
    this.pendingAcks.clear();
    for (const pending of pendingAcks) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message.includes("pending ack") ? message : `${message} before ${pending.event} ack`));
    }
  }
}

async function openSignalWebSocket(
  signalServer: string,
  headers: Record<string, string>,
  controller: AbortController,
  timeoutMs: number,
): Promise<WebSocket> {
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(buildEngineIoWebSocketUrl(signalServer), {
      redirect: "error",
      headers: { ...headers, Upgrade: "websocket" },
      signal: controller.signal,
    });
    const socket = response.webSocket;
    if (!socket) throw new Error(`server did not accept websocket status=${response.status}`);
    socket.binaryType = "arraybuffer";
    socket.accept();
    return socket;
  } catch (error) {
    if (timedOut) throw new Error(`signal socket connect timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function closeWebSocket(socket: WebSocket, reason: string): void {
  try {
    socket.close(1000, reason);
  } catch {
    // Closing an already terminated upstream socket is harmless.
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
