import { io, type Socket } from "socket.io-client";
import { Agent } from "node:https";
import { validateSignalServer } from "@uurc/shared/signalGateway/authorization";
import { SIGNAL_MAX_FRAME_BYTES } from "@uurc/shared/signalGateway/status";
import { lookupPublicSignalAddress } from "./signalTargetLookup.js";

import type {
  SignalGatewayConnectOptions,
  SignalGatewayConnection,
  SignalGatewayConnectionStateUpdate,
  SignalGatewayConnector,
} from "./signalGateway.js";

type SocketIoClientFactory = (signalServer: string, options: Parameters<typeof io>[1]) => Socket;
const signalHttpsAgent = new Agent({ lookup: lookupPublicSignalAddress });

export class SocketIoSignalGatewayConnector implements SignalGatewayConnector {
  constructor(private readonly socketFactory: SocketIoClientFactory = io) {}

  async connect(options: SignalGatewayConnectOptions): Promise<SignalGatewayConnection> {
    validateSignalServer(options.signalServer);
    return new Promise((resolve, reject) => {
      const socket = this.socketFactory(options.signalServer, {
        autoConnect: false,
        extraHeaders: options.headers,
        forceNew: true,
        reconnection: true,
        reconnectionDelay: options.reconnectDelayMs,
        timeout: options.timeoutMs,
        transports: ["websocket"],
        transportOptions: { websocket: { agent: signalHttpsAgent, maxPayload: SIGNAL_MAX_FRAME_BYTES } },
      });
      let settled = false;

      const cleanup = () => {
        socket.off("connect", onConnect);
        socket.off("connect_error", onConnectError);
      };
      const onConnect = () => {
        if (settled) return;
        settled = true;
        cleanup();
        installEngineIoBinaryFrameInterop(socket);
        resolve(new SocketIoSignalGatewayConnection(socket));
      };
      const onConnectError = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.disconnect();
        reject(error);
      };

      const inboundEvents = new Set<string>([...options.inboundEvents, ...Object.values(options.socketEvents)]);
      for (const event of inboundEvents) {
        socket.on(event, (...payload: unknown[]) => options.onSignalEvent(event, payload));
      }
      socket.onAny((event, ...payload: unknown[]) => {
        if (inboundEvents.has(event) || isSocketIoLifecycleEvent(event)) return;
        options.onSignalEvent(event, payload);
      });
      installSocketLifecycleLogging(socket, options.signalServer, options.onConnectionStateChange);
      socket.once("connect", onConnect);
      socket.once("connect_error", onConnectError);
      socket.connect();
    });
  }
}

function isSocketIoLifecycleEvent(event: string): boolean {
  return event === "connect" || event === "connect_error" || event === "disconnect" || event === "disconnecting";
}

class SocketIoSignalGatewayConnection implements SignalGatewayConnection {
  private readonly pendingAckRejectors = new Set<(error: Error) => void>();

  constructor(private readonly socket: Socket) {
    installEngineIoBinaryFrameInterop(this.socket);
    this.socket.on("connect", () => installEngineIoBinaryFrameInterop(this.socket));
    this.socket.on("disconnect", (reason) => {
      this.rejectPendingAcks(
        new Error(`signal socket disconnected before pending ack reason=${formatLifecycleValue(reason)}`),
      );
    });
  }

  get id(): string | undefined {
    return this.socket.id;
  }

  close(): void {
    this.rejectPendingAcks(new Error("signal socket closed before pending ack"));
    this.socket.disconnect();
  }

