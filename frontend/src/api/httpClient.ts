import { REMOTE_SESSION_HEADER } from "@uurc/shared/remoteSession";

import { getRemoteSessionId } from "./remoteSession.js";
import { readBoundedText } from "@uurc/shared/uuProxy";

export async function requestJson<T>(path: string, init: RequestInit = {}, remoteSession = false): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (remoteSession) headers.set(REMOTE_SESSION_HEADER, getRemoteSessionId());

  const deadline = AbortSignal.timeout(35_000);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  const response = await fetch(path, { ...init, headers, signal });
  const text = await readBoundedText(response, signal);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("服务返回了无法识别的响应，请重试");
  }
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  if (body === null || typeof body !== "object") throw new Error("服务返回的数据不完整，请重试");
  return body as T;
}
