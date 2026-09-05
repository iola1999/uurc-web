import type { DecodedStreamerControlMessage } from "@uurc/shared/streamer/controlChannelDecode";
import { encodeStreamerInputMessage, encodeStreamerTextMessage } from "@uurc/shared/streamer/controlChannelEncode";
import { STREAMER_SIMPLE_ACTION_TYPES } from "@uurc/shared/streamer/controlChannelProtocol";
import {
  buildStreamerRtcConfiguration,
  formatStreamerSignalControlFailure,
  getStreamerSignalControlFailure,
} from "@uurc/shared/streamer/signalControl";
import { STREAMER_ICE_NETWORK_TYPES, type StreamerIceNetworkType } from "@uurc/shared/streamer/signalSoac";
import { STREAMER_DATA_CHANNEL_LABELS, type StreamerDataChannelLabel } from "@uurc/shared/streamer/transport";
import type { RemoteSignalGatewayEvent } from "@uurc/shared/signalGateway/model";
import { BrowserRemoteChannels } from "./browserRemote/channels.js";
import { BrowserRemoteClipboard } from "./browserRemote/clipboard.js";
import {
  summarizeDecodedControlMessage,
  summarizeCursorShape,
  summarizeInputMessage,
} from "./browserRemote/dataChannel.js";
import {
  diagnoseVideoFlow,
  diffVideoElementSample,
  formatVideoFlowDelta,
  isActiveVideoElementSample,
  positive,
  readInboundAudioStats,
  readInboundVideoStats,
  readSelectedCandidatePair,
  type BrowserRemoteStatsSample,
} from "./browserRemote/diagnostics.js";
import { BrowserRemoteInput, MOUSE_MOVE_BUFFERED_AMOUNT_LOW_THRESHOLD } from "./browserRemote/input.js";
import {
  applyVideoCodecPreferences,
  createMediaStream,
  extractCandidateType,
  extractRemoteDisplayId,
  getBrowserH264CodecPreferences,
  matchesScopedString,
  normalizeCandidate,
  normalizeSwitchNetworkNotify,
  readStringField,
  summarizeSignalEvent,
} from "./browserRemote/negotiation.js";
import { asRecord, createAbortError, dropUndefinedFields, isDesktopPlatform } from "./browserRemote/utils.js";
import type {
  BrowserRemoteAudioElementSample,
  BrowserRemoteDataChannel,
  BrowserRemoteDebugEvent,
  BrowserRemoteDebugEventKind,
  BrowserRemoteKeyboardInput,
  BrowserRemoteMouseButtonInput,
  BrowserRemoteMouseClickInput,
  BrowserRemoteMouseMoveOptions,
  BrowserRemoteMousePositionInput,
  BrowserRemoteMouseScrollInput,
  BrowserRemotePeerConnection,
  BrowserRemoteSessionOptions,
  BrowserRemoteSessionStartInput,
  BrowserRemoteSessionState,
  BrowserRemoteVideoElementSample,
  BrowserRemoteVideoFlowDelta,
} from "./browserRemoteSessionTypes.js";
import { applyOpusReceiverPreferencesToSdp } from "./remoteSdp.js";

export class BrowserRemoteSession {
  private static readonly maxDebugEvents = 120;

  private readonly createPeerConnection: (configuration: RTCConfiguration) => BrowserRemotePeerConnection;
  private readonly getVideoCodecPreferences: () => RTCRtpCodec[];
  private readonly now: () => number;
  private readonly channels: BrowserRemoteChannels;
  private readonly clipboard: BrowserRemoteClipboard;
  private readonly input: BrowserRemoteInput;
  private peer: BrowserRemotePeerConnection | null = null;
  private debugEventId = 1;
  private debugEvents: BrowserRemoteDebugEvent[] = [];
  private appControlId = "";
  private clientId: string | undefined;
  private iceId: string | undefined;
  private gzipSdp = true;
  private iceNetworkType: StreamerIceNetworkType = STREAMER_ICE_NETWORK_TYPES.appAuto;
  private targetPlatform: number | undefined;
  private readonly processedSignalEventIds = new Set<number>();
  private queuedCandidates: RTCIceCandidateInit[] = [];
  private remoteStream: MediaStream | null = null;
  private readonly remoteTracks = new Set<MediaStreamTrack>();
  private remoteDisplayId: number | undefined;
  private remoteInputDisplayId: number | undefined;
  private sequence = 1;
  private previousStatsSample: BrowserRemoteStatsSample | undefined;
  private previousVideoElementSample: BrowserRemoteVideoElementSample | undefined;
  private previousStatsVideoElementSample: BrowserRemoteVideoElementSample | undefined;
  private lastControlInput: { atMs: number; input: Record<string, unknown> } | undefined;
  private videoStallStartedAtMs: number | undefined;
  private lifecycleGeneration = 0;
  private state: BrowserRemoteSessionState = {
    appControlId: "",
    connectionPath: "unknown",
    dataChannels: {},
    debugEvents: [],
    remoteTrackCount: 0,
    stage: "idle",
  };

