import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";

import type { RemoteSignalGatewayStartRequest } from "@uurc/shared/signalGateway/model";

import { DirectSignalClient, isDomainSignalServer } from "../src/direct/directSignalClient.js";
import { clearExtensionSignalHeaders, setExtensionSignalHeaders } from "../src/direct/extensionBridge.js";

vi.mock("../src/direct/extensionBridge.js", () => ({
  setExtensionSignalHeaders: vi.fn(async () => {}),
  clearExtensionSignalHeaders: vi.fn(async () => {}),
}));

type Listener = (event: never) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  binaryType = "blob";
  readonly url: string;
  readonly sent: Array<string | Uint8Array> = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  static last(): FakeWebSocket {
    const instance = FakeWebSocket.instances.at(-1);
    if (!instance) throw new Error("no websocket instance was created");
    return instance;
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(frame: string | Uint8Array): void {
    this.sent.push(frame);
  }

  close(code?: number, reason?: string): void {
    this.dispatch("close", { code: code ?? 1000, reason: reason ?? "" });
  }

  // 测试驱动
  open(): void {
    this.dispatch("open", {});
  }

  dispatchMessage(data: unknown): void {
    this.dispatch("message", { data });
  }

  dispatchError(): void {
    this.dispatch("error", {});
  }

  dispatchClose(code = 1006, reason = "network"): void {
    this.dispatch("close", { code, reason });
  }

  private dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }
}

const ROOM_CONFIG = {
  token: "synthetic-room-token",
  signalServers: ["wss://sig-a.example/", "wss://sig-b.example/"],
};

function startRequest(overrides: Partial<RemoteSignalGatewayStartRequest> = {}): RemoteSignalGatewayStartRequest {
  return { roomConfig: { ...ROOM_CONFIG }, gzipSdp: true, ...overrides };
}

// openTransport resolve 后引擎在微任务里安装监听器,派发帧前先冲刷一轮事件循环
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function connectClient(client: DirectSignalClient, request = startRequest()) {
  const started = client.start(request);
  await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  const socket = FakeWebSocket.last();
  socket.open();
  await flushMicrotasks();
  socket.dispatchMessage('0{"sid":"engine-1","pingInterval":25000,"pingTimeout":20000}');
  await vi.waitFor(() => expect(socket.sent).toContain("40"));
  socket.dispatchMessage('40{"sid":"socket-1"}');
  const status = await started;
  return { socket, status };
}

