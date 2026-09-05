import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDeviceGroups } from "../src/uu/roomApi.js";
import { sendMobileCode } from "../src/uu/accountApi.js";
import { exportStoredLoginState, importStoredLoginState } from "../src/uu/loginStateStore.js";

beforeEach(() =>
  window.localStorage.setItem(
    "uurc.loginState",
    JSON.stringify({ token: "synthetic", userId: "synthetic-user", deviceId: "synthetic-web" }),
  ),
);
afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

it.each([
  [401, { code: 401 }, "登录已失效"],
  [200, { code: 500, msg: "业务请求失败" }, "业务请求失败"],
  [200, "invalid JSON body", "数据格式无效"],
])("reports an invalid device response instead of returning an empty list (%s)", async (status, body, message) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ status, headers: {}, body })),
  );
  await expect(getDeviceGroups()).rejects.toThrow(message);
});

it("does not report SMS success for a malformed successful HTTP response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ status: 200, headers: {}, body: {} })),
  );
  await expect(sendMobileCode({ regionCode: "86", mobile: "13800000000" })).rejects.toThrow("数据无效");
});

it("retains the existing login when an import fails validation", () => {
  expect(() => importStoredLoginState({ userId: "other" })).toThrow("账号凭证缺少");
  expect(exportStoredLoginState().userId).toBe("synthetic-user");
});
