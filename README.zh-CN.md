# UU Remote Web

[English](README.md)

[![CI](https://github.com/iola1999/uurc-web/actions/workflows/ci.yml/badge.svg)](https://github.com/iola1999/uurc-web/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

UU 远程网页主控端。打开浏览器即可连接和控制自己的 UU 远程设备。

## 在线体验

公共实例：[https://uurc.678234.xyz](https://uurc.678234.xyz)

这个入口适合查看界面和体验基本流程。UU Remote Web 会处理短信登录、账号凭证和带鉴权的 UU API 请求，日常使用建议自行部署，并且只在自己控制或完全信任的实例中输入验证码、登录账号或导入凭证。

Cloudflare Worker + Durable Object 是较方便的自部署方式。Worker 负责页面、UU API 转发和信令网关；远控画面、声音与输入仍由浏览器通过 WebRTC 协商。自动路径会优先尝试局域网或 P2P 直连，条件不满足时再使用 UU 中转，Cloudflare 部署不会关闭直连能力。

公开落地页会在前端构建时预渲染，正文直接写入初始 HTML。登录、设备、账号和远控路由继续使用客户端应用外壳，并从搜索索引中排除。

## 功能

- 短信登录
- 账号凭证导入导出
- 设备列表
- 远控画面、声音、输入与剪贴板同步
- 多屏切换、连接诊断与自动重连
- 画面旋转与翻转矫正（只改变本机显示方向，不影响鼠标坐标）
- 客户端指纹预设与服务端路由决策调试信息
- 配套 Chrome 扩展实现浏览器直连信令（机房出口的部署也能保留直连能力）
- 伙伴远程协助与接管控制
- 账号管理
- Node 与 Cloudflare 两套 UU API / 信令网关

## 自行部署

### Cloudflare（推荐）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/iola1999/uurc-web)

支持 Cloudflare Worker + Durable Object，不依赖 Cloudflare Containers。通过上方按钮可以快速创建自己的部署，也可以在本地执行：

```bash
npm ci
npx wrangler login
npm run deploy:cloudflare
```

部署要求、信任边界和直连说明见 [Cloudflare 部署指南](cloudflare/README.zh-CN.md)。

### 浏览器直连信令（扩展）

Cloudflare 部署此前可以建立直连。UU 服务端后来收紧了路由策略：按信令 socket 的出口 IP 决定 `force_relay`，机房出口（Cloudflare Worker）一律强制走 UU 中转，住宅出口仍可直连。

仓库 `extension/` 目录下的 Chrome 扩展可以恢复直连：信令 WebSocket 改由浏览器直接建立，信令出口变成浏览器所在网络。浏览器无法给 WebSocket 握手设置自定义 header，而 UU 信令认证只认握手 header，扩展通过 declarativeNetRequest 会话规则完成注入（只存内存、按标签页隔离、仅命中 UU 信令域名）。网页仍运行在你的部署上，信令和媒体都不经过任何自建主机。

扩展是纯 JavaScript，无需构建。加载步骤：

1. 打开 `chrome://extensions`；
2. 开启右上角「开发者模式」；
3. 点「加载已解压的扩展程序」，选择 `extension/` 目录；
4. 部署在 localhost 之外时，把站点加进 `extension/manifest.json` 的 `content_scripts.matches`，然后重新加载扩展。

网页会自动检测扩展。「信令通道」默认为**自动**：检测到扩展优先浏览器直连，扩展缺失或直连失败时回退部署侧网关；也可在 设置 → 高级设置 → 信令通道 手动选择。连接后在调试信息里确认：「信令路径」显示浏览器直连，「服务端路由」显示 `force_relay=否`。细节见 [extension/README.md](extension/README.md)。

### Docker

在运行 Docker 的电脑上使用 `http://localhost:8787`。其他电脑或手机访问时，需要 HTTPS 和受浏览器信任的证书；请求签名和剪贴板依赖安全上下文。通过局域网 IP 或普通 HTTP 域名访问会出现环境错误。

例如，在同一台主机运行 [Caddy](https://caddyserver.com/docs/automatic-https)，将域名解析到该主机并开放 80/443 端口：

```caddyfile
remote.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

向公网开放前，还需要单独配置访问身份验证。

```bash
docker run -d \
  --name uurc-web \
  -p 8787:8787 \
  iola1999/uurc-web:latest
```

或者：

```bash
curl -O https://raw.githubusercontent.com/iola1999/uurc-web/main/compose.yml
docker compose up -d
```

每个页面实例使用独立的信令会话凭据。刷新会创建新会话，伙伴协助返回验证页并保留设备 ID。网关仅允许连接该会话通过 UU 成功加入房间后获得的令牌及目标地址。浏览器连续两分钟没有访问时，网关关闭信令连接并删除临时授权和事件。公网实例还需要 Cloudflare Access、带身份验证的反向代理或其他访问网关。

前端当前固定使用本地代理传输，因此 Wisp 默认关闭。只有测试可选的 WASM curl 传输时，才需要设置 `ENABLE_WISP=true`。

## 安全

账号登录状态保存在当前浏览器中，UU API 请求会经过你正在使用的部署。共享实例的运营方在技术上可以观察其代理的请求。请优先自行部署，公开日志和截图前移除短信验证码、账号凭证、Token、设备 ID、房间信息和网络地址。

完整说明和私下报告方式见 [安全政策](SECURITY.zh-CN.md)。

远控工具栏提供文字输入窗口，可使用手机软键盘和本地中文输入法。点击发送后提交文字，并保留空格与换行。

## 开发

```bash
npm ci
npm run dev
```

```bash
npm test
npm run build
docker build -t iola1999/uurc-web:local .
```

## 参与贡献

- [贡献指南](CONTRIBUTING.zh-CN.md)
- [社区行为准则](CODE_OF_CONDUCT.md#社区行为准则)
- [安全政策](SECURITY.zh-CN.md)
- [项目审查（2026-09-05）](docs/project-audit-2026-09-05.zh-CN.md)
- [审查修复与验证记录](implementation-notes.md)

## 致谢

Cloudflare 部署架构参考并致谢 [AssppWeb](https://github.com/Lakr233/AssppWeb)，尤其是 Cloudflare 部署入口体验，以及本地网关 / relay 的架构思路。

## 许可证

[MIT](LICENSE)
