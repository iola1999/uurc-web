# 项目审查修复记录

基于 [2026-09-05 项目审查](docs/project-audit-2026-09-05.zh-CN.md)，按建议顺序处理。26 项问题已完成本地修改与验证；R-03 的资源限制也已实现。R-01 需要真实双屏设备验证，R-02 和 R-04 保留为产品决策。

代码基准为 `811aa76903966758ece5c594c5fd9c1b9f36557a`，本文对应其后的修复。初轮验收使用合成凭证、房间、媒体和设备数据；后续使用用户授权的本地凭证，确认 Worker 可读取真实设备列表。远端占用释放以及不同终端的远控协议兼容性尚未实机验收。本次交付包含代码、测试、文档和本地验证，未部署。

## 进度

- [x] 第一批：SEC-01、SEC-05、SEC-02，出站限制、依赖更新、会话容量。
- [x] 第二批：CON-02、CON-03、CON-05、CON-06、CON-07，连接恢复和协议。
- [x] 第三批：CON-01、CON-04、CON-09、SEC-03、SEC-04，退出、刷新、隔离和保留期限。
- [x] 第四批：AUTH-01、AUTH-02、CON-08、OPS-01，错误处理和部署条件。
- [x] 第五批：UX-01 至 UX-08、OPS-02，操作流程和 Worker 集成验证。
- [x] R-03：增加资源上限，并完成有明确样本大小的本地测试。
- [ ] R-01：双屏设备实机验收。
- [ ] R-02、R-04：产品行为待决策，详见文末。

## 逐项处理结果

以下项目均已完成修改。测试列说明已覆盖的范围，真实设备和浏览器平台限制另列于后文。

