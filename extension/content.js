// 页面(window.postMessage)与扩展 background 之间的桥。
// 只在 manifest 的 content_scripts.matches 列出的站点注入。
(() => {
  const VERSION = "0.1.0";
  const FORWARDED_TYPES = new Set(["uurc-set-signal-headers", "uurc-clear-signal-headers"]);

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || typeof message !== "object" || typeof message.requestId !== "string") return;

    if (message.type === "uurc-ext-ping") {
      window.postMessage(
        { type: "uurc-ext-ping-result", requestId: message.requestId, ok: true, version: VERSION },
        "*",
      );
      return;
    }
    if (!FORWARDED_TYPES.has(message.type)) return;

    chrome.runtime
      .sendMessage({ type: message.type, headers: message.headers })
      .then((response) => {
        const payload =
          response && typeof response === "object" ? response : { ok: false, error: "invalid extension response" };
        window.postMessage({ type: `${message.type}-result`, requestId: message.requestId, ...payload }, "*");
      })
      .catch((error) => {
        window.postMessage(
          { type: `${message.type}-result`, requestId: message.requestId, ok: false, error: String(error) },
          "*",
        );
      });
  });
})();