  constructor(private readonly options: BrowserRemoteSessionOptions) {
    this.createPeerConnection =
      options.createPeerConnection ??
      ((configuration) => new RTCPeerConnection(configuration) as BrowserRemotePeerConnection);
    this.getVideoCodecPreferences = options.getVideoCodecPreferences ?? getBrowserH264CodecPreferences;
    this.now = options.now ?? Date.now;
    const initialDebugEvents = options.initialDebugEvents?.slice(-BrowserRemoteSession.maxDebugEvents) ?? [];
    if (initialDebugEvents.length > 0) {
      this.debugEvents = initialDebugEvents.map((event) => ({
        ...event,
        details: event.details ? { ...event.details } : undefined,
      }));
      this.debugEventId = Math.max(...initialDebugEvents.map((event) => event.id), 0) + 1;
      this.recordDebugEvent("session", "保留上一次会话调试日志", {
        eventCount: initialDebugEvents.length,
      });
    }
    this.channels = new BrowserRemoteChannels({
      handleClipboardMessage: (label, data) => this.clipboard.handleDataMessage(label, data),
      isGenerationCurrent: (generation) => this.isLifecycleGenerationCurrent(generation),
      nextEnvelope: () => {
        const sequence = this.sequence++;
        return { sequence, timestampSeconds: this.streamerTimestampSeconds() };
      },
      now: this.now,
      onBufferedAmountLow: () => this.input.flushPendingMouseMove(),
      onClipboardUnavailable: (reason) => this.clipboard.reset(reason),
      onControlMessage: (message) => this.handleControlDataMessage(message),
      onControlUnavailable: () => this.input.clearPendingPointerMoves(),
      onReadyStateChange: (label, readyState) => this.updateDataChannelState(label, readyState),
      recordDebugEvent: (kind, summary, details) => this.recordDebugEvent(kind, summary, details),
    });
    this.clipboard = new BrowserRemoteClipboard({
      assertGeneration: (generation) => this.assertLifecycleGeneration(generation),
      currentGeneration: () => this.lifecycleGeneration,
      nextEnvelope: () => {
        const sequence = this.sequence++;
        return { sequence, timestampSeconds: this.streamerTimestampSeconds() };
      },
      now: this.now,
      onRemoteClipboard: options.onRemoteClipboard,
      recordDebugEvent: (kind, summary, details) => this.recordDebugEvent(kind, summary, details),
      sendDataChannel: (label, payload, event) => this.channels.send(label, payload, event),
    });
    this.input = new BrowserRemoteInput({
      getControlChannel: () => this.channels.get(STREAMER_DATA_CHANNEL_LABELS.control),
      getTargetPlatform: () => this.targetPlatform,
      now: this.now,
      recordDebugEvent: (summary, details) => this.recordDebugEvent("data_send", summary, details),
      sendInputData: (inputMessage, inputOptions) => this.sendInputData(inputMessage, inputOptions),
    });
  }

  private streamerTimestampSeconds(): number {
    return Math.floor(this.now() / 1000);
  }

  getState(): BrowserRemoteSessionState {
    return {
      ...this.state,
      audioElement: this.state.audioElement ? { ...this.state.audioElement } : undefined,
      dataChannels: { ...this.state.dataChannels },
      debugEvents: [...this.debugEvents],
      inboundAudio: this.state.inboundAudio ? { ...this.state.inboundAudio } : undefined,
      inboundVideo: this.state.inboundVideo ? { ...this.state.inboundVideo } : undefined,
      selectedCandidatePair: this.state.selectedCandidatePair ? { ...this.state.selectedCandidatePair } : undefined,
      videoElement: this.state.videoElement ? { ...this.state.videoElement } : undefined,
      videoFlow: this.state.videoFlow
        ? {
            ...this.state.videoFlow,
            delta: this.state.videoFlow.delta ? { ...this.state.videoFlow.delta } : undefined,
          }
        : undefined,
    };
  }

  close(): BrowserRemoteSessionState {
    this.lifecycleGeneration += 1;
    this.recordDebugEvent("session", "关闭浏览器远控会话", {
      stage: this.state.stage,
      appControlId: this.appControlId || undefined,
      iceId: this.iceId,
    });
    this.clipboard.reset("浏览器远控会话已关闭");
    this.channels.closeAll();
    if (this.peer) {
      this.peer.ondatachannel = null;
      this.peer.onconnectionstatechange = null;
      this.peer.onicecandidate = null;
      this.peer.oniceconnectionstatechange = null;
      this.peer.onicegatheringstatechange = null;
      this.peer.onsignalingstatechange = null;
      this.peer.ontrack = null;
      this.peer.close?.();
    }
    for (const track of this.remoteTracks) {
      track.onmute = null;
      track.onunmute = null;
      track.onended = null;
    }
    this.remoteTracks.clear();
    this.peer = null;
    this.appControlId = "";
    this.clientId = undefined;
    this.iceId = undefined;
    this.targetPlatform = undefined;
    this.processedSignalEventIds.clear();
    this.queuedCandidates = [];
    this.remoteStream = null;
    this.remoteDisplayId = undefined;
    this.remoteInputDisplayId = undefined;
    this.input.reset();
    this.sequence = 1;
    this.previousStatsSample = undefined;
    this.previousVideoElementSample = undefined;
    this.previousStatsVideoElementSample = undefined;
    this.lastControlInput = undefined;
    this.videoStallStartedAtMs = undefined;
    this.options.onRemoteCursorShape?.(null);
    this.setState({
      appControlId: "",
      connectionPath: "unknown",
      dataChannels: {},
      debugEvents: this.debugEvents,
      remoteTrackCount: 0,
      stage: "idle",
    });
    return this.getState();
  }