| 编号    | 级别 | 当前行为                                                                                                                                                                                    | 主要验证位置                                                                                                                                                                                                                                        |
| ------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-01  | P1   | 网关从固定 UU API 的成功加入结果登记授权，绑定页面会话、令牌和信令地址。两端拒绝不安全协议及非公开字面地址；Node 在实际连接及重连时检查全部 DNS 结果，UU 请求和 Worker 信令握手拒绝重定向。 | [共享授权测试](shared/tests/signalAuthorization.test.ts)、[Node 代理授权](backend/tests/proxyAuthorization.test.ts)、[实际 Socket.IO DNS 检查](backend/tests/signalTargetLookup.test.ts)、[Worker 运行时](cloudflare/tests/runtime/gateway.test.ts) |
| SEC-02  | P2   | 状态、事件及诊断读取不分配保留会话；容量耗尽时拒绝新会话，已有连接继续运行。Node 定时清理超过两分钟无客户端访问的记录。                                                                     | [Node 会话注册表](backend/tests/remoteControlSessionRegistry.test.ts)、[远控路由](backend/tests/remoteRoutes.test.ts)                                                                                                                               |
| SEC-03  | P2   | 会话标识仅存于当前页面内存，带 opener 新建页面使用独立标识；启动时清理旧的会话标识和房间缓存。                                                                                              | [页面会话测试](frontend/tests/remoteSession.test.ts)、浏览器父子页面请求头检查                                                                                                                                                                      |
| SEC-04  | P2   | Worker 使用持久化活动期限和 alarm 清理静置会话，删除授权、事件和内存请求头。只查询状态也清理超期事件；alarm 延迟时，到期后的请求先清理会话。                                                | [真实 SQLite 与 alarm 测试](cloudflare/tests/runtime/gateway.test.ts)                                                                                                                                                                               |
| SEC-05  | P1   | 更新 Socket.IO 解析器、Engine.IO、ws 和路由等相关依赖，锁文件同步更新。生产依赖扫描中的已知漏洞为 0。                                                                                       | 全量测试、构建及 `npm audit --omit=dev`                                                                                                                                                                                                             |
| CON-01  | P2   | SPA 退出控制页关闭浏览器连接、停止网关，并清理 UU 房间或取消协助；手动停止同步清空上下文。新目标加入需等待旧加入请求及清理完成。页面异常退出由两端活动期限处理信令。                        | [页面生命周期](frontend/tests/app.remoteLifecycle.test.tsx)、[延迟加入与目标切换](frontend/tests/remoteRoomLifecycle.test.ts)、Node 定时器及 Worker alarm 测试、浏览器后退请求检查                                                                  |
| CON-02  | P1   | 网关断开后继续状态检查，并进入自动恢复。自有设备在网关失效后重新加入房间；协助授权过期时返回验证页。                                                                                        | [恢复控制器](frontend/tests/useRemoteRecoveryController.test.tsx)、[页面连接流程](frontend/tests/app.remoteLifecycle.test.tsx)、Worker 断线状态测试                                                                                                 |
| CON-03  | P2   | 连续失败次数跨 idle/offered 阶段保留，退避间隔和中转升级可累计；停止房间或稳定接收画面十秒后清零。                                                                                          | [恢复控制器](frontend/tests/useRemoteRecoveryController.test.tsx)                                                                                                                                                                                   |
| CON-04  | P2   | 每次重置和卸载更新请求版本；轮询在写入事件、诊断及统计前检查版本与当前浏览器会话，丢弃迟到结果。                                                                                            | [旧轮询响应测试](frontend/tests/useSignalGatewayController.test.tsx)、浏览器会话恢复测试                                                                                                                                                            |
| CON-05  | P2   | 等待协商及首次媒体分别设置二十秒期限；超时关闭旧 peer，显示失败原因并允许自动恢复。重置和卸载取消定时器。                                                                                   | [协商期限与重置](frontend/tests/useBrowserRemoteSessionController.test.tsx)、[恢复控制器](frontend/tests/useRemoteRecoveryController.test.tsx)                                                                                                      |
| CON-06  | P2   | 自动路由保留未传覆盖值的含义，服务端 `forceRelay=true` 生效；显式中转继续使用 relay。                                                                                                       | [浏览器信令恢复](frontend/tests/browserRemoteSession.signalRecovery.test.ts)、[页面连接流程](frontend/tests/app.remoteLifecycle.test.tsx)                                                                                                           |
| CON-07  | P2   | Worker 校验 Engine.IO 心跳参数，根据间隔与超时维护计时器；收到 ping 续期，超期断开并更新状态。                                                                                              | [Worker 信令 socket](cloudflare/tests/workerSignalSocket.test.ts)                                                                                                                                                                                   |
| CON-08  | P2   | 两端 UU 请求的三十秒期限覆盖正文读取；浏览器请求期限为三十五秒。统一流式读取限制字节数并处理取消。                                                                                          | [正文停顿、分块及 UTF-8](shared/tests/boundedResponse.test.ts)、[前端 transport](frontend/tests/transport.test.ts)                                                                                                                                  |
| CON-09  | P2   | 协助控制页刷新后返回验证页并保留设备 ID；房间缓存绑定页面会话、账号和有效时间。切换设备路由重新建立控制器。                                                                                 | [页面协助流程](frontend/tests/app.remoteAssistance.test.tsx)、[浏览器请求与缓存检查](docs/audit-assets/2026-09-05/fixes/results.json)                                                                                                               |
| AUTH-01 | P2   | 统一校验代理响应、上游 HTTP 状态和业务结果。401/403 显示重新登录提示；失败的设备、短信和释放操作保留错误；等待协助确认使用原有业务分支。                                                    | [异常响应处理](frontend/tests/uuFailureHandling.test.ts)、[transport](frontend/tests/transport.test.ts)、浏览器 401 场景                                                                                                                            |
| AUTH-02 | P2   | JWT payload 校验对象类型，`exp` 校验有限值及日期范围；导入验证成功后才写入。已存入的异常 payload 不会触发启动崩溃。                                                                         | [JWT 摘要](shared/tests/authState.test.ts)、[失败导入保留原账号](frontend/tests/uuFailureHandling.test.ts)、浏览器异常存储启动                                                                                                                      |
| UX-01   | P2   | 接管选择作为本次调用参数直接传入，首次加入请求携带 `force_join: true`。                                                                                                                     | [页面生命周期](frontend/tests/app.remoteLifecycle.test.tsx)、浏览器接管请求检查                                                                                                                                                                     |
| UX-02   | P2   | 工具栏允许触摸横向滚动，拖动手柄单独处理拖拽。窄屏连接状态保持单行。                                                                                                                        | [拖动组件测试](frontend/tests/motionUi.test.tsx)、浏览器 320/390 像素滑动及桌面拖动                                                                                                                                                                 |
| UX-03   | P2   | 搜索框 Enter 执行搜索选项，焦点位于按钮时执行该按钮；输入法组合期间保留 Enter。                                                                                                             | [命令面板](frontend/tests/commandPalette.test.tsx)、浏览器键盘刷新设备列表                                                                                                                                                                          |
| UX-04   | P2   | 弹窗和命令面板共用焦点管理，进入后聚焦内部、Tab 循环、关闭后恢复焦点，背景设为 inert；Esc 优先关闭当前弹窗。                                                                                | [弹窗测试](frontend/tests/motionUi.test.tsx)、浏览器焦点循环及恢复                                                                                                                                                                                  |
| UX-05   | P3   | 接管选项使用可收缩列和换行文字；弹窗限制可用高度，内容可滚动。                                                                                                                              | 桌面接管弹窗及 CSS 200% 缩放截图                                                                                                                                                                                                                    |
| UX-06   | P2   | 远控全屏时 Esc 先退出本地全屏，该按键不发送到远端；存在弹窗时先关闭弹窗。                                                                                                                   | 浏览器全屏状态与远端键盘发送记录                                                                                                                                                                                                                    |
| UX-07   | P2   | 快捷协助遇到验证码要求时进入已填写设备 ID 的验证页；变更目标时清空旧验证码。                                                                                                                | [页面协助流程](frontend/tests/app.remoteAssistance.test.tsx)、浏览器快捷连接检查                                                                                                                                                                    |
| UX-08   | P2   | 工具栏增加文字输入窗口，使用原生 textarea 唤起软键盘或中文输入法，点击发送后通过现有文本协议提交；保留空格和换行。可用状态随目标平台和通道变化。                                            | [桌面与移动文本协议](frontend/tests/browserRemoteSession.input.test.ts)、[剪贴板文本](frontend/tests/browserRemoteSession.clipboard.test.ts)、浏览器输入及发送记录                                                                                  |
| OPS-01  | P2   | 中英文 Docker 文档补充 HTTPS、受信证书及 Caddy 示例；签名遇到非安全上下文时显示明确中文错误。                                                                                               | 普通 HTTP 域名缺少 WebCrypto 的浏览器检查；localhost 正常签名请求                                                                                                                                                                                   |
| OPS-02  | P2   | 增加 Worker 类型检查和实际 Workers/SQLite 运行时测试，纳入根测试命令及 CI。                                                                                                                 | [运行时配置](cloudflare/vitest.runtime.config.ts)、[九项运行时测试](cloudflare/tests/runtime/gateway.test.ts)、Cloudflare dry-run                                                                                                                   |

