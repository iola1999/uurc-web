// 页面通过 content script 转发消息到这里:
// - uurc-set-signal-headers: 把白名单 header 写成 declarativeNetRequest 会话规则,
//   仅命中本标签页发往 UU 信令域名的 websocket 握手请求(浏览器 WebSocket API
//   无法自行设置握手 header,而 UU 信令认证只认握手 header)。
// - uurc-clear-signal-headers: 移除本标签页的规则。
// 会话规则只存内存,浏览器关闭即消失,房间 token 不落盘。

const SIGNAL_URL_FILTER = "||nrd.nie.163.com/socket.io/";
const ALLOWED_HEADERS = new Set(["X-NRD-AUTH", "X-NRD-CONTROLLING", "streamer_version", "streamer_flag"]);
const MAX_HEADER_VALUE_LENGTH = 4096;

/** @type {Map<number, number[]>} tabId -> 规则 id 列表 */
const tabRuleIds = new Map();
let nextRuleId = 1;

// SW 重启后内存映射丢失,但会话规则仍在;启动时从现存规则重建映射,避免规则泄漏。
chrome.declarativeNetRequest
  .getSessionRules()
  .then((rules) => {
    for (const rule of rules) {
      const tabId = rule.condition?.tabIds?.[0];
      if (typeof tabId !== "number") continue;
      const ids = tabRuleIds.get(tabId) ?? [];
      ids.push(rule.id);
      tabRuleIds.set(tabId, ids);
      nextRuleId = Math.max(nextRuleId, rule.id + 1);
    }
  })
  .catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    sendResponse({ ok: false, error: "message must come from a tab" });
    return false;
  }
  if (message.type === "uurc-set-signal-headers") {
    handleSetSignalHeaders(tabId, message.headers)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === "uurc-clear-signal-headers") {
    removeTabRules(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeTabRules(tabId).catch(() => {});
});

async function handleSetSignalHeaders(tabId, headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return { ok: false, error: "headers object required" };
  }
  const requestHeaders = [];
  for (const [name, value] of Object.entries(headers)) {
    if (!ALLOWED_HEADERS.has(name)) return { ok: false, error: `header not allowed: ${name}` };
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > MAX_HEADER_VALUE_LENGTH ||
      /[^\x20-\x7E]/.test(value)
    ) {
      return { ok: false, error: `invalid value for header ${name}` };
    }
    requestHeaders.push({ header: name, operation: "set", value });
  }
  if (!requestHeaders.some((entry) => entry.header === "X-NRD-AUTH")) {
    return { ok: false, error: "X-NRD-AUTH header required" };
  }

  await removeTabRules(tabId);
  const ruleId = nextRuleId++;
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [
      {
        id: ruleId,
        priority: 1,
        action: { type: "modifyHeaders", requestHeaders },
        condition: { urlFilter: SIGNAL_URL_FILTER, resourceTypes: ["websocket"], tabIds: [tabId] },
      },
    ],
  });
  tabRuleIds.set(tabId, [ruleId]);
  return { ok: true, ruleCount: 1 };
}

async function removeTabRules(tabId) {
  const ids = tabRuleIds.get(tabId);
  tabRuleIds.delete(tabId);
  if (!ids || ids.length === 0) return;
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
}