  async start(input: BrowserRemoteSessionStartInput): Promise<BrowserRemoteSessionState> {
    const lifecycleGeneration = this.lifecycleGeneration + 1;
    this.lifecycleGeneration = lifecycleGeneration;
    this.clipboard.reset("新的浏览器远控会话已开始");
    this.recordDebugEvent("session", "启动 signal control", {
      appControlId: input.appControlId,
      gzipSdp: input.gzipSdp ?? true,
      forceRelay: input.forceRelay ?? false,
    });
    const control = await this.options.api.sendSignalControl({
      appControlId: input.appControlId,
      appDataBase64: input.appDataBase64,
      streamerData: input.streamerData,
    });
    this.assertLifecycleGeneration(lifecycleGeneration);
    const result = control.control.result;
    if (!result) {
      throw new Error("signal control ack did not include a ControlResult");
    }
    const failure = getStreamerSignalControlFailure(control.control);
    if (failure) {
      throw new Error(`signal control ack failed: ${formatStreamerSignalControlFailure(failure)}`);
    }

    this.appControlId = input.appControlId;
    this.clientId = result.clientId;
    this.iceId = result.iceId ?? input.iceId;
    this.gzipSdp = input.gzipSdp ?? true;
    this.iceNetworkType = input.iceNetworkType ?? STREAMER_ICE_NETWORK_TYPES.appAuto;
    this.targetPlatform = input.targetPlatform;
    this.processedSignalEventIds.clear();
    const peer = this.createPeerConnection(buildStreamerRtcConfiguration(result, { forceRelay: input.forceRelay }));
    this.peer = peer;
    this.attachPeerDiagnostics(peer, lifecycleGeneration);
    this.channels.create(peer, lifecycleGeneration, MOUSE_MOVE_BUFFERED_AMOUNT_LOW_THRESHOLD);
    peer.ondatachannel = (event) => {
      if (!this.isPeerLifecycleCurrent(peer, lifecycleGeneration)) return;
      this.channels.attachIncoming(event.channel as BrowserRemoteDataChannel, lifecycleGeneration);
    };
    this.createStreamerMediaTransceivers(peer);
    peer.onicecandidate = (event) => {
      if (!this.isLifecycleGenerationCurrent(lifecycleGeneration)) return;
      void this.sendLocalCandidate(event.candidate?.toJSON?.() ?? null, lifecycleGeneration);
    };
    peer.ontrack = (event) => {
      if (!this.isLifecycleGenerationCurrent(lifecycleGeneration)) return;
      this.applyRemoteTrack(event);
    };

    this.setState({
      appControlId: input.appControlId,
      clientId: result.clientId,
      connectionPath: "unknown",
      controlIceIdMatch: input.iceId && result.iceId ? input.iceId === result.iceId : undefined,
      controlResult: result,
      controlResultIceId: result.iceId,
      dataChannels: this.channels.getStates(),
      debugEvents: this.debugEvents,
      iceId: this.iceId,
      ...this.readPeerState(peer),
      remoteTrackCount: 0,
      stage: "controlled",
    });
    this.recordDebugEvent("session", "control ack 成功", {
      clientId: this.clientId,
      iceId: this.iceId,
      iceServers: result.iceServers.length,
      forceRelay: result.forceRelay,
      autoSwitchNetwork: result.autoSwitchNetwork,
      targetPlatform: this.targetPlatform,
    });

    await this.createAndSendLocalOffer("offer", undefined, lifecycleGeneration);
    this.assertLifecycleGeneration(lifecycleGeneration);

    this.setState({
      ...this.state,
      stage: "offered",
    });
    return this.getState();
  }

  fail(message: string): BrowserRemoteSessionState {
    this.close();
    this.setState({ ...this.state, failureReason: message });
    return this.getState();
  }

  sendTextData(text: string): void {
    if (!text) return;
    const sequence = this.sequence;
    const timestampSeconds = this.streamerTimestampSeconds();
    const payload = encodeStreamerTextMessage({
      sequence,
      timestampMs: timestampSeconds,
      inputMessage: text,
      displayId: this.remoteInputDisplayId,
    });
    this.sequence += 1;
    this.channels.send(STREAMER_DATA_CHANNEL_LABELS.text, payload, {
      summary: "发送文本输入",
      details: {
        sequence,
        timestampSeconds,
        textLength: text.length,
        inputDisplayId: this.remoteInputDisplayId,
        remoteDisplayId: this.remoteDisplayId,
        targetPlatform: this.targetPlatform,
      },
    });
    this.lastControlInput = {
      atMs: this.now(),
      input: {
        action: "text_data",
        textLength: text.length,
      },
    };
  }

  sendPastedText(text: string): void {
    if (isDesktopPlatform(this.targetPlatform)) {
      this.sendTextInput(text);
      return;
    }
    this.sendTextData(text);
  }

  sendClipboardText(text: string): Promise<void> {
    return this.clipboard.sendText(text);
  }

  requestRemoteClipboardText(): void {
    this.clipboard.requestText();
  }

  cancelRemoteClipboardRead(): void {
    this.clipboard.cancelRead();
  }

  sendMouseClick(input: BrowserRemoteMouseClickInput): void {
    this.input.sendMouseClick(input);
  }

