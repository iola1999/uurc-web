import { describe, expect, it, vi } from "vitest";
import { LocalProxyTransport } from "../src/transport/localProxyTransport.js";

describe("LocalProxyTransport", () => {
  it("normalizes successful JSON responses from the backend proxy", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ status: 200, headers: { "content-type": "application/json" }, body: { ok: true } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const transport = new LocalProxyTransport("/api", fetcher);

    await expect(transport.request({ method: "GET", path: "/api/v1/test" })).resolves.toEqual({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true },
    });

    expect(fetcher).toHaveBeenCalledWith("/api/proxy/uu", {
      body: JSON.stringify({ method: "GET", path: "/api/v1/test" }),
      headers: { "Content-Type": "application/json", "X-UURC-Session": expect.any(String) },
      method: "POST",
      signal: expect.any(AbortSignal),
    });
  });
});
