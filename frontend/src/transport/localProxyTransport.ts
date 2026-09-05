import type { TransportResult, UuRequest, UuTransport } from "@uurc/shared/uuTransport";
import { REMOTE_SESSION_HEADER } from "@uurc/shared/remoteSession";
import { getRemoteSessionId } from "../api/remoteSession.js";
import { readBoundedText } from "@uurc/shared/uuProxy";

export class LocalProxyTransport implements UuTransport {
  constructor(
    private readonly apiBase = "/api",
    private readonly fetcher?: typeof fetch,
  ) {}

  async request<TBody = unknown>(request: UuRequest): Promise<TransportResult<TBody>> {
    const fetcher = this.fetcher ?? fetch;
    const signal = AbortSignal.timeout(35_000);
    const response = await fetcher(`${this.apiBase}/proxy/uu`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [REMOTE_SESSION_HEADER]: getRemoteSessionId() },
      body: JSON.stringify(request),
      signal,
    });
    const text = await readBoundedText(response, signal);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("连接服务返回了无法识别的响应，请重试");
    }
    if (!response.ok) {
      const error = body && typeof body === "object" && "error" in body ? body.error : undefined;
      throw new Error(typeof error === "string" ? error : `连接服务请求失败 (${response.status})`);
    }

    if (isTransportResult<TBody>(body)) {
      return body;
    }

    throw new Error("连接服务返回的数据不完整，请重试");
  }
}

function isTransportResult<TBody>(value: unknown): value is TransportResult<TBody> {
  return Boolean(
    value &&
    typeof value === "object" &&
    "status" in value &&
    typeof value.status === "number" &&
    "headers" in value &&
    "body" in value,
  );
}
