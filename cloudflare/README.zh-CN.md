# Cloudflare 部署

[English](README.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/iola1999/uurc-web)

本部署方式使用 Cloudflare Worker + Durable Object，不依赖 Cloudflare Containers。

项目公共实例为 [https://uurc.678234.xyz](https://uurc.678234.xyz)。这个实例可以用于快速体验；需要登录账号、导入凭证或长期使用时，建议按照本文创建自己的 Worker。

## Cloudflare 运行内容

- 来自 `frontend/dist` 的静态前端，包括预渲染公开落地页和标记为 noindex 的客户端应用外壳
- `/api/proxy/uu` UU API 转发
- `/api/health`
- 基于 Durable Object 的 `/api/remote/signal/*` 状态、事件、诊断和错误回报接口

Worker 版 live signal gateway 已在 Durable Object 内实现，通过 Worker `fetch(..., Upgrade: websocket)` 建立上游 Engine.IO/Socket.IO WebSocket。

## 连接路径与直连

Cloudflare 位于网页、UU API 和信令路径中，远控媒体与输入通道由浏览器通过 WebRTC 建立：

1. 浏览器通过 Worker 转发 UU API 请求并获取房间配置。
2. Durable Object 连接上游 Socket.IO 信令服务，交换控制信息、SDP 和 ICE 候选。
3. 浏览器根据 ICE 结果建立局域网、P2P 或 UU 中转连接。

默认的“自动路径”允许局域网和 P2P 直连。网络条件不满足时，客户端可以回退到 UU 中转；高级设置中的“强制 UU 中转”会主动选择 relay。Worker 不承载 WebRTC 媒体流。需要注意：UU 服务端按信令 socket 的出口 IP 做路由决策，Durable Object 的出口是 Cloudflare 机房地址，当前 UU 策略对机房出口强制中转，仅靠 Cloudflare 部署已拿不到直连。安装配套的[浏览器扩展](../extension/README.md)后，信令 socket 由浏览器直接建立，路由按浏览器所在网络判定，直连能力得以保留。

## 安全

账号状态保存在浏览器中，带鉴权的 UU API 请求仍会经过你的 Worker。自行部署可以把这段代理链路留在自己的 Cloudflare 账号下。

随机会话凭据用于隔离不同浏览器标签页对应的 Durable Object 信令状态。它不负责部署入口鉴权。实例对外开放时，建议配置 Cloudflare Access 或其他访问控制，并确认 Access 规则允许应用所需的 `/api/*` 请求。

请勿在不受信任的实例中输入短信验证码或导入账号凭证。更多说明见 [安全政策](../SECURITY.zh-CN.md)。

## 要求

- Cloudflare Workers 账号，并已启用 Durable Objects。
- 部署/构建 token 需要 `Workers Scripts Edit` 权限。

## 部署

可以点击页面顶部的 Deploy 按钮，也可以从本地仓库部署：

```bash
npm ci
npx wrangler login
npm run deploy:cloudflare
```

本地 Cloudflare runtime 预览：

```bash
npm run dev:cloudflare
```

## 说明

- 配置位于 `wrangler.jsonc`。
- 部署流程会执行 `npm run build:cloudflare`，构建 `shared` 和 `frontend`。
- Worker 负责静态资源、UU API 和信令接口，远控媒体不会经过 Worker。
