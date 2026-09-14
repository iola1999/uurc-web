import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodeStreamerClipboardTextChangeRequest } from "@uurc/shared/streamer/clipboardV3";
import type { BrowserRemoteSessionState } from "../src/remote/browserRemoteSessionTypes.js";
import { getRemoteConnectionQuality } from "../src/remote/remoteConnectionQuality.js";
import { appBackend } from "./appBackendFixture.js";
import {
  buildStatsReport,
  clipboardTextChangeResponse,
  FakeMediaStream,
  TestPeerConnection,
} from "./appBrowserFakes.js";
import {
  expectSignalState,
  openAdvancedSettings,
  openOfficeMacControl,
  startCompatibleConnection,
} from "./appTestActions.js";
import {
  App,
  cleanupAppTest,
  readLocalClipboardTextMock,
  setupAppTest,
  writeLocalClipboardTextMock,
} from "./appTestEnvironment.js";
import { metricValue } from "./appTestValues.js";

describe("App remote experience", () => {
  beforeEach(setupAppTest);
  afterEach(cleanupAppTest);

  it("surfaces clipboard sync, connection quality, and manual video source selection", async () => {
    vi.stubGlobal("MediaStream", FakeMediaStream);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    readLocalClipboardTextMock.mockResolvedValue("from clipboard");
    appBackend.currentParticipants = [];
    appBackend.remoteTrackPlan = [
      { id: "blank-video", kind: "video" },
      { id: "desktop-video", kind: "video" },
    ];
    const user = userEvent.setup();
    render(<App />);

    await openOfficeMacControl(user);
    await startCompatibleConnection(user);
    await waitFor(() => {
      expectSignalState("已连接");
    });
    await screen.findByRole("button", { name: "控制中" });

    await user.click(screen.getByRole("tab", { name: "状态" }));
    expect(screen.getByRole("checkbox", { name: "自动重连" })).toBeChecked();

    const videoSourcePanel = screen.getByRole("region", { name: "画面源" });
    // 画面源按钮名称现含分辨率/信号标注（如“画面 1 无信号”），用前缀匹配定位。
    expect(within(videoSourcePanel).getByRole("button", { name: /^画面 1/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(videoSourcePanel).getByRole("button", { name: /^画面 2/ }));
    expect(within(videoSourcePanel).getByRole("button", { name: /^画面 2/ })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("tab", { name: "剪贴板" }));
    expect(screen.getByRole("checkbox", { name: "同步剪贴板" })).toBeChecked();
    await waitFor(() => {
      expect(readLocalClipboardTextMock).toHaveBeenCalled();
    });
    await waitFor(() => expect(TestPeerConnection.sentByLabel.TEXT_DATA_CHANNEL?.length).toBeGreaterThan(0));
    TestPeerConnection.channels.TEXT_DATA_CHANNEL?.onmessage?.(
      new MessageEvent("message", { data: clipboardTextChangeResponse(1n, 1).buffer }),
    );
    await screen.findByText("已同步到远端（14 字符）");
    expect(screen.getByRole("status")).toHaveClass("app-toast--remote");

    const remoteClipboardText = "from remote clipboard";
    TestPeerConnection.emitIncomingDataChannel("TEXT_DATA_CHANNEL").onmessage?.(
      new MessageEvent("message", {
        data: encodeStreamerClipboardTextChangeRequest({
          sequence: 2,
          timestampMs: 3,
          requestId: 4,
          text: remoteClipboardText,
        }).buffer,
      }),
    );
    await waitFor(() => expect(writeLocalClipboardTextMock).toHaveBeenCalledWith(remoteClipboardText));
    await screen.findByText(`已同步到本机（${remoteClipboardText.length} 字符）`);
  });

  it("shows useful connection quality metrics when WebRTC stats provide them", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    appBackend.currentParticipants = [];
    const firstStatsReport = buildStatsReport({
      bytesReceived: 1_000_000,
      framesDecoded: 100,
      framesDropped: 2,
      framesPerSecond: 30,
      timestamp: 1_000,
    });
    const secondStatsReport = buildStatsReport({
      bytesReceived: 1_600_000,
      framesDecoded: 130,
      framesDropped: 3,
      framesPerSecond: 30,
      frameWidth: 1920,
      frameHeight: 1080,
      currentRoundTripTime: 0.042,
      timestamp: 2_000,
    });
    const thirdStatsReport = buildStatsReport({
      bytesReceived: 2_200_000,
      framesDecoded: 160,
      framesDropped: 3,
      framesPerSecond: 30,
      frameWidth: 1920,
      frameHeight: 1080,
      currentRoundTripTime: 0.042,
      timestamp: 3_000,
    });
    const fourthStatsReport = buildStatsReport({
      bytesReceived: 2_800_000,
      framesDecoded: 190,
      framesDropped: 3,
      framesPerSecond: 30,
      frameWidth: 1920,
      frameHeight: 1080,
      currentRoundTripTime: 0.042,
      timestamp: 4_000,
    });
    TestPeerConnection.statsReports = [firstStatsReport, secondStatsReport, thirdStatsReport, fourthStatsReport];
    const user = userEvent.setup();
    render(<App />);

    await openOfficeMacControl(user);
    await startCompatibleConnection(user);
    await waitFor(() => {
      expectSignalState("已连接");
    });
    await openAdvancedSettings(user);
    await user.click(screen.getByRole("tab", { name: "状态" }));

    // 连接质量由后台自动轮询刷新 WebRTC 统计，等待轮询消费至少两帧统计后算出码率/帧率。
    const quality = screen.getByRole("region", { name: "连接质量" });
    await within(quality).findByText("帧率", undefined, { timeout: 3000 });
    expect(within(quality).getByText("30 fps")).toBeInTheDocument();
    const moreMetrics = within(quality).getByText("更多指标");
    const moreMetricsDetails = moreMetrics.closest("details");
    expect(moreMetricsDetails).toHaveAttribute("data-expanded", "false");
    await user.click(moreMetrics);
    expect(moreMetricsDetails).toHaveAttribute("data-expanded", "true");
    expect(within(quality).getByText("接收码率")).toBeInTheDocument();
    expect(within(quality).getByText("4.8 Mbps")).toBeInTheDocument();
    expect(within(quality).getByText("延迟")).toBeInTheDocument();
    expect(within(quality).getByText("42 ms")).toBeInTheDocument();
    expect(within(quality).getByText("分辨率")).toBeInTheDocument();
    expect(within(quality).getByText("1920x1080")).toBeInTheDocument();
  });

  it("keeps connection quality metric slots stable when WebRTC stats fluctuate", () => {
    const richState: BrowserRemoteSessionState = {
      appControlId: "app-1",
      connectionPath: "direct",
      dataChannels: {},
      debugEvents: [],
      remoteTrackCount: 1,
      stage: "connected",
      inboundVideo: {
        bytesReceived: 2_200_000,
        decoderImplementation: "VideoToolbox",
        frameHeight: 1440,
        frameWidth: 2560,
        framesDropped: 0,
        framesPerSecond: 57,
        freezeCount: 0,
        jitterBufferDelay: 0.012,
        jitterBufferEmittedCount: 6,
        packetsLost: 0,
        packetsReceived: 420,
      },
      selectedCandidatePair: {
        availableIncomingBitrate: 6_000_000,
        availableOutgoingBitrate: 300_000,
        currentRoundTripTime: 0.001,
      },
      videoFlow: {
        status: "receiving",
        title: "receiving",
        detail: "receiving",
        delta: {
          bytesReceived: 97_200,
          framesDecoded: 57,
          sampleIntervalMs: 1000,
        },
        updatedAtMs: 1_000,
      },
    };
    const sparseState: BrowserRemoteSessionState = {
      appControlId: "app-1",
      connectionPath: "direct",
      dataChannels: {},
      debugEvents: [],
      remoteTrackCount: 1,
      stage: "connected",
      videoFlow: {
        status: "receiving",
        title: "receiving",
        detail: "receiving",
        updatedAtMs: 2_000,
      },
    };
    const expectedLabels = [
      "路径",
      "画面",
      "输入",
      "控制通道",
      "文本通道",
      "帧率",
      "接收码率",
      "延迟",
      "分辨率",
      "丢帧",
      "冻结",
      "丢包",
      "抖动缓冲",
      "下行余量",
      "上行余量",
      "解码器",
    ];

    const richMetrics = getRemoteConnectionQuality({
      state: richState,
      controlChannelState: "open",
      inputControlActive: false,
      textChannelState: "open",
      connectionPathLabel: "直连",
    }).metrics;
    const sparseMetrics = getRemoteConnectionQuality({
      state: sparseState,
      controlChannelState: "open",
      inputControlActive: false,
      textChannelState: "open",
      connectionPathLabel: "直连",
    }).metrics;

    expect(richMetrics.map((metric) => metric.label)).toEqual(expectedLabels);
    expect(sparseMetrics.map((metric) => metric.label)).toEqual(expectedLabels);
    expect(metricValue(sparseMetrics, "输入")).toBe("仅查看");
    expect(metricValue(sparseMetrics, "接收码率")).toBe("采样中");
    expect(metricValue(sparseMetrics, "分辨率")).toBe("暂无");
  });

  it("separates input lock state from the open control data channel", () => {
    const state: BrowserRemoteSessionState = {
      appControlId: "app-1",
      connectionPath: "relay",
      dataChannels: {},
      debugEvents: [],
      remoteTrackCount: 1,
      stage: "connected",
      videoFlow: {
        status: "receiving",
        title: "receiving",
        detail: "receiving",
        updatedAtMs: 1_000,
      },
    };

    const quality = getRemoteConnectionQuality({
      state,
      controlChannelState: "open",
      inputControlActive: false,
      textChannelState: "open",
      connectionPathLabel: "UU 中转",
    });

    // 输入状态（仅查看）与控制数据通道状态（已打开）分别展示，互不混淆。
    expect(metricValue(quality.metrics, "输入")).toBe("仅查看");
    expect(metricValue(quality.metrics, "控制通道")).toBe("已打开");
    expect(metricValue(quality.metrics, "文本通道")).toBe("已打开");
  });

  it("drives fullscreen, view mode, and shortcuts from the toolbar", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    appBackend.currentParticipants = [];
    const user = userEvent.setup();
    render(<App />);

    await openOfficeMacControl(user);
    await startCompatibleConnection(user);
    await waitFor(() => {
      expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/control")).toHaveLength(1);
    });
    await screen.findByRole("button", { name: "控制中" });

    const stage = screen.getByRole("application", { name: "远控画面" }) as HTMLDivElement;
    const stageFrame = stage.parentElement as HTMLDivElement;
    const dock = screen.getByLabelText("远控主流程");
    // 连上之后工具栏空闲几秒就会收起，先把指针放到箭头上保持展开，才能点里面的按钮。
    await user.hover(screen.getByRole("button", { name: "远控工具栏" }));

    // 停靠位置固定在画面顶部居中，全部交给 CSS，组件不写内联定位样式。
    expect(dock.style.cssText).toBe("");
    expect(dock.querySelector(".control-command-bar")).toBeInTheDocument();
    expect(stageFrame).not.toHaveClass("control-stage-frame--fullscreen");

    expect(stage).toHaveClass("remote-stage-fit");
    await user.click(screen.getByRole("button", { name: "填充画面" }));
    expect(stage).toHaveClass("remote-stage-fill");
    await user.click(screen.getByRole("button", { name: "适应画面" }));
    expect(stage).toHaveClass("remote-stage-fit");

    // 全屏沿用同一个停靠点，箭头依然在。
    await user.click(screen.getByRole("button", { name: "全屏" }));
    expect(stageFrame).toHaveClass("control-stage-frame--fullscreen");
    expect(screen.getByRole("button", { name: "退出全屏" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "远控工具栏" })).toBeInTheDocument();

    const sentBefore = TestPeerConnection.sentByLabel.CONTROL_DATA_CHANNEL?.length ?? 0;
    await user.click(screen.getByText("快捷键"));
    await user.click(screen.getByRole("button", { name: "Ctrl Alt Del" }));
    expect(TestPeerConnection.sentByLabel.CONTROL_DATA_CHANNEL?.length).toBeGreaterThan(sentBefore);
    expect(screen.getByRole("button", { name: "Cmd Opt Esc" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "退出全屏" }));
    expect(stageFrame).not.toHaveClass("control-stage-frame--fullscreen");
  });
});