  sendMouseMove(input: BrowserRemoteMousePositionInput, options: BrowserRemoteMouseMoveOptions = {}): void {
    this.input.sendMouseMove(input, options);
  }

  sendMouseButton(input: BrowserRemoteMouseButtonInput): void {
    this.input.sendMouseButton(input);
  }

  sendMouseScroll(input: BrowserRemoteMouseScrollInput): void {
    this.input.sendMouseScroll(input);
  }

  sendKeyboardInput(input: BrowserRemoteKeyboardInput): void {
    this.input.sendKeyboardInput(input);
  }

  sendTextInput(content: string): void {
    this.input.sendTextInput(content);
  }

  releaseAllInputs(): void {
    this.input.releaseAll();
  }

  async refreshConnectionStats(): Promise<BrowserRemoteSessionState> {
    if (!this.peer?.getStats) return this.getState();

    const report = await this.peer.getStats();
    const sampledAtMs = this.now();
    const previousFlowStatus = this.state.videoFlow?.status;
    const selectedCandidatePair = readSelectedCandidatePair(report);
    const inboundAudio = readInboundAudioStats(report);
    const inboundVideo = readInboundVideoStats(report, this.state.videoElement?.trackIdentifier);
    const videoFlow = diagnoseVideoFlow({
      nowMs: sampledAtMs,
      previous: this.previousStatsSample,
      current: {
        inboundVideo,
        sampledAtMs,
        selectedCandidatePair: selectedCandidatePair.pair,
      },
      previousVideoElement: this.previousStatsVideoElementSample,
      currentVideoElement: this.state.videoElement,
    });
    this.previousStatsSample = {
      inboundVideo,
      sampledAtMs,
      selectedCandidatePair: selectedCandidatePair.pair,
    };
    this.previousStatsVideoElementSample = this.state.videoElement;
    this.setState({
      ...this.state,
      connectionPath: selectedCandidatePair.connectionPath,
      inboundAudio,
      inboundVideo,
      selectedCandidatePair: selectedCandidatePair.pair,
      videoFlow,
    });
    const stallDetails = {
      status: videoFlow.status,
      previousStatus: previousFlowStatus,
      delta: videoFlow.delta,
      inboundVideo,
      candidatePair: selectedCandidatePair.pair,
      connectionPath: selectedCandidatePair.connectionPath,
      dataChannels: this.channels.getStates(),
      controlBufferedAmount: this.channels.get(STREAMER_DATA_CHANNEL_LABELS.control)?.bufferedAmount,
      peer: this.readPeerState(this.peer),
      lastControlInput: this.lastControlInput
        ? {
            ...this.lastControlInput,
            ageMs: Math.max(0, sampledAtMs - this.lastControlInput.atMs),
          }
        : undefined,
    };
    this.recordDebugEvent("stats", videoFlow.title, {
      status: videoFlow.status,
      delta: videoFlow.delta,
      inboundAudio,
      inboundVideo,
      selectedCandidatePair: selectedCandidatePair.pair,
    });
    const flowIsStalled = isVideoFlowStalled(videoFlow.status);
    const previousFlowWasStalled = isVideoFlowStalled(previousFlowStatus);
    if (flowIsStalled && !previousFlowWasStalled) {
      this.videoStallStartedAtMs = sampledAtMs;
      this.recordDebugEvent("stats", "画面停滞快照", stallDetails);
      console.warn(
        `[uurc] 画面停滞 → ${videoFlow.status}（${videoFlow.detail}）` +
          ` path=${selectedCandidatePair.connectionPath}` +
          ` control=${this.state.dataChannels[STREAMER_DATA_CHANNEL_LABELS.control] ?? "?"}`,
        stallDetails,
      );
    } else if (videoFlow.status === "receiving" && previousFlowWasStalled) {
      const stalledForMs =
        this.videoStallStartedAtMs === undefined ? undefined : Math.max(0, sampledAtMs - this.videoStallStartedAtMs);
      this.recordDebugEvent("stats", "画面从停滞恢复", {
        previousStatus: previousFlowStatus,
        stalledForMs,
        delta: videoFlow.delta,
      });
      this.videoStallStartedAtMs = undefined;
    }
    return this.getState();
  }

