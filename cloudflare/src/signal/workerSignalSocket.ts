import {
  SignalSocketEngine,
  type OpenSignalTransportInput,
  type SignalSocketEngineCallbacks,
  type SignalSocketTransport,
} from "@uurc/shared/signalGateway/signalSocket";
import { buildEngineIoWebSocketUrl } from "@uurc/shared/signalGateway/socketIoWire";

import { workerSignalGatewayBinary } from "./workerSignalBinaryCodec.js";

export type WorkerSignalSocketCallbacks = SignalSocketEngineCallbacks;

// Cloudflare Worker 适配层:协议引擎在 @uurc/shared/signalGateway/signalSocket,
// 这里只提供 Workers 的 fetch-upgrade transport 打开方式与日志前缀。
export class WorkerSignalSocket {
  private readonly engine: SignalSocketEngine;

  constructor(callbacks: WorkerSignalSocketCallbacks) {
    this.engine = new SignalSocketEngine({
      callbacks,
      codec: workerSignalGatewayBinary,
      openTransport: openWorkerSignalTransport,
      log: (message) => console.log(`[uurc-do] ${message}`),
    });
  }

  get connectionId(): string | undefined {
    return this.engine.connectionId;
  }

  get connected(): boolean {
    return this.engine.connected;
  }

  async connect(signalServer: string, headers: Record<string, string>, timeoutMs = 10_000): Promise<void> {
    await this.engine.connect(signalServer, headers, timeoutMs);
  }

  emitWithAck(event: string, payload: Record<string, unknown>, ackTimeoutMs: number): Promise<unknown[]> {
    return this.engine.emitWithAck(event, payload, ackTimeoutMs);
  }

  emitWithOptionalAck(event: string, payload: Record<string, unknown>, onAck: (ack: unknown[]) => void): void {
    this.engine.emitWithOptionalAck(event, payload, onAck);
  }

  close(): void {
    this.engine.close();
  }
}

async function openWorkerSignalTransport({
  server,
  headers,
  timeoutMs,
  signal,
}: OpenSignalTransportInput): Promise<SignalSocketTransport> {
  let timedOut = false;
  const inner = new AbortController();
  const onOuterAbort = (): void => inner.abort();
  signal.addEventListener("abort", onOuterAbort);
  const timeout = setTimeout(() => {
    timedOut = true;
    inner.abort();
  }, timeoutMs);
  try {
    const response = await fetch(buildEngineIoWebSocketUrl(server), {
      redirect: "manual",
      headers: { ...headers, Upgrade: "websocket" },
      signal: inner.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error(`signal server redirect is not allowed status=${response.status}`);
    }
    const socket = response.webSocket;
    if (!socket) throw new Error(`server did not accept websocket status=${response.status}`);
    socket.binaryType = "arraybuffer";
    socket.accept();
    return wrapWorkerWebSocket(socket);
  } catch (error) {
    if (timedOut) throw new Error(`signal socket connect timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onOuterAbort);
  }
}

function wrapWorkerWebSocket(socket: WebSocket): SignalSocketTransport {
  return {
    send: (frame) => socket.send(frame),
    close: (code, reason) => socket.close(code, reason),
    onMessage: (listener) =>
      socket.addEventListener("message", (event) => {
        listener(event.data);
      }),
    onClose: (listener) =>
      socket.addEventListener("close", (event) => {
        listener({ code: event.code, reason: event.reason });
      }),
    onError: (listener) => socket.addEventListener("error", () => listener()),
  };
}
