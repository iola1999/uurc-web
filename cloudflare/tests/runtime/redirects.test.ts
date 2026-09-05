import { env, SELF, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it } from "vitest";
import type { RemoteSignalSession } from "../../src/signalSession.js";
import { WorkerSignalSocket } from "../../src/signal/workerSignalSocket.js";

const sessionId = "synthetic-native-fetch-session-0001";
const sessions = (env as { REMOTE_SIGNAL_SESSION: DurableObjectNamespace<RemoteSignalSession> }).REMOTE_SIGNAL_SESSION;
const redirectStatuses = [301, 302, 303, 307, 308];

afterEach(async () => {
  await sessions.getByName(sessionId).stop();
});

// 出站响应由 Miniflare 提供，保留原生 fetch 对 RequestInit 的校验。
async function joinRoom(deviceId: string): Promise<Response> {
  return SELF.fetch("https://gateway.example/api/proxy/uu", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-UURC-Session": sessionId },
    body: JSON.stringify({ method: "POST", path: `/api/v1/room/join/by_device/${deviceId}`, body: {} }),
  });
}

it("proxies a successful room join using the native Worker fetch", async () => {
  const response = await joinRoom("synthetic-native");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: 200, body: { code: 0 } });
  await runInDurableObject(sessions.getByName(sessionId), async (_instance, state) => {
    expect(await state.storage.get("roomAuthorization")).toMatchObject({ token: "synthetic-native-room" });
  });
});

it.each(redirectStatuses)("rejects an upstream UU %s redirect without following it", async (status) => {
  const response = await joinRoom(`redirect-${status}`);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: `UU API redirect is not allowed status=${status}` });
  await runInDurableObject(sessions.getByName(sessionId), async (_instance, state) => {
    expect(await state.storage.get("roomAuthorization")).toBeUndefined();
  });
});

it.each(redirectStatuses)("rejects a signal handshake %s redirect without following it", async (status) => {
  const client = new WorkerSignalSocket({
    onEvent: () => {},
    onClose: () => {},
    onError: () => {},
  });
  try {
    await expect(client.connect(`wss://signal.example/redirect-${status}`, {}, 1000)).rejects.toThrow(
      `signal server redirect is not allowed status=${status}`,
    );
    expect(client.connected).toBe(false);
  } finally {
    client.close();
  }
});