  recordVideoElementSample(sample: BrowserRemoteVideoElementSample): BrowserRemoteSessionState {
    const previousPrimarySample = this.state.videoElement;
    const sampleIsActive = isActiveVideoElementSample(sample);
    const previousSampleIsActive = isActiveVideoElementSample(previousPrimarySample);
    const shouldUseSample = sampleIsActive || !previousSampleIsActive;
    if (!shouldUseSample) return this.getState();

    const nextPrimarySample = sample;

    const delta = diffVideoElementSample(this.previousVideoElementSample, nextPrimarySample);
    this.previousVideoElementSample = nextPrimarySample;
    const videoFlow = positive(delta.videoElementFrames)
      ? {
          status: "receiving" as const,
          title: "Video 元素帧在增长",
          detail: formatVideoFlowDelta(dropUndefinedFields(delta) as BrowserRemoteVideoFlowDelta),
          delta: dropUndefinedFields(delta) as BrowserRemoteVideoFlowDelta,
          updatedAtMs: this.now(),
        }
      : (this.state.videoFlow ??
        diagnoseVideoFlow({
          nowMs: this.now(),
          previous: this.previousStatsSample,
          current: {
            inboundVideo: this.state.inboundVideo,
            sampledAtMs: this.now(),
            selectedCandidatePair: this.state.selectedCandidatePair,
          },
          previousVideoElement: this.state.videoElement,
          currentVideoElement: nextPrimarySample,
        }));
    this.setState({
      ...this.state,
      videoElement: nextPrimarySample,
      videoFlow,
    });
    if (
      sample.event !== "sample" ||
      positive(delta.videoElementFrames) ||
      positive(delta.videoElementTimeMs) ||
      (sampleIsActive && !previousSampleIsActive)
    ) {
      this.recordDebugEvent("video_element", `video ${sample.event}`, {
        ...sample,
        delta,
      });
    }
    if (sample.event === "play_rejected" || sample.event === "error") {
      console.warn(`[uurc] video ${sample.event}`, {
        trackIdentifier: sample.trackIdentifier,
        errorCode: sample.errorCode,
        errorName: sample.errorName,
        errorMessage: sample.errorMessage,
        readyState: sample.readyState,
      });
    }
    return this.getState();
  }

  recordAudioElementSample(sample: BrowserRemoteAudioElementSample): BrowserRemoteSessionState {
    this.setState({
      ...this.state,
      audioElement: sample,
    });
    this.recordDebugEvent("audio_element", `audio ${sample.event}`, { ...sample });
    return this.getState();
  }

  async applySignalEvents(events: RemoteSignalGatewayEvent[]): Promise<void> {
    const lifecycleGeneration = this.lifecycleGeneration;
    for (const event of events) {
      if (!this.isLifecycleGenerationCurrent(lifecycleGeneration)) return;
      if (this.processedSignalEventIds.has(event.id)) continue;
      if (event.direction !== "inbound") continue;
      if (event.event === "soac") {
        this.recordDebugEvent("signal", "收到 SOAC", summarizeSignalEvent(event));
        const payloads = Array.isArray(event.payload) ? event.payload : [event.payload];
        for (const payload of payloads) {
          await this.applySoacPayload(payload, lifecycleGeneration);
          if (!this.isLifecycleGenerationCurrent(lifecycleGeneration)) return;
        }
        this.processedSignalEventIds.add(event.id);
        continue;
      }
      if (event.event === "switch_network_notify") {
        this.recordDebugEvent("signal", "收到切网通知", summarizeSignalEvent(event));
        try {
          await this.applySwitchNetworkNotify(event.payload, lifecycleGeneration);
        } catch (error) {
          if (!this.isLifecycleGenerationCurrent(lifecycleGeneration)) return;
          throw error;
        }
        if (!this.isLifecycleGenerationCurrent(lifecycleGeneration)) return;
        this.processedSignalEventIds.add(event.id);
        continue;
      }
      if (event.event === "forward_setting" || event.event === "device_capability") {
        this.applyRemoteDisplayCapability(event);
        this.processedSignalEventIds.add(event.id);
      }
    }
  }

  private createStreamerMediaTransceivers(peer: BrowserRemotePeerConnection): void {
    const videoCodecs = this.getVideoCodecPreferences();
    for (let index = 0; index < 5; index += 1) {
      const transceiver = peer.addTransceiver("video", { direction: "recvonly" });
      applyVideoCodecPreferences(transceiver, videoCodecs);
    }
    peer.addTransceiver("audio", { direction: "recvonly" });
  }

  private async sendLocalCandidate(candidate: RTCIceCandidateInit | null, lifecycleGeneration: number): Promise<void> {
    if (!candidate?.candidate || !this.isLifecycleGenerationCurrent(lifecycleGeneration)) return;
    this.recordDebugEvent("signal", "发送本地 candidate", {
      appControlId: this.appControlId,
      clientId: this.clientId,
      iceId: this.iceId,
      sdpMid: candidate.sdpMid ?? undefined,
      sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
      candidateType: extractCandidateType(candidate.candidate),
    });
    await this.options.api.sendSignalSoac({
      type: "candidate",
      clientId: this.clientId,
      iceId: this.iceId,
      appControlId: this.appControlId,
      candidate: {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? undefined,
        sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
      },
    });
  }

