import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { sharedSourceAliases } from "./sharedSourceAliases";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    // app 级用例整棵树渲染，在 GitHub runner 上单个用例要一到五秒（app.remoteLifecycle 17 个
    // 用例合计 28 秒），默认 5 秒的上限几乎没有余量，runner 一慢就超时。放宽只影响判定失败前
    // 等多久，跑得顺的时候耗时不变。
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: {
    alias: sharedSourceAliases,
  },
});
