import { isRemoteSessionId } from "@uurc/shared/remoteSession";

let inMemorySessionId = "";

export function getRemoteSessionId(): string {
  if (isRemoteSessionId(inMemorySessionId)) return inMemorySessionId;

  const sessionId = createRemoteSessionId();
  inMemorySessionId = sessionId;
  return sessionId;
}

function createRemoteSessionId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID().replaceAll("-", "");
  }
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("Secure random generation is unavailable; remote control cannot create an isolated session.");
}