  private async applySoacPayload(payload: unknown, lifecycleGeneration: number): Promise<void> {
    const peer = this.peer;
    if (!peer || !this.isLifecycleGenerationCurrent(lifecycleGeneration)) return;

    const record = asRecord(payload);
    const data = asRecord(record?.data);
    if (!this.isCurrentSoacPayload(record, data)) return;
    if (!data) return;

    const type = data.type;
    if (type === "answer" || type === "restart_ice") {
      const sdp = typeof data.sdp === "string" ? data.sdp : undefined;
      if (!sdp) return;
      const signalingState = peer.signalingState;
      if (signalingState !== undefined && signalingState !== "have-local-offer") {
        console.warn(
          `[uurc] 忽略状态不匹配的 SOAC ${type}（signalingState=${signalingState}）→ 重协商未接上，画面可能停滞`,
        );
        this.recordDebugEvent("signal", "忽略状态不匹配的 SOAC answer", {
          type,
          signalingState,
          appControlId: readStringField(data, "app_control_id", "appControlId"),
          iceId: readStringField(data, "ice_id", "iceId"),
          sdpLength: sdp.length,
        });
        return;
      }
      try {
        await peer.setRemoteDescription({ type: "answer", sdp });
      } catch (error) {
        if (!this.isPeerLifecycleCurrent(peer, lifecycleGeneration)) return;
        this.recordDebugEvent("signal", "应用 SOAC answer 失败", {
          type,
          error: error instanceof Error ? error.message : String(error),
          signalingState: peer.signalingState,
          appControlId: readStringField(data, "app_control_id", "appControlId"),
          iceId: readStringField(data, "ice_id", "iceId"),
          sdpLength: sdp.length,
        });
        return;
      }
      if (!this.isPeerLifecycleCurrent(peer, lifecycleGeneration)) return;
      this.recordDebugEvent("signal", type === "restart_ice" ? "应用 restart_ice answer" : "应用 answer", {
        type,
        appControlId: readStringField(data, "app_control_id", "appControlId"),
        iceId: readStringField(data, "ice_id", "iceId"),
        sdpLength: sdp.length,
      });
      this.setState({
        ...this.state,
        stage: "connected",
      });
      await this.flushQueuedCandidates(peer, lifecycleGeneration);
      return;
    }

    if (type === "candidate") {
      const candidate = normalizeCandidate(data.candidate);
      if (!candidate) return;
      if (peer.remoteDescription) {
        try {
          await peer.addIceCandidate(candidate);
        } catch (error) {
          if (!this.isPeerLifecycleCurrent(peer, lifecycleGeneration)) return;
          throw error;
        }
        if (!this.isPeerLifecycleCurrent(peer, lifecycleGeneration)) return;
        this.recordDebugEvent("signal", "应用远端 candidate", {
          iceId: readStringField(data, "ice_id", "iceId"),
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
          candidateType: candidate.candidate ? extractCandidateType(candidate.candidate) : undefined,
        });
      } else {
        if (!this.isPeerLifecycleCurrent(peer, lifecycleGeneration)) return;
        this.queuedCandidates.push(candidate);
        this.recordDebugEvent("signal", "缓存远端 candidate", {
          iceId: readStringField(data, "ice_id", "iceId"),
          queuedCandidates: this.queuedCandidates.length,
          candidateType: candidate.candidate ? extractCandidateType(candidate.candidate) : undefined,
        });
      }
      return;
    }
  }

  private isCurrentSoacPayload(record: Record<string, unknown> | null, data: Record<string, unknown> | null): boolean {
    return (
      matchesScopedString(readStringField(record, "client_id", "clientId"), this.clientId) &&
      matchesScopedString(readStringField(data, "app_control_id", "appControlId"), this.appControlId) &&
      matchesScopedString(readStringField(data, "ice_id", "iceId"), this.iceId)
    );
  }

  private async createAndSendLocalOffer(
    type: "offer" | "restart_ice" = "offer",
    options?: RTCOfferOptions,
    lifecycleGeneration = this.lifecycleGeneration,
  ): Promise<void> {
    const peer = this.peer;
    if (!peer) return;
    this.assertLifecycleGeneration(lifecycleGeneration);
    const offer = await peer.createOffer(options);
    this.assertLifecycleGeneration(lifecycleGeneration);
    const preferredOffer = {
      ...offer,
      sdp: applyOpusReceiverPreferencesToSdp(offer.sdp),
    };
    await peer.setLocalDescription(preferredOffer);
    this.assertLifecycleGeneration(lifecycleGeneration);
    await this.options.api.sendSignalSoac({
      type,
      clientId: this.clientId,
      iceId: this.iceId,
      appControlId: this.appControlId,
      sdp: peer.localDescription?.sdp ?? preferredOffer.sdp,
      gzipSdp: this.gzipSdp,
      iceNetworkType: this.iceNetworkType,
    });
    this.assertLifecycleGeneration(lifecycleGeneration);
  }

  private async applySwitchNetworkNotify(payload: unknown, lifecycleGeneration: number): Promise<void> {
    const peer = this.peer;
    if (!peer || !this.isLifecycleGenerationCurrent(lifecycleGeneration)) return;
    const notify = normalizeSwitchNetworkNotify(payload, this.iceId);
    if (!notify) return;

    if (notify.transportType !== undefined) {
      this.iceNetworkType = notify.transportType;
    }
    console.warn(
      `[uurc] 收到切网通知 → 发起 ICE restart（transportType=${notify.transportType ?? "?"}），画面可能短暂停滞`,
    );
    peer.restartIce?.();
    this.recordDebugEvent("signal", "发起 ICE restart", {
      iceId: notify.iceId ?? this.iceId,
      transportType: notify.transportType,
    });
    await this.createAndSendLocalOffer("restart_ice", { iceRestart: true }, lifecycleGeneration);
  }

  private async flushQueuedCandidates(peer: BrowserRemotePeerConnection, lifecycleGeneration: number): Promise<void> {
    if (!this.isPeerLifecycleCurrent(peer, lifecycleGeneration) || !peer.remoteDescription) return;
    const candidates = this.queuedCandidates;
    this.queuedCandidates = [];
    for (const candidate of candidates) {
      try {
        await peer.addIceCandidate(candidate);
      } catch (error) {
        if (!this.isPeerLifecycleCurrent(peer, lifecycleGeneration)) return;
        throw error;
      }
      if (!this.isPeerLifecycleCurrent(peer, lifecycleGeneration)) return;
      this.recordDebugEvent("signal", "应用缓存 candidate", {
        candidateType: candidate.candidate ? extractCandidateType(candidate.candidate) : undefined,
      });
    }
  }

