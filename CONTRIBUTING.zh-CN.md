# 参与贡献

[English](CONTRIBUTING.md)

欢迎参与 UU Remote Web。提交内容应围绕一个明确问题展开，Issue、测试和代码提交中都不要包含真实的 UU 账号或会话数据。

## 提交 Issue 前

请先搜索已有 Issue。可以稳定复现的问题使用 Bug 表单，功能设想使用 Feature 表单。

漏洞和疑似凭证泄露请发送至 `iola1999@foxmail.com`，相关细节不要发布到公开 Issue。

## 开发环境

需要准备：

- Node.js 22
- npm
- 支持 WebRTC 的现代浏览器

安装依赖并启动开发服务：

```bash
npm ci
npm run dev
```

仓库主要分为四个部分：

- `frontend`：React 页面、浏览器 WebRTC 会话、输入、音频和剪贴板处理
- `backend`：转发 UU API 与 Socket.IO 信令的 Express 网关
- `cloudflare`：Worker 与 Durable Object 网关实现
- `shared`：协议编解码、请求校验、房间模型和共享类型

## 本地检查

开发时可以先运行覆盖本次改动的检查。提交 PR 前建议完成下面这组命令：

```bash
npm run format:check
npm run lint
npm run typecheck -w frontend
npm run typecheck:cloudflare
npm test
npm run build
npm run check:cloudflare
```

Node 网关改动应补充 backend 测试，Worker 信令改动应补充 Cloudflare 测试。浏览器远控行为请放进对应的前端专项测试文件，保持用例职责清楚。

`npm test` 包含 `cloudflare/tests/runtime/` 中的 Worker 运行时测试，使用合成数据在本地检查 HTTP 路由、SQLite、alarm、实例重建和并发启停。

## 提交信息

提交标题使用英文 Conventional Commits 格式：

```text
type(scope): concise imperative summary
```

示例：

```text
fix(input): correct touchpad scroll direction
feat(clipboard): add bidirectional synchronization
docs(deploy): explain Cloudflare connection routing
```

常用类型包括 `feat`、`fix`、`refactor`、`test`、`docs`、`style`、`chore`、`ci` 和 `build`。一条提交信息只概括该提交实际包含的改动。

## Pull Request

- 每个 PR 聚焦一组可以独立审阅的改动。
- 有对应 Issue 时请在描述中关联。
- 行为变化需要新增或更新测试。
- 面向所有用户的说明应同步更新 `README.md` 和 `README.zh-CN.md`。
- 写明已经运行的命令，并解释跳过的检查。
- 不要提交 `node_modules`、构建产物、Wrangler 状态、本地日志或导出的账号凭证。

## 敏感信息

UU Remote Web 会处理登录状态、带鉴权的 UU API 请求、房间配置和远控信令。Issue 和测试夹具请使用虚构数据。

分享日志或截图前，请移除短信验证码、账号凭证 JSON、账号 Token、房间 Token、完整设备 ID、私网地址和私有页面内容。信任边界和私下报告方式见 [SECURITY.zh-CN.md](SECURITY.zh-CN.md)。
