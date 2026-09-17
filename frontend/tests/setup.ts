import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import { vi } from "vitest";

// findBy*/waitFor 默认只等 1 秒。app 级用例在 CI 上等一次路由切换后的渲染就可能超过这个数，
// 报出来是「找不到某个元素」，看着像断言错，实际是没等到。
configure({ asyncUtilTimeout: 5000 });

// 生产代码对登出/返回设备等危险操作加入了 window.confirm 二次确认；
// jsdom 未实现 confirm，测试默认放行（happy-path）。需要验证“取消”路径时可在用例内覆盖。
if (typeof window !== "undefined") {
  window.confirm = vi.fn(() => true);

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
    writable: true,
  });
}