  private attachPeerDiagnostics(peer: BrowserRemotePeerConnection, lifecycleGeneration: number): void {
    const publishState = (event: string) => {
      if (!this.isPeerLifecycleCurrent(peer, lifecycleGeneration)) return;
      const peerState = this.readPeerState(peer);
      this.recordDebugEvent("session", `PeerConnection ${event}`, peerState);
      this.setState({
        ...this.state,
        ...peerState,
      });
    };
    peer.onconnectionstatechange = () => publishState("connectionState");
    peer.oniceconnectionstatechange = () => publishState("iceConnectionState");
    peer.onicegatheringstatechange = () => publishState("iceGatheringState");
    peer.onsignalingstatechange = () => publishState("signalingState");
  }

  private readPeerState(peer: BrowserRemotePeerConnection | null): {
    peerConnectionState?: RTCPeerConnectionState;
    peerIceConnectionState?: RTCIceConnectionState;
    peerIceGatheringState?: RTCIceGatheringState;
    peerSignalingState?: RTCSignalingState;
  } {
    if (!peer) return {};
    return dropUndefinedFields({
      peerConnectionState: peer.connectionState,
      peerIceConnectionState: peer.iceConnectionState,
      peerIceGatheringState: peer.iceGatheringState,
      peerSignalingState: peer.signalingState,
    });
  }

  private applyRemoteTrack(event: RTCTrackEvent): void {
    const stream = this.remoteStream ?? createMediaStream() ?? event.streams[0];
    if (!stream) return;
    const tracks = typeof stream.getTracks === "function" ? stream.getTracks() : [];
    const existingTrack = tracks.some((track) => track.id && track.id === event.track.id);
    if (!existingTrack && typeof stream.addTrack === "function") {
      stream.addTrack(event.track);
    }
    this.attachRemoteTrackDiagnostics(event.track, this.lifecycleGeneration);
    this.remoteStream = stream;
    const nextTrackCount =
      typeof stream.getTracks === "function"
        ? stream.getTracks().length
        : this.state.remoteTrackCount + (existingTrack ? 0 : 1);
    this.setState({
      ...this.state,
      remoteTrackCount: nextTrackCount,
    });
    this.options.onRemoteStream?.(stream);
    this.recordDebugEvent("session", "收到远端媒体轨道", {
      trackId: event.track.id,
      trackKind: event.track.kind,
      trackReadyState: event.track.readyState,
      transceiverMid: event.transceiver?.mid ?? undefined,
      remoteTrackCount: nextTrackCount,
    });
  }

  private attachRemoteTrackDiagnostics(track: MediaStreamTrack, lifecycleGeneration: number): void {
    if (this.remoteTracks.has(track)) return;
    this.remoteTracks.add(track);
    const recordState = (event: "mute" | "unmute" | "ended") => {
      if (!this.isLifecycleGenerationCurrent(lifecycleGeneration)) return;
      this.recordDebugEvent("session", `远端 ${track.kind} 轨道 ${event}`, {
        trackId: track.id,
        trackKind: track.kind,
        readyState: track.readyState,
        muted: track.muted,
      });
      if (event !== "ended") return;
      this.remoteTracks.delete(track);
      track.onmute = null;
      track.onunmute = null;
      track.onended = null;
      const stream = this.remoteStream;
      if (!stream) return;
      stream.removeTrack?.(track);
      const remoteTrackCount = typeof stream.getTracks === "function" ? stream.getTracks().length : 0;
      this.setState({
        ...this.state,
        remoteTrackCount,
      });
      this.options.onRemoteStream?.(stream);
    };
    track.onmute = () => recordState("mute");
    track.onunmute = () => recordState("unmute");
    track.onended = () => recordState("ended");
  }

  private handleControlDataMessage(message: DecodedStreamerControlMessage): void {
    this.applyCaptureChangeInputIndex(message);
    this.applyRemoteCursorShape(message);

    const simpleAction = message.simpleAction;
    if (!simpleAction || simpleAction.action !== STREAMER_SIMPLE_ACTION_TYPES.ACTION_TYPE_ECHO_REQUEST) return;
    const responseSequence = simpleAction.seq ?? message.sequence;
    if (responseSequence === undefined) {
      this.recordDebugEvent("data_recv", "收到控制 EchoRequest 但缺少 seq", summarizeDecodedControlMessage(message));
      return;
    }

    this.channels.sendEchoResponse(responseSequence);
  }

  private applyRemoteCursorShape(message: DecodedStreamerControlMessage): void {
    const cursorShape = message.systemStateChange?.cursorShape;
    if (!cursorShape) return;
    if (
      cursorShape.screenId !== undefined &&
      this.remoteInputDisplayId !== undefined &&
      cursorShape.screenId !== this.remoteInputDisplayId
    ) {
      this.recordDebugEvent("data_recv", "忽略非当前画面的光标形状", {
        cursorScreenId: cursorShape.screenId,
        inputDisplayId: this.remoteInputDisplayId,
      });
      return;
    }
    this.recordDebugEvent("data_recv", "更新远端光标形状", summarizeCursorShape(cursorShape));
    this.options.onRemoteCursorShape?.(cursorShape);
  }