  async emitWithAck(event: string, payload: Record<string, unknown>, ackTimeoutMs: number): Promise<unknown[]> {
    this.assertConnected();
    installEngineIoBinaryFrameInterop(this.socket);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (complete: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pendingAckRejectors.delete(rejectPending);
        complete();
      };
      const rejectPending = (error: Error) => finish(() => reject(error));
      const timer = setTimeout(
        () => rejectPending(new Error(`signal event ${event} ack timed out after ${ackTimeoutMs}ms`)),
        ackTimeoutMs,
      );
      this.pendingAckRejectors.add(rejectPending);

      try {
        this.socket.emit(event, payload, (...ack: unknown[]) => finish(() => resolve(ack)));
      } catch (error) {
        rejectPending(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async emitWithOptionalAck(
    event: string,
    payload: Record<string, unknown>,
    onAck: (ack: unknown[]) => void,
  ): Promise<void> {
    this.assertConnected();
    installEngineIoBinaryFrameInterop(this.socket);
    this.socket.emit(event, payload, (...ack: unknown[]) => onAck(ack));
  }

  private assertConnected(): void {
    if (!this.socket.connected) throw new Error("signal gateway socket is not connected");
  }

  private rejectPendingAcks(error: Error): void {
    for (const rejectPending of [...this.pendingAckRejectors]) rejectPending(error);
  }
}

const engineIoBinaryFramePrefix = 0x04;
const binarySendPatchSymbol = Symbol("uurc.engineIoBinarySendPatch");
const binaryOnDataPatchSymbol = Symbol("uurc.engineIoBinaryOnDataPatch");

type BinaryFramePatchableFunction = ((data: unknown, ...args: unknown[]) => unknown) & {
  [binarySendPatchSymbol]?: boolean;
  [binaryOnDataPatchSymbol]?: boolean;
};

type BinaryFramePatchableTransport = {
  ws?: { send?: BinaryFramePatchableFunction };
  onData?: BinaryFramePatchableFunction;
};

type SocketWithEngineTransport = Socket & {
  io?: { engine?: { transport?: BinaryFramePatchableTransport } };
};

function installEngineIoBinaryFrameInterop(socket: Socket): void {
  const transport = (socket as SocketWithEngineTransport).io?.engine?.transport;
  if (!transport) return;

  const ws = transport.ws;
  if (ws?.send && !ws.send[binarySendPatchSymbol]) {
    const rawSend = ws.send;
    const patchedSend: BinaryFramePatchableFunction = function patchedEngineIoBinarySend(
      this: typeof ws,
      data: unknown,
      ...args: unknown[]
    ) {
      return rawSend.call(this, ensureEngineIoBinaryFramePrefix(data), ...args);
    };
    patchedSend[binarySendPatchSymbol] = true;
    ws.send = patchedSend;
  }

  if (transport.onData && !transport.onData[binaryOnDataPatchSymbol]) {
    const rawOnData = transport.onData;
    const patchedOnData: BinaryFramePatchableFunction = function patchedEngineIoBinaryOnData(
      this: BinaryFramePatchableTransport,
      data: unknown,
      ...args: unknown[]
    ) {
      return rawOnData.call(this, stripEngineIoBinaryFramePrefix(data), ...args);
    };
    patchedOnData[binaryOnDataPatchSymbol] = true;
    transport.onData = patchedOnData;
  }
}

function ensureEngineIoBinaryFramePrefix(value: unknown): unknown {
  const buffer = toBinaryFrameBuffer(value);
  if (!buffer) return value;
  return Buffer.concat([Buffer.from([engineIoBinaryFramePrefix]), buffer]);
}

function stripEngineIoBinaryFramePrefix(value: unknown): unknown {
  const buffer = toBinaryFrameBuffer(value);
  if (!buffer || buffer[0] !== engineIoBinaryFramePrefix) return value;
  return buffer.subarray(1);
}

function toBinaryFrameBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function installSocketLifecycleLogging(
  socket: Socket,
  signalServer: string,
  onConnectionStateChange?: (update: SignalGatewayConnectionStateUpdate) => void,
): void {
  let hasConnected = false;
  socket.on("connect", () => {
    hasConnected = true;
    console.log(`signal socket connect server=${signalServer} id=${socket.id ?? "<no id>"}`);
    onConnectionStateChange?.({ status: "connected", connectionId: socket.id });
  });
  socket.on("disconnect", (reason: unknown, description: unknown) => {
    const parts = [`reason=${formatLifecycleValue(reason)}`];
    if (description !== undefined) parts.push(`description=${formatLifecycleValue(description)}`);
    console.log(`signal socket disconnect server=${signalServer} ${parts.join(" ")}`);
    if (hasConnected) {
      onConnectionStateChange?.({ status: socket.active ? "connecting" : "closed", reason: parts.join(" ") });
    }
  });
  socket.on("connect_error", (error: unknown) => {
    console.log(`signal socket connect_error server=${signalServer} ${formatLifecycleValue(error)}`);
    if (hasConnected) {
      onConnectionStateChange?.({
        status: socket.active ? "connecting" : "error",
        reason: formatLifecycleValue(error),
      });
    }
  });
  const manager = (socket as Socket & { io?: unknown }).io;
  if (!manager || typeof manager !== "object" || !("on" in manager) || typeof manager.on !== "function") return;

  const on = (manager as { on: (event: string, listener: (...args: unknown[]) => void) => void }).on.bind(manager);
  on("reconnect_attempt", (attempt) => {
    console.log(`signal manager reconnect_attempt server=${signalServer} attempt=${formatLifecycleValue(attempt)}`);
  });
  on("reconnect", (attempt) => {
    console.log(`signal manager reconnect server=${signalServer} attempt=${formatLifecycleValue(attempt)}`);
  });
  on("reconnect_error", (error) => {
    console.log(`signal manager reconnect_error server=${signalServer} ${formatLifecycleValue(error)}`);
  });
  on("reconnect_failed", () => {
    console.log(`signal manager reconnect_failed server=${signalServer}`);
    if (hasConnected) onConnectionStateChange?.({ status: "error", reason: "signal socket reconnect failed" });
  });
}

function formatLifecycleValue(value: unknown): string {
  if (value === undefined) return "<undefined>";
  if (value === null) return "<null>";
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
