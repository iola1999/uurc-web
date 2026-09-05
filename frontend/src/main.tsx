import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

import App from "./App.js";
import { clearRoomSession } from "./uu/roomSessionStore.js";

try {
  clearRoomSession();
  window.sessionStorage.removeItem("uurc.remoteSessionId");
} catch {
  // 存储受限时仍允许展示首页和环境错误。
}

const rootElement = document.getElementById("root") as HTMLElement;
const hasPrerenderedLanding = window.location.pathname === "/" && rootElement.dataset.prerendered === "landing";
const app = (
  <StrictMode>
    <App initialLandingLoggedIn={hasPrerenderedLanding ? false : undefined} />
  </StrictMode>
);

if (hasPrerenderedLanding) {
  hydrateRoot(rootElement, app);
} else {
  rootElement.replaceChildren();
  createRoot(rootElement).render(app);
}