describe("DirectSignalClient", () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    // jsdom 的 Blob 缺 stream();Node 原生 Blob 与 Chrome 行为一致,gzip 编解码依赖它
    if (typeof new Blob(["x"]).stream !== "function") vi.stubGlobal("Blob", NodeBlob);
    vi.mocked(setExtensionSignalHeaders).mockClear();
    vi.mocked(clearExtensionSignalHeaders).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("injects handshake headers through the extension before opening the socket", async () => {
    const client = new DirectSignalClient();
    const { status } = await connectClient(client);

    expect(vi.mocked(setExtensionSignalHeaders)).toHaveBeenCalledOnce();
    const headers = vi.mocked(setExtensionSignalHeaders).mock.calls[0][0];
    expect(headers["X-NRD-AUTH"]).toBe("synthetic-room-token");
    expect(headers["X-NRD-CONTROLLING"]).toBe("0");
    expect(headers.streamer_version).toBe("V4.6.0");
    expect(headers.streamer_flag).toBe('{"sdp_flags":{"gzip_sdp":true}}');
    expect(status.status).toBe("connected");
    expect(status.strategy).toBe("browser_direct_signal");
    expect(status.selectedSignalServer).toBe("wss://sig-a.example/");
    expect(status.connectionId).toBe("socket-1");
    // 状态里的 header 与网关同款脱敏
    expect(status.signalHeaders["X-NRD-AUTH"]).toBe("<redacted room token>");
    await client.stop();
  });

  it("fails over to the next domain server when the first handshake fails", async () => {
    const client = new DirectSignalClient();
    const started = client.start(startRequest());
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0].open();
    await flushMicrotasks();
    FakeWebSocket.instances[0].dispatchError();

    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    const second = FakeWebSocket.instances[1];
    second.open();
    await flushMicrotasks();
    second.dispatchMessage('0{"sid":"engine-2"}');
    await vi.waitFor(() => expect(second.sent).toContain("40"));
    second.dispatchMessage('40{"sid":"socket-2"}');
    const status = await started;

    expect(status.status).toBe("connected");
    expect(status.selectedSignalServer).toBe("wss://sig-b.example/");
    await client.stop();
  });

  it("refuses raw-IP-only signal lists and reports an error status", async () => {
    const client = new DirectSignalClient();
    const status = await client.start(
      startRequest({ roomConfig: { token: "synthetic-room-token", signalServers: ["wss://203.0.113.9/"] } }),
    );

    expect(status.status).toBe("error");
    expect(status.error).toContain("raw IP");
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(clearExtensionSignalHeaders).toHaveBeenCalledOnce();
  });

  it("rejects streamerVersion values that fail the CRLF-injection guard", async () => {
    const client = new DirectSignalClient();
    await expect(client.start(startRequest({ streamerVersion: "V4.6.0\r\nX-Evil: 1" }))).rejects.toThrow(
      /streamerVersion must match/,
    );
  });

  it("returns the gateway-shaped control result envelope and records both directions", async () => {
    const client = new DirectSignalClient();
    const { socket } = await connectClient(client);

    const pending = client.sendControl({
      appControlId: "ac-1",
      appDataBase64: btoa("proto"),
      streamerData: '{"control_id":"ac-1"}',
    });
    await vi.waitFor(() =>
      expect(socket.sent.some((frame) => typeof frame === "string" && frame.startsWith('451-0["control"'))).toBe(true),
    );
    const binaryFrame = socket.sent.find((frame) => frame instanceof Uint8Array);
    expect(binaryFrame?.[0]).toBe(0x04);

    socket.dispatchMessage(
      '430["success",{"code":0,"client_id":"ctl-1","ice_id":"ice-1","force_relay":false,"relay_ins_type":2,' +
        '"iceServers":[{"urls":"stun:203.0.113.9:3478"}],"publisher_city":"Hangzhou","subscriber_city":"Hangzhou"}]',
    );
    const result = await pending;

    expect(result.ackStatus).toBe("success");
    expect(result.control.result?.forceRelay).toBe(false);
    expect(result.control.result?.iceServers).toHaveLength(1);
    expect(client.getEvents().map((event) => `${event.direction}:${event.event}`)).toEqual([
      "outbound:control",
      "inbound:control:ack",
    ]);
    expect(client.getEvents()[0].id).toBe(1);
    expect(client.getEvents(1)).toHaveLength(1);
    await client.stop();
  });

  it("emits soac offers with gzipped SDP as a binary attachment", async () => {
    const client = new DirectSignalClient();
    const { socket } = await connectClient(client);

    const result = await client.sendSoac({
      type: "offer",
      clientId: "ctl-1",
      iceId: "ice-1",
      appControlId: "ac-1",
      sdp: "v=0\r\no=- 0 0 IN IP4 203.0.113.5\r\n",
      gzipSdp: true,
    });

    expect(result?.event).toBe("soac");
    await vi.waitFor(() =>
      expect(socket.sent.some((frame) => typeof frame === "string" && frame.startsWith('451-0["soac"'))).toBe(true),
    );
    expect(socket.sent.some((frame) => frame instanceof Uint8Array && frame[0] === 0x04)).toBe(true);
    await client.stop();
  });

  it("marks the status closed when the socket drops and surfaces it through diagnostics", async () => {
    const client = new DirectSignalClient();
    await connectClient(client);

    FakeWebSocket.last().dispatchClose(1006, "network");

    await vi.waitFor(() => expect(client.getStatus().status).toBe("closed"));
    expect(client.getStatus().error).toContain("code=1006");
    expect(client.getDiagnostics().gatewayStatus).toBe("closed");
  });

  it("clears extension rules and resets the event log on stop", async () => {
    const client = new DirectSignalClient();
    await connectClient(client);
    client.getEvents();

    const status = await client.stop();

    expect(status.status).toBe("closed");
    expect(status.strategy).toBe("browser_direct_signal");
    expect(clearExtensionSignalHeaders).toHaveBeenCalledOnce();
    expect(client.getEvents()).toEqual([]);
  });

  it("throws gateway-parity errors when sending before a connected socket", async () => {
    const client = new DirectSignalClient();
    await expect(client.sendControl({ appControlId: "ac-1" })).resolves.toBeNull();
    await expect(client.sendSoac({ type: "candidate", candidate: { candidate: "candidate:0" } })).resolves.toBeNull();
  });
});

describe("isDomainSignalServer", () => {
  it.each([
    ["wss://sig-a.example/", true],
    ["wss://sig-dcdn-3207-e.nrd.nie.163.com/", true],
    ["wss://203.0.113.9/", false],
    ["wss://[2001:db8::1]/", false],
    ["not-a-url", false],
  ])("classifies %s", (server, expected) => {
    expect(isDomainSignalServer(server)).toBe(expected);
  });
});