## 资源限制

R-03 已完成本地实现和有界样本验证。单位均按 1024 计算。

| 资源                    | 当前限制                                                                           | 验证                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 网关请求正文            | 1 MiB                                                                              | Node JSON parser、Worker 流式读取                                                                                            |
| UU 响应及浏览器响应读取 | 4 MiB                                                                              | 共享分块读取及取消测试                                                                                                       |
| WebSocket 单帧          | 两端均为 1 MiB                                                                     | Node `ws.maxPayload` 配置、Worker 接收拒绝测试                                                                               |
| 二进制附件              | 两端最多十个附件；Worker 单组累计 1 MiB，Node 按每帧 1 MiB 限制，单组最多约 10 MiB | 修复后的 Socket.IO parser、Worker 附件计数与累计检查                                                                         |
| SDP 解压输出            | 两端均为 1 MiB；Worker 解压还受十秒期限限制                                        | [Node 资源限制](backend/tests/signalResourceLimits.test.ts)、[Worker 解压](cloudflare/tests/workerSignalBinaryCodec.test.ts) |
| Worker 待处理消息       | 累计 4 MiB                                                                         | [Worker socket 测试](cloudflare/tests/workerSignalSocket.test.ts)                                                            |
| 每会话事件记录          | 约 2 MiB 且最多两百条，超量删除旧记录                                              | Node 事件总量测试、Worker SQLite 总量测试                                                                                    |

