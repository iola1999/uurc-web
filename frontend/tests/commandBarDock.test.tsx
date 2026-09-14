import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RemoteCommandBar, type RemoteCommandBarProps } from "../src/components/RemoteCommandBar.js";
import { AppMotionProvider } from "../src/motion/AppMotionProvider.js";

// 只接管 setTimeout：motion 和 jsdom 依赖的 requestAnimationFrame 保持真实实现。
function useCollapseTimers() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

function settle(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function renderCommandBar(overrides: Partial<RemoteCommandBarProps> = {}) {
  const props: RemoteCommandBarProps = {
    busy: null,
    controlChannelState: "open",
    inputControlActive: true,
    isFullscreen: false,
    nextAction: { label: "重新连接", detail: "", disabled: false },
    onNextAction: vi.fn(),
    onRemoteShortcut: vi.fn(),
    onStageViewModeChange: vi.fn(),
    onToggleInputControl: vi.fn(),
    onToggleFullscreen: vi.fn(),
    canSendText: true,
    onSendText: vi.fn(() => true),
    remoteAudio: {
      elementRef: { current: null },
      available: false,
      muted: false,
      volume: 1,
      playbackState: "idle",
      playbackErrorName: "",
      onToggleMuted: vi.fn(),
      onVolumeChange: vi.fn(),
      onResumePlayback: vi.fn(),
    },
    remoteShortcutPlatform: "mac",
    remoteStageViewMode: "fit",
    ...overrides,
  };

  return render(
    <AppMotionProvider>
      <div className="control-stage-frame">
        <RemoteCommandBar {...props} />
      </div>
    </AppMotionProvider>,
  );
}

function getDock() {
  return screen.getByLabelText("远控主流程");
}

function getTab() {
  return screen.getByRole("button", { name: "展开远控工具栏" });
}

describe("RemoteCommandBar dock", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the full toolbar for two seconds, then collapses to the arrow and follows hover", () => {
    useCollapseTimers();
    renderCommandBar();
    const dock = getDock();

    expect(dock.querySelector(".control-command-bar")).toBeInTheDocument();
    expect(getTab()).toHaveAttribute("aria-expanded", "true");

    // 连接建立后完整展示两秒，到点收成箭头。
    settle(1900);
    expect(dock.querySelector(".control-command-bar")).toBeInTheDocument();
    settle(200);
    expect(dock.querySelector(".control-command-bar")).not.toBeInTheDocument();
    expect(getTab()).toHaveAttribute("aria-expanded", "false");

    fireEvent.pointerOver(getTab());
    expect(dock.querySelector(".control-command-bar")).toBeInTheDocument();

    // 鼠标移开同样等两秒再收起。
    fireEvent.pointerOut(getTab(), { relatedTarget: document.body });
    settle(1900);
    expect(dock.querySelector(".control-command-bar")).toBeInTheDocument();
    settle(200);
    expect(dock.querySelector(".control-command-bar")).not.toBeInTheDocument();
  });

  it("keeps the arrow as the same node in front of the toolbar across expand and collapse", () => {
    useCollapseTimers();
    renderCommandBar();
    const dock = getDock();

    settle(2000);
    const tabWhileCollapsed = getTab();
    expect(dock.firstElementChild).toBe(tabWhileCollapsed);

    fireEvent.pointerOver(getTab());
    // 展开只是在箭头下方追加工具条：箭头节点本身保持同一个，光标底下的元素也保持同一个。
    expect(getTab()).toBe(tabWhileCollapsed);
    expect(dock.firstElementChild).toBe(tabWhileCollapsed);
    expect(dock.children).toHaveLength(2);
  });

  it("expands on tap, where hover does not exist", () => {
    useCollapseTimers();
    renderCommandBar();
    const dock = getDock();

    settle(2000);
    fireEvent.pointerOver(getTab(), { pointerType: "touch" });
    expect(dock.querySelector(".control-command-bar")).not.toBeInTheDocument();

    fireEvent.click(getTab());
    expect(dock.querySelector(".control-command-bar")).toBeInTheDocument();
  });

  it("keeps the connect action reachable while the control channel is not open", () => {
    useCollapseTimers();
    renderCommandBar({
      controlChannelState: "connecting",
      inputControlActive: false,
      nextAction: { label: "开始连接", detail: "", disabled: false },
    });

    settle(10_000);
    expect(getDock().querySelector(".control-command-bar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /开始连接/ })).toBeInTheDocument();
  });

  it("keeps the toolbar expanded while the text input dialog is open", () => {
    useCollapseTimers();
    renderCommandBar();

    fireEvent.click(screen.getByRole("button", { name: "输入文字" }));
    settle(10_000);

    expect(getDock().querySelector(".control-command-bar")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "输入文字" })).toBeInTheDocument();
  });
});
