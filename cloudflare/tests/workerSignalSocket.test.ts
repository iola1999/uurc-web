import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkerSignalSocket } from "../src/signal/workerSignalSocket.js";

type SocketEventType = "message" | "close" | "error";

class FakeWebSocket {
  binaryType = "blob";
  accepted = false;
  readonly sent: Array<string | Uint8Array> = [];
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  private readonly listeners = new Map<SocketEventType, Set<(event: never) => void>>();

  accept(): void {
    this.accepted = true;
  }

  send(value: string | Uint8Array): void {
    this.sent.push(value);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
  }

  addEventListener(type: SocketEventType, listener: (event: never) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  dispatchMessage(data: unknown): void {
    this.dispatch("message", { data });
  }

  dispatchClose(code = 1006, reason = "transport lost"): void {
    this.dispatch("close", { code, reason });
  }

  dispatchError(): void {
    this.dispatch("error", {});
  }

  private dispatch(type: SocketEventType, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }
}

interface SocketHarness {
  client: WorkerSignalSocket;
  socket: FakeWebSocket;
  events: Array<{ event: string; payload: unknown }>;
  onClose: ReturnType<typeof vi.fn<(reason: string) => void>>;
  onError: ReturnType<typeof vi.fn<(reason: string) => void>>;
}

describe("WorkerSignalSocket", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("closes a half-open connection after the advertised heartbeat deadline", async () => {
    const harness = await connectHarness();
    vi.useFakeTimers();
    harness.socket.dispatchMessage('0{"sid":"engine-1","pingInterval":1000,"pingTimeout":1000}');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1500);
    harness.socket.dispatchMessage("2");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(harness.client.connected).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(harness.client.connected).toBe(false);
    expect(harness.onClose).toHaveBeenCalledWith("signal heartbeat timed out");
  });

  it.each(["45" + '11-["synthetic"]', '42["synthetic","' + "x".repeat(1024 * 1024) + '"]'])(
    "rejects excessive attachments or oversized frames",
    async (frame) => {
      const harness = await connectHarness();
      harness.socket.dispatchMessage(frame);
      await vi.waitFor(() => expect(harness.onError).toHaveBeenCalledOnce());
      expect(harness.client.connected).toBe(false);
    },
  );

  it.each([
    ["Socket.IO", "41"],
    ["Engine.IO", "1"],
  ])("treats a remote %s disconnect packet as a closed connection", async (_protocol, frame) => {
    const harness = await connectHarness();

    harness.socket.dispatchMessage(frame);

    await vi.waitFor(() => expect(harness.onClose).toHaveBeenCalledOnce());
    expect(harness.client.connected).toBe(false);
    expect(harness.onError).not.toHaveBeenCalled();
    expect(harness.socket.closeCalls).toHaveLength(1);
  });

  it("preserves message order while an earlier binary frame is decoded asynchronously", async () => {
    const harness = await connectHarness();
    const bytes = deferred<ArrayBuffer>();
    class DeferredBlob extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> {
        return bytes.promise;
      }
    }

    harness.socket.dispatchMessage(new DeferredBlob());
    harness.socket.dispatchMessage('42["after_binary",{"sequence":2}]');
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.events).toEqual([]);
    bytes.resolve(new Uint8Array([4, 8, 1]).buffer);
    await vi.waitFor(() => expect(harness.events).toHaveLength(2));
    expect(harness.events.map((event) => event.event)).toEqual(["binary", "after_binary"]);
  });

  it("reports an invalid frame, closes the socket and keeps the queue rejection handled", async () => {
    const harness = await connectHarness();

    harness.socket.dispatchMessage("4invalid-socket-io-packet");

    await vi.waitFor(() => expect(harness.onError).toHaveBeenCalledOnce());
    expect(harness.onError).toHaveBeenCalledWith(expect.stringContaining("invalid socket.io packet type"));
    expect(harness.client.connected).toBe(false);
    expect(harness.socket.closeCalls).toHaveLength(1);
  });

  it("rejects pending acknowledgements immediately when closed", async () => {
    const harness = await connectHarness();
    const pendingAck = harness.client.emitWithAck("control", { value: true }, 10_000);

    harness.client.close();

    await expect(pendingAck).rejects.toThrow("signal socket closed before control ack");
  });
});

async function connectHarness(): Promise<SocketHarness> {
  const socket = new FakeWebSocket();
  const events: SocketHarness["events"] = [];
  const onClose = vi.fn<(reason: string) => void>();
  const onError = vi.fn<(reason: string) => void>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ status: 101, webSocket: socket })),
  );
  const client = new WorkerSignalSocket({
    onEvent: (event) => events.push({ event: event.event, payload: event.payload }),
    onClose,
    onError,
  });

  const connecting = client.connect("wss://signal.example", {}, 1_000);
  await vi.waitFor(() => expect(socket.accepted).toBe(true));
  socket.dispatchMessage('0{"sid":"engine-1"}');
  await vi.waitFor(() => expect(socket.sent).toContain("40"));
  socket.dispatchMessage('40{"sid":"socket-1"}');
  await connecting;

  return { client, socket, events, onClose, onError };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
