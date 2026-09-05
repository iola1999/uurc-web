import { assertLoginState, type LoginState } from "@uurc/shared/authState";
import type { UuResponse, UuTransport } from "@uurc/shared/uuTransport";

import { LocalProxyTransport } from "../transport/localProxyTransport.js";
import { getStoredLoginState } from "./loginStateStore.js";
import { assertAllowedUuApiPath, buildSignedHeaders } from "./signing.js";

const transport = new LocalProxyTransport();

export async function signedUuRequest<TBody = unknown>({
  method,
  path,
  body,
  state = getStoredLoginState() ?? {},
  requireAuth = true,
}: {
  method: string;
  path: string;
  body?: unknown;
  state?: Partial<LoginState>;
  requireAuth?: boolean;
}): Promise<UuResponse<TBody>> {
  assertAllowedUuApiPath(path);
  if (requireAuth) assertLoginState(state);

  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const headers = await buildSignedHeaders({ state, method, pathWithQuery: path, body: bodyText });
  if (bodyText) headers["Content-Type"] = "application/json; charset=utf-8";

  const response = await (transport as UuTransport).request<TBody>({ method, path, body, headers });
  if (response.status === 401 || response.status === 403) throw new Error("登录已失效，请重新登录 UU 账号");
  if (response.status < 200 || response.status >= 300) {
    const detail =
      response.body &&
      typeof response.body === "object" &&
      "msg" in response.body &&
      typeof response.body.msg === "string"
        ? response.body.msg
        : `HTTP ${response.status}`;
    throw new Error(path.includes("/room/join/") ? `服务端拒绝加入房间：${detail}` : `UU 服务请求失败：${detail}`);
  }
  if (!response.body || typeof response.body !== "object" || Array.isArray(response.body)) {
    throw new Error("UU 服务返回的数据格式无效，请稍后重试");
  }
  return {
    status: response.status,
    statusText: response.status === 200 ? "OK" : undefined,
    headers: response.headers,
    body: response.body,
  };
}

export function assertUuSuccess(body: unknown): void {
  if (!body || typeof body !== "object" || !("code" in body) || body.code !== 0) {
    const message =
      body && typeof body === "object" && "msg" in body && typeof body.msg === "string"
        ? body.msg
        : "UU 服务返回的数据无效";
    throw new Error(message);
  }
}
