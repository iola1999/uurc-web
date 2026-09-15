import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-ts/**",
      "**/node_modules/**",
      ".wrangler/**",
      ".analysis/**",
      "**/*.d.ts",
      "**/*.tsbuildinfo",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 以下划线前缀表示“有意未使用”，按惯例忽略
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // 浏览器侧（React）
    files: ["frontend/src/**/*.{ts,tsx}", "frontend/tests/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Node / Worker 侧
    files: ["backend/**/*.ts", "shared/**/*.ts", "cloudflare/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Chrome 扩展(MV3,纯 JS 无构建)
    files: ["extension/**/*.js"],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
  },
  {
    // 测试放宽
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      // 测试脚手架里偶有未用变量，降级为告警，不阻断
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
  prettier,
);
