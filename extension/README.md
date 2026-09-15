# UURC Direct Signal 扩展

让浏览器直连 UU 信令服务器的配套扩展。

## 背景

UU 服务端按信令 socket 的出口 IP 做路由决策:Cloudflare/机房出口会在 `control` ack 里强制 `force_relay=true`(媒体走 UU 中转),住宅出口则允许 WebRTC 直连。网页部署在 Cloudflare 时,信令经 Worker 转发,出口是数据中心 IP,因此拿不到直连。

浏览器 WebSocket API 设置不了自定义握手 header,而 UU 信令认证只认握手 header(`X-NRD-AUTH` / `X-NRD-CONTROLLING` / `streamer_version` / `streamer_flag`)。本扩展用 `declarativeNetRequest` 会话规则给信令域名的 websocket 握手注入这些 header,网页即可从浏览器直接打开信令连接——信令出口变成浏览器所在网络,服务端恢复直连判定,且信令流量不经过任何自建主机。

## 加载步骤

扩展是纯 JS,无需构建:

1. 打开 `chrome://extensions`;
2. 开启右上角「开发者模式」;
3. 点「加载已解压的扩展程序」,选择本目录(`extension/`);
4. 打开网页应用,设置抽屉的「信令通道」会自动检测到扩展(检测不到时见下节)。

## 部署域名配置

`manifest.json` 的 `content_scripts.matches` 决定扩展在哪些站点生效,默认包含:

- `http://localhost/*`、`http://127.0.0.1/*`(本地开发,任意端口)
- `https://uurc.678234.xyz/*`

自部署到其他域名时,把自己的站点加进 `matches` 后在 `chrome://extensions` 点扩展的「重新加载」。域名不匹配的表现是网页提示未检测到扩展。

## 工作方式与隐私

- 网页把本次会话的信令 header 字典发给扩展,扩展校验 header 名白名单(仅上述 4 个)与 ASCII 取值后,写成**会话规则**:只存内存、浏览器关闭即消失,房间 token 不落盘。
- 规则按标签页隔离(`condition.tabIds`),多标签同时连接互不影响;标签页关闭自动清理规则。
- 规则只命中 `*.nrd.nie.163.com/socket.io/` 的 websocket 握手请求,header 不会发给其他任何站点。
- 信令列表里的裸 IP 入口(如 `wss://42.186.98.140/`)不在扩展授权范围内,浏览器直连只使用域名入口;域名入口全部失败时网页会回退到部署侧网关。

## 与网页的配合

网页端「信令通道」设置(设置抽屉 → 高级设置):

- **自动**(默认):检测到扩展优先直连,直连失败回退部署侧网关;
- **连接服务网关**:维持原路径,信令经部署侧转发;
- **浏览器直连**:只走直连,失败时直接报错(用于排查)。

连接后可在诊断面板确认:「信令路径」显示 `browser_direct_signal`,「服务端路由」显示 `force_relay=否` 即直连生效。