测试使用固定上限的压缩内容与消息，未进行耗尽内存的攻击测试。实际设备的合法最大消息尚需抽样确认，尤其是多屏 SDP 和携带多个附件的响应。

## 初轮验收结果

| 检查                            | 结果                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run format:check`          | 成功                                                                                             |
| `npm run lint`                  | 成功                                                                                             |
| `npm run typecheck -w frontend` | 成功                                                                                             |
| `npm run typecheck:cloudflare`  | 成功                                                                                             |
| `npm test`                      | 87 个文件、433 项成功：shared 102、backend 54、frontend 255、Worker 单元测试 13、Worker 运行时 9 |
| `npm run build`                 | shared、Node、前端及预渲染构建成功                                                               |
| `npm run check:cloudflare`      | 成功，仅执行 dry-run                                                                             |
| `npm audit --omit=dev`          | 0 项已知漏洞                                                                                     |
| `git diff --check`              | 成功                                                                                             |

浏览器复核使用本机 Chrome、Playwright 和合成 API/媒体，覆盖桌面 1440×900、移动端 390×844、320×740 与横屏 844×390。桌面和移动端均未记录页面运行异常。完整观测见 [results.json](docs/audit-assets/2026-09-05/fixes/results.json)。

- 接管首次请求为 `force_join: true`；浏览器后退产生停止网关及清理房间请求。
- 弹窗宽度与 scrollWidth 均为 438 像素，常规和 CSS 200% 缩放均未出现按钮越界；焦点进入、循环与关闭恢复检查成功。
- 390/320 像素页面触摸滑动后，工具栏 scrollLeft 分别为 341/317；body 宽度等于视口宽度。桌面拖动手柄后工具栏位置发生变化。
- 全屏 Esc 后本地全屏状态关闭，远端键盘发送记录为空。
- 输入 `  中文输入\n第二行  ` 后，发送内容保留两侧空格与换行。
- 带 opener 新建页面的会话请求头与原页面不同；伙伴协助刷新回到验证页并清除旧房间缓存。
- 401 显示登录失效；异常 JWT 未使页面空白；普通 HTTP 域名显示 HTTPS/localhost 环境提示。

截图：[接管弹窗](docs/audit-assets/2026-09-05/fixes/desktop-occupied.png)、[200% 缩放](docs/audit-assets/2026-09-05/fixes/desktop-dialog-zoom-200.png)、[320 像素控制页](docs/audit-assets/2026-09-05/fixes/mobile-control-320.png)、[横屏控制页](docs/audit-assets/2026-09-05/fixes/mobile-control-844.png)、[移动端文字输入](docs/audit-assets/2026-09-05/fixes/mobile-text-input.png)。

本地体验地址为 `http://127.0.0.1:18877`，通过 Vite 代理到本地 Node 网关。浏览器复核的 API 使用模拟数据；此体验地址使用实际网关，需自行登录后连接设备。

## 复杂度审查

本轮按 `reclaim-code-entropy` 检查了新增模块的实际调用者、状态归属和已删除路径，并查看了相关文件的历史。保留的公共模块都有多个当前调用方：

- `readBoundedText` 供 Node/Worker 代理、前端请求及 Worker 解压共用，统一处理流读取的取消与字节限制。授权模型也由两种网关共同使用。
- `useModalFocus` 供通用弹窗和命令面板使用，集中处理同一套键盘和焦点行为。
- 账号、设备和房间接口共用 `assertUuSuccess`；账号 API 原有局部判断被移除，减少了重复业务判错。
- 页面会话删除 17 行存储恢复代码，内存是会话标识的唯一来源；启动入口仅负责清理旧存储格式。刷新后的行为变化已记录到中英文 README。
- `pendingJoin` 负责等待已发出的加入请求，`pendingRelease` 负责等待网关及 UU 清理。二者处理不同阶段；延迟加入测试验证旧房间完成释放后才加入下一目标。

Node 使用标准 Socket.IO 客户端，Worker 保留适配平台 WebSocket 的协议实现；两种传输有不同运行时约束，继续通过共享模型和两端测试核对行为。`ipaddr.js` 用于成熟的 IP 分类，Workers 测试依赖只用于开发。本轮未加入通用任务队列、可插拔授权系统或新的状态管理库。

## Worker 重定向兼容修复