  private applyCaptureChangeInputIndex(message: DecodedStreamerControlMessage): void {
    const captureChange = message.captureChange;
    if (!captureChange) return;

    const nextInputDisplayId =
      captureChange.captureTypeName === "CT_MUMU" && captureChange.captureId !== undefined
        ? captureChange.captureId
        : undefined;
    if (nextInputDisplayId === this.remoteInputDisplayId) return;

    this.remoteInputDisplayId = nextInputDisplayId;
    this.options.onRemoteCursorShape?.(null);
    this.setState({
      ...this.state,
      remoteInputDisplayId: nextInputDisplayId,
    });
    this.recordDebugEvent("data_recv", "更新控制输入索引", {
      inputDisplayId: nextInputDisplayId,
      captureChange,
    });
  }

  private sendInputData(inputMessage: string, options: { recordDebugEvent?: boolean } = {}): void {
    if (!inputMessage) {
      this.recordDebugEvent("data_send", "跳过空控制输入", {
        targetPlatform: this.targetPlatform,
      });
      return;
    }
    const sequence = this.sequence;
    const timestampSeconds = this.streamerTimestampSeconds();
    const inputDisplayId = this.resolveInputDisplayId();
    const inputSummary = summarizeInputMessage(inputMessage);
    const payload = isDesktopPlatform(this.targetPlatform)
      ? inputMessage
      : encodeStreamerInputMessage({
          sequence,
          timestampMs: timestampSeconds,
          inputMessage,
          displayId: inputDisplayId,
        });
    this.sequence += 1;
    this.channels.send(
      STREAMER_DATA_CHANNEL_LABELS.control,
      payload,
      options.recordDebugEvent === false
        ? false
        : {
            summary: "发送控制输入",
            details: {
              sequence,
              timestampSeconds,
              inputDisplayId,
              remoteDisplayId: this.remoteDisplayId,
              route: isDesktopPlatform(this.targetPlatform) ? "control_text" : "send_to_rom",
              targetPlatform: this.targetPlatform,
              input: inputSummary,
            },
          },
    );
    this.lastControlInput = {
      atMs: this.now(),
      input: inputSummary,
    };
  }

  private resolveInputDisplayId(): number | undefined {
    if (this.remoteInputDisplayId !== undefined) return this.remoteInputDisplayId;
    return this.remoteDisplayId;
  }

  private isLifecycleGenerationCurrent(generation: number): boolean {
    return this.lifecycleGeneration === generation;
  }

  private isPeerLifecycleCurrent(peer: BrowserRemotePeerConnection, generation: number): boolean {
    return this.peer === peer && this.isLifecycleGenerationCurrent(generation);
  }

  private assertLifecycleGeneration(generation: number): void {
    if (this.isLifecycleGenerationCurrent(generation)) return;
    throw createAbortError("browser remote session start was superseded or closed");
  }

  private updateDataChannelState(label: StreamerDataChannelLabel, nextReadyState: RTCDataChannelState): void {
    // 仅在通道状态真正变化时推送，避免每次发送（鼠标移动/心跳/输入）都触发整页重渲染。
    if (this.state.dataChannels[label] === nextReadyState) return;
    this.setState({
      ...this.state,
      dataChannels: {
        ...this.state.dataChannels,
        [label]: nextReadyState,
      },
    });
  }

  private setState(state: BrowserRemoteSessionState): void {
    this.state = {
      ...state,
      debugEvents: this.debugEvents,
    };
    this.options.onStateChange?.(this.getState());
  }

  private recordDebugEvent(
    kind: BrowserRemoteDebugEventKind,
    summary: string,
    details?: Record<string, unknown>,
  ): void {
    const event: BrowserRemoteDebugEvent = {
      id: this.debugEventId++,
      atMs: this.now(),
      kind,
      summary,
      details: details === undefined ? undefined : dropUndefinedFields(details),
    };
    this.debugEvents = [...this.debugEvents, event].slice(-BrowserRemoteSession.maxDebugEvents);
    this.state = {
      ...this.state,
      debugEvents: this.debugEvents,
    };
    // 注意：调试事件只追加到环形缓冲，不主动推送 React 状态。
    // 高频路径（鼠标移动、控制心跳、回复 EchoRequest、收数据、统计采样）会产生大量调试事件，
    // 若每条都触发 onStateChange 会引发整页重渲染，挤占主线程，进而拖慢/饿死 100ms 控制心跳，
    // 导致受控端判定主控离线而停止推流（“发起控制后画面卡死”）。
    // 真正影响 UI 的状态变化都会经由 setState 单独推送；调试列表会在下一次 setState 或 1.5s 轮询时刷新。
  }

  private applyRemoteDisplayCapability(event: RemoteSignalGatewayEvent): void {
    const displayId = extractRemoteDisplayId(event.payload);
    if (displayId === undefined || displayId === this.remoteDisplayId) return;
    this.remoteDisplayId = displayId;
    this.setState({
      ...this.state,
      remoteDisplayId: displayId,
    });
    this.recordDebugEvent("signal", "记录受控端显示器", { displayId });
  }
}

function isVideoFlowStalled(status: string | undefined): boolean {
  return status === "transport_stalled" || status === "decode_stalled" || status === "presentation_stalled";
}
