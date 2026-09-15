import { afterEach, describe, expect, it, vi } from "vitest";

import type { AsyncSignalGatewayBinaryCodec } from "../src/signalGateway/payload.js";
import { SignalSocketEngine, type SignalSocketTransport } from "../src/signalGateway/signalSocket.js";

class FakeTransport implements SignalSocketTransport {
  readonly sent: Array<string | Uint8Array> = [];
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  listenersInstalled = false;
  private messageListener: ((data: unknown) => void) | null = null;
  private closeListener: ((info: { code: number; reason: string }) => void) | null = null;
  private errorListener: (() => void) | null = null;

  send(frame: string | Uint8Array): void {
    this.sent.push(frame);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
  }

  onMessage(listener: (data: unknown) => void): void {
    this.messageListener = listener;
    this.listenersInstalled = true;
  }

  onClose(listener: (info: { code: number; reason: string }) => void): void {
    this.closeListener = listener;
  }

  onError(listener: () => void): void {
    this.errorListener = listener;
  }

  dispatchMessage(data: unknown): void {
    this.messageListener?.(data);
  }

  dispatchClose(code = 1006, reason = "transport lost"): void {
    this.closeListener?.({ code, reason });
  }

  dispatchError(): void {
    this.errorListener?.();
  }
}

const testCodec: AsyncSignalGatewayBinaryCodec<Uint8Array> = {
  decodeBase64: (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0)),
  toBinary: (value) => (value instanceof Uint8Array ? value : null),
  byteLength: (value) => value.byteLength,
  encodeBase64: (value) => btoa(String.fromCharCode(...value)),
  gzipText: async (value) => new TextEncoder().encode(value),
  gunzipText: async () => null,
};

interface SocketHarness {
  engine: SignalSocketEngine;
  transport: FakeTransport;
  events: Array<{ event: string; payload: unknown }>;
  onClose: ReturnType<typeof vi.fn<(reason: string) => void>>;
  onError: ReturnType<typeof vi.fn<(reason: string) => void>>;
}

describe("SignalSocketEngine", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("closes a half-open connection after the advertised heartbeat deadline", async () => {
    const harness = await connectHarness();
    vi.useFakeTimers();
    harness.transport.dispatchMessage('0{"sid":"engine-1","pingInterval":1000,"pingTimeout":1000}');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1500);
    harness.transport.dispatchMessage("2");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(harness.engine.connected).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(harness.engine.connected).toBe(false);
    expect(harness.onClose).toHaveBeenCalledWith("signal heartbeat timed out");
  });

  it.each(["45" + '11-["synthetic"]', '42["synthetic","' + "x".repeat(1024 * 1024) + '"]'])(
    "rejects excessive attachments or oversized frames",
    async (frame) => {
      const harness = await connectHarness();
      harness.transport.dispatchMessage(frame);
      await vi.waitFor(() => expect(harness.onError).toHaveBeenCalledOnce());
      expect(harness.engine.connected).toBe(false);
    },
  );

  it.each([
    ["Socket.IO", "41"],
    ["Engine.IO", "1"],
  ])("treats a remote %s disconnect packet as a closed connection", async (_protocol, frame) => {
    const harness = await connectHarness();

    harness.transport.dispatchMessage(frame);

    await vi.waitFor(() => expect(harness.onClose).toHaveBeenCalledOnce());
    expect(harness.engine.connected).toBe(false);
    expect(harness.onError).not.toHaveBeenCalled();
    expect(harness.transport.closeCalls).toHaveLength(1);
  });

  it("preserves message order while an earlier binary frame is decoded asynchronously", async () => {
    const harness = await connectHarness();
    const bytes = deferred<ArrayBuffer>();
    class DeferredBlob extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> {
        return bytes.promise;
      }
    }

    harness.transport.dispatchMessage(new DeferredBlob());
    harness.transport.dispatchMessage('42["after_binary",{"sequence":2}]');
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.events).toEqual([]);
    bytes.resolve(new Uint8Array([4, 8, 1]).buffer);
    await vi.waitFor(() => expect(harness.events).toHaveLength(2));
    expect(harness.events.map((event) => event.event)).toEqual(["binary", "after_binary"]);
  });

  it("reports an invalid frame, closes the socket and keeps the queue rejection handled", async () => {
    const harness = await connectHarness();

    harness.transport.dispatchMessage("4invalid-socket-io-packet");

    await vi.waitFor(() => expect(harness.onError).toHaveBeenCalledOnce());
    expect(harness.onError).toHaveBeenCalledWith(expect.stringContaining("invalid socket.io packet type"));
    expect(harness.engine.connected).toBe(false);
    expect(harness.transport.closeCalls).toHaveLength(1);
  });

  it("rejects pending acknowledgements immediately when closed", async () => {
    const harness = await connectHarness();
    const pendingAck = harness.engine.emitWithAck("control", { value: true }, 10_000);

    harness.engine.close();

    await expect(pendingAck).rejects.toThrow("signal socket closed before control ack");
  });
});

async function connectHarness(): Promise<SocketHarness> {
  const transport = new FakeTransport();
  const events: SocketHarness["events"] = [];
  const onClose = vi.fn<(reason: string) => void>();
  const onError = vi.fn<(reason: string) => void>();
  const engine = new SignalSocketEngine({
    callbacks: {
      onEvent: (event) => events.push({ event: event.event, payload: event.payload }),
      onClose,
      onError,
    },
    codec: testCodec,
    openTransport: async () => transport,
  });

  const connecting = engine.connect("wss://signal.example", {}, 1_000);
  await vi.waitFor(() => expect(transport.listenersInstalled).toBe(true));
  transport.dispatchMessage('0{"sid":"engine-1"}');
  await vi.waitFor(() => expect(transport.sent).toContain("40"));
  transport.dispatchMessage('40{"sid":"socket-1"}');
  await connecting;

  return { engine, transport, events, onClose, onError };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