2026-09-05，用户反馈 `Invalid redirect value`。`cef22282` 中的 UU 代理和信令握手使用 `redirect: "error"`，Cloudflare Workers 只接受 `follow` 和 `manual`，正常出站请求也会立即失败。此前运行时测试替换了全局 `fetch`，未覆盖原生请求参数校验。

两处请求改为 `redirect: "manual"`，遇到 3xx 响应时取消正文并返回明确错误。目标授权和重定向拒绝策略继续生效，Node 使用其运行时支持的原有配置。

新增 [原生 fetch 回归测试](cloudflare/tests/runtime/redirects.test.ts)，由 Miniflare 的 `outboundService` 提供合成响应。十一项用例覆盖正常加入代理，以及 UU 代理和信令握手分别拒绝 301、302、303、307、308。修复前可复现用户提供的错误，修复后全部成功。

另通过本地 Wrangler Worker 使用用户授权的凭证调用只读设备列表接口，收到 HTTP 200、业务码 0，设备数据可正常解析。凭证由本地临时脚本读取，记录仅包含脱敏结果。此项验证未建立真实远控媒体会话。

本次回归中，shared 的 102 项、Node 的 54 项测试均成功。`npm test` 两次运行在前端出现五秒超时或页面元素等待失败，失败用例有变化。相关页面文件单独复跑十项成功；随后用 `npm run test -w frontend -- --maxWorkers=2` 完成全部 255 项前端测试。`npm run test:cloudflare` 的 13 项单元测试、20 项运行时测试全部成功，分项验证共覆盖 88 个文件、444 项用例。前端默认并发下的运行稳定性仍需关注。

格式、lint、前端与 Worker 类型检查、项目构建及 Cloudflare dry-run 均成功。真实设备列表复测使用 `http://127.0.0.1:18878` 上的本地 Worker。

## Deviations

- SEC-01：仓库只有合成信令地址，缺少可核实的生产域名清单。采用网关从固定 UU API 成功响应取得的目标授权，绑定浏览器会话，并限制出站地址。无需部署者维护推测的域名列表。
- SEC-03、CON-09：每个页面实例使用新的会话标识。刷新后自有设备重新加入房间；伙伴协助回到已填写设备 ID 的验证页。这一选择取消了跨页面实例恢复旧信令授权的依赖，伙伴需要重新提供验证码或等待确认。
- CON-01：SPA 导航会关闭浏览器连接、停止网关并请求清理 UU 房间。页面关闭、崩溃或断网时，由服务端两分钟活动期限回收信令；UU 服务端何时解除设备占用仍需真实设备验证。
- R-03：资源限制已在本地实现，Node 附件累计上限遵循现有解析器的十个附件限制，Worker 增加单组 1 MiB 限制。实际设备兼容性仍需抽样确认。

## 实机验证与待决策事项

真实设备列表接口已通过后续复测。短信登录、远控媒体与输入仍需实机验收；发布前需验证 Node 和 Worker 的实际握手、断网恢复、中转升级、页面退出后的远端占用释放，以及后台标签页被浏览器节流后的恢复。HTTPS 正向检查使用 localhost 安全上下文，未部署受信证书域名；移动端使用 Chrome 触摸模拟，尚未在 iOS/Android 实机操作软键盘或使用屏幕阅读器。

| 编号 | 当前处理                                   | 后续需要确认                                                                                                                                 |
| ---- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | 保留现有多屏协议行为                       | 用不同分辨率、缩放和位置的双屏设备检查画面选择、点击四角、文字输入和窗口拖动；确认输入目标与当前画面一致。                                   |
| R-03 | 消息与解压上限已实现                       | 从合法设备采集脱敏的消息大小统计，确认多屏及多附件响应处于上限以内。                                                                         |
| R-02 | 保留现有剪贴板默认设置                     | 建议伙伴协助默认关闭自动同步，首次主动启用后再发送本机文本；自有设备保留现有默认行为。需要决定是否采用此差异，以及是否记住对指定伙伴的授权。 |
| R-04 | 页面会话已独立，账号仍由 localStorage 共享 | 建议退出或切换账号时，其他标签页停止旧连接并同步账号状态。需要决定是否允许旧远控继续，或统一结束所有标签页会话。                             |
