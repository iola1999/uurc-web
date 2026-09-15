import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { STREAMER_CLIENT_TYPES } from "@uurc/shared/streamer/connectOptionsModel";
import { analyzeRemoteSignalReadiness } from "@uurc/shared/streamer/readiness";
import { STREAMER_DATA_CHANNEL_LABELS } from "@uurc/shared/streamer/transport";
import type { RuntimeProfile } from "@uurc/shared/runtimeProfile";

import type { RemoteControlContext } from "../app/remoteControlTypes.js";
import { SELF_DEVICE_BLOCKED_REASON } from "../app/remoteControlTypes.js";
import {
  getRemoteSignalDiagnostics,
  setSignalChannelPreference,
  startRemoteSignalGateway,
} from "../api/remoteSignalApi.js";
import { getRuntimeProfile } from "../api/runtimeApi.js";
import { getDeviceGroups } from "../uu/roomApi.js";
import { getLastSignalSessionClientId, rememberLastSignalSession } from "../uu/lastSignalSessionStore.js";
import type { RemoteControlPageProps } from "../components/RemoteControlPage.js";
import { formatParticipantMeta } from "../devices/deviceLabels.js";
import { createRemoteControlPresentation } from "../remote/remoteControlPresentation.js";
import { isDesktopPlatform } from "../remote/browserRemote/utils.js";
import { remoteShortcutGroupTitleForPlatform } from "../remote/remoteShortcuts.js";
import { formatSignalGatewayErrorHint } from "../remote/remoteSignalUiModel.js";
import { useBrowserRemoteSessionController } from "./useBrowserRemoteSessionController.js";
import { useFingerprintPreferences } from "./useFingerprintPreferences.js";
import { useRemoteAudioController } from "./useRemoteAudioController.js";
import { useRemoteAutoConnect } from "./useRemoteAutoConnect.js";
import { useBusyAction } from "./useBusyAction.js";
import { createRemoteRoomLifecycle, releaseRemoteRoom, waitForRoomRelease } from "./remoteRoomLifecycle.js";
import { useRemoteVideoController } from "./useRemoteVideoController.js";
import { useRemoteControlPreferences } from "./useRemoteControlPreferences.js";
import { useRemoteClipboardController } from "./useRemoteClipboardController.js";
import { useRemoteInputController } from "./useRemoteInputController.js";
import { useRemoteRecoveryController } from "./useRemoteRecoveryController.js";
import { useRoomController } from "./useRoomController.js";
import { useSignalGatewayController } from "./useSignalGatewayController.js";
import { useToastController } from "./useToastController.js";

export function useRemoteControlController(context: RemoteControlContext) {
  const { authStatus, devices, devicesLoaded, handoff, onControlLeave, onDevicesChange } = context;
  const { roomResponse, setRoomResponse, roomJoinContext, setRoomJoinContext, remoteBootstrap, setRemoteBootstrap } =
    useRoomController(handoff);
  const [forceJoin, setForceJoin] = useState(handoff?.roomJoinContext.forceJoin ?? false);
  // 用户主动断开代表这次连接流程已经结束：自动重连和进入设备的自动连接都停手，
  // 直到用户再次发起连接或换一台设备。
  const [autoResumeAllowed, setAutoResumeAllowed] = useState(true);
  const [runtimeProfile, setRuntimeProfile] = useState<RuntimeProfile | null>(null);
  const { busy, error, run, setError } = useBusyAction();
  const { toast, showToast, dismissToast } = useToastController();
  const {
    close: closeBrowserRemoteSession,
    sessionRef: browserRemoteSession,
    start: createBrowserRemoteSession,
    state: browserRemoteState,
    setState: setBrowserRemoteState,
  } = useBrowserRemoteSessionController();
  const remoteStageFrameRef = useRef<HTMLDivElement | null>(null);
  const {
    autoReconnectEnabled,
    setAutoReconnectEnabled,
    sdpTransportMode,
    setSdpTransportMode,
    connectionRouteMode,
    setConnectionRouteMode,
    signalChannelMode,
    setSignalChannelMode,
    directSignalExtensionInfo,
    autoConnect,
    setAutoConnect,
    remoteStageViewMode,
    setRemoteStageViewMode,
    signalServerIndex,
    setSignalServerIndex,
    browserWebRtcUnavailableReason,
  } = useRemoteControlPreferences(remoteBootstrap?.signalServers.length ?? 0);
  // 信令路径偏好同步给 remoteSignalApi 分发层:强制 UU 中转依赖服务端 force_relay,固定走网关
  useEffect(() => {
    setSignalChannelPreference({ channelMode: signalChannelMode, routeMode: connectionRouteMode });
  }, [signalChannelMode, connectionRouteMode]);
  const directSignalExtensionHint = directSignalExtensionInfo
    ? directSignalExtensionInfo.available
      ? `已检测到 Direct Signal 扩展${directSignalExtensionInfo.version ? ` v${directSignalExtensionInfo.version}` : ""}`
      : directSignalExtensionInfo.reason
    : "正在检测 Direct Signal 扩展…";
  const { fingerprint, applyFingerprintPatch, selectFingerprintPreset } = useFingerprintPreferences();
  const {
    signalGatewayContext,
    setSignalGatewayContext,
    signalGatewayStatus,
    setSignalGatewayStatus,
    signalEvents,
    remoteSignalDiagnostics,
    setRemoteSignalDiagnostics,
    resetSignalEvents,
    resetSignalGateway,
    refreshSignalEvents,
  } = useSignalGatewayController({
    browserStage: browserRemoteState.stage,
    browserSessionRef: browserRemoteSession,
    onPollingError: setError,
    onSessionStateChange: setBrowserRemoteState,
  });
  const {
    remoteVideoStreams,
    remoteVideoCount,
    remoteVideoSources,
    primaryRemoteVideoId,
    primaryRemoteVideoActive,
    setSelectedRemoteVideoId,
    handleRemoteMediaStream,
    handleRemoteVideoSample,
    resetRemoteVideos,
  } = useRemoteVideoController({
    browserSessionRef: browserRemoteSession,
    onSessionStateChange: setBrowserRemoteState,
  });
  const { remoteAudio, handleRemoteAudioStream, resetRemoteAudio } = useRemoteAudioController({
    browserSessionRef: browserRemoteSession,
    onSessionStateChange: setBrowserRemoteState,
  });
  const handleRemoteStream = useCallback(
    (stream: MediaStream) => {
      handleRemoteMediaStream(stream);
      handleRemoteAudioStream(stream);
    },
    [handleRemoteAudioStream, handleRemoteMediaStream],
  );
  const navigate = useNavigate();
  const { deviceId: routeSelectedDeviceId = "" } = useParams<{ deviceId: string }>();
  const [searchParams] = useSearchParams();
  const assistanceRoute = searchParams.get("assistance") === "1";
  useEffect(() => {
    if (assistanceRoute && !roomJoinContext) {
      navigate(`/partner?id=${encodeURIComponent(routeSelectedDeviceId)}`, { replace: true });
    }
  }, [assistanceRoute, roomJoinContext, routeSelectedDeviceId, navigate]);

  const releaseContext = useRef(roomJoinContext);
  releaseContext.current = roomJoinContext;
  const leaveControl = useRef(onControlLeave);
  leaveControl.current = onControlLeave;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const contextToRelease = releaseContext.current;
      queueMicrotask(() => {
        if (!mounted.current) {
          leaveControl.current();
          if (contextToRelease) void releaseRemoteRoom(contextToRelease).catch(() => undefined);
        }
      });
    };
  }, []);

  const allDevices = useMemo(
    () => [...devices.desktopDevices, ...devices.mobileDevices, ...devices.tvDevices],
    [devices.desktopDevices, devices.mobileDevices, devices.tvDevices],
  );
  const selectedDeviceId = routeSelectedDeviceId;

  // 换设备就是重新开始一次连接流程，上一台设备上手动断开的终止指令不再适用。
  useEffect(() => {
    setAutoResumeAllowed(true);
  }, [selectedDeviceId]);

  const selectedDevice = useMemo(
    () => allDevices.find((device) => device.deviceId === selectedDeviceId) ?? null,
    [allDevices, selectedDeviceId],
  );
  const deviceTotal = devices.desktopDevices.length + devices.mobileDevices.length + devices.tvDevices.length;
  const localSignalReadiness = useMemo(
    () =>
      analyzeRemoteSignalReadiness({
        events: signalEvents,
        signalStatus: signalGatewayStatus,
      }),
    [signalEvents, signalGatewayStatus],
  );
  const selectedParticipants = selectedDevice?.participantsInfo ?? [];
  const selectedDeviceOccupied = selectedParticipants.length > 0;
  // 占用者是不是自己：登录态 clientId 与上一个信令会话的 clientId 都算「自己」。
  // 网关加入 UU 房间时不发送 client_id，信令服务器按连接分配，所以刷新后只能靠本地记住的上一个会话值来认。
  // 仅当占用者全部是自己时才自动接管；任一占用者是他人则保留显式接管步骤（避免误踢真实控制端）。
  const currentClientId = authStatus?.clientId ?? "";
  const previousSessionClientId = useMemo(() => getLastSignalSessionClientId(selectedDeviceId), [selectedDeviceId]);
  const selfClientIds = useMemo(
    () => [currentClientId, previousSessionClientId].filter((clientId) => clientId.length > 0),
    [currentClientId, previousSessionClientId],
  );
  const sessionClientId = browserRemoteState.clientId ?? "";
  const sessionUserId = authStatus?.userId ?? "";
  useEffect(() => {
    if (!sessionClientId || !selectedDeviceId) return;
    rememberLastSignalSession({ clientId: sessionClientId, deviceId: selectedDeviceId, userId: sessionUserId });
  }, [selectedDeviceId, sessionClientId, sessionUserId]);
  const occupiedBySelfClient =
    selectedParticipants.length > 0 &&
    selfClientIds.length > 0 &&
    selectedParticipants.every(
      (participant) => participant.clientId.length > 0 && selfClientIds.includes(participant.clientId),
    );
  const occupiedByOthers = selectedParticipants.some(
    (participant) => !participant.clientId || !selfClientIds.includes(participant.clientId),
  );
  const occupyingParticipant =
    selectedParticipants.find(
      (participant) => !participant.clientId || !selfClientIds.includes(participant.clientId),
    ) ??
    selectedParticipants[0] ??
    null;
  const occupyingParticipantLabel = occupyingParticipant
    ? occupyingParticipant.alias
      ? `${occupyingParticipant.alias}（${formatParticipantMeta(occupyingParticipant)}）`
      : formatParticipantMeta(occupyingParticipant) || "其他控制端"
    : "其他控制端";
  const textChannelState = browserRemoteState.dataChannels[STREAMER_DATA_CHANNEL_LABELS.text] ?? "closed";
  const fileChannelState = browserRemoteState.dataChannels[STREAMER_DATA_CHANNEL_LABELS.file] ?? "closed";
  const controlChannelState = browserRemoteState.dataChannels[STREAMER_DATA_CHANNEL_LABELS.control] ?? "closed";
  const remoteClipboardReadEnabled =
    (roomJoinContext?.kind === "remote_assistance" ? roomJoinContext.targetPlatform : selectedDevice?.platform) ===
    STREAMER_CLIENT_TYPES.Client_MAC;
  const {
    clipboardSyncEnabled,
    clipboardSyncAvailable,
    localClipboardStatusLabel,
    remoteClipboardStatusLabel,
    remoteClipboardPendingText,
    canReadLocalClipboard,
    canSendClipboardText,
    canCopyRemoteClipboard,
    resetClipboardSession,
    handleClipboardSyncEnabledChange,
    handleRemoteClipboard,
    handleReadLocalClipboard,
    handleSendClipboardText,
    handleCopyRemoteClipboard,
  } = useRemoteClipboardController({
    browserSessionRef: browserRemoteSession,
    sessionKey: selectedDeviceId,
    fileChannelState,
    remoteClipboardReadEnabled,
    textChannelState,
    onError: setError,
    onSessionStateChange: setBrowserRemoteState,
    showToast,
  });
  const {
    inputControlActive,
    isFullscreen,
    remoteStageRef,
    handleRemoteCursorShape,
    resetRemoteCursor,
    enableInputControl,
    resetInputControl,
    handleRemoteShortcut,
    handleToggleFullscreen,
    handleToggleInputControl,
    handleRemoteStagePointerDown,
    handleRemoteStagePointerMove,
    handleRemoteStagePointerUp,
    handleRemoteStagePointerCancel,
    handleRemoteStageWheel,
    handleRemoteStageKeyDown,
    handleRemoteStageKeyUp,
    handleRemoteStageBlur,
    handleRemoteStagePaste,
  } = useRemoteInputController({
    browserSessionRef: browserRemoteSession,
    controlChannelState,
    targetPlatform: resolveTargetPlatform(),
    primaryRemoteVideoId,
    remoteStageViewMode,
    onError: setError,
    onSessionStateChange: setBrowserRemoteState,
  });
  useEffect(() => {
    let active = true;
    void getRuntimeProfile()
      .then((runtime) => {
        if (active) setRuntimeProfile(runtime);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function loadDevices() {
    await run("devices", async () => {
      onDevicesChange(await getDeviceGroups());
    });
  }

  const {
    joinRoomForDevice,
    startSignalGateway: handleStartSignalGateway,
    stopSignalGateway: stopSignalGatewayFlow,
  } = createRemoteRoomLifecycle({
    allDevices,
    authDeviceId: authStatus?.deviceId,
    forceJoin,
    selectedDeviceId,
    sdpTransportMode,
    signalServerIndex,
    streamerVersion: fingerprint.streamerVersion,
    roomJoinContext,
    isActive: () => mounted.current,
    run,
    onDevicesChange,
    onForceJoinChange: setForceJoin,
    resetBrowserRemoteSession,
    resetSignalEvents,
    resetSignalGateway,
    setRemoteBootstrap,
    setRemoteSignalDiagnostics,
    setRoomJoinContext,
    setRoomResponse,
    setSignalGatewayContext,
    setSignalGatewayStatus,
    showToast,
  });

  // 手动断开是用户对这次连接流程的终止指令：排期中的自动重连随之作废，
  // 自动连接也不能在断开之后又把会话拉起来。
  async function handleStopSignalGateway() {
    setAutoResumeAllowed(false);
    await stopSignalGatewayFlow();
  }

  async function handleReturnToDevices() {
    if (busy !== null) return;
    // 仅在确有可断开的活动连接时才二次确认；已手动断开（canDisconnectRemote 为 false）后直接返回，
    // 不再因残留的 roomJoinContext 误弹“将断开远控”确认框。
    const hasActiveSession = canDisconnectRemote;
    if (hasActiveSession) {
      const message =
        roomJoinContext?.kind === "remote_assistance"
          ? "返回将断开当前远控并取消本次远程协助，确定返回？"
          : "返回将断开当前远控并释放 UU 房间占用，确定返回？";
      if (typeof window !== "undefined" && !window.confirm(message)) return;
      await handleStopSignalGateway();
    }
    onControlLeave();
    navigate("/devices");
  }

  function resetBrowserRemoteSession() {
    closeBrowserRemoteSession();
    resetClipboardSession();
    resetRemoteCursor();
    resetInputControl();
    resetRemoteVideos();
    resetRemoteAudio();
  }

  async function startBrowserRemoteSession(options: { skipReadinessCheck?: boolean; forceRelay?: boolean } = {}) {
    await waitForRoomRelease();
    if (!mounted.current) return;
    if (browserWebRtcUnavailableReason) throw new Error(browserWebRtcUnavailableReason);
    if (!authStatus?.deviceId) throw new Error("登录已失效");
    if (!selectedDeviceId) throw new Error("请选择设备");
    if (!options.skipReadinessCheck && !roomReadyForBrowserRtc) throw new Error(browserRtcBlockedReason);
    resetInputControl();
    resetClipboardSession();
    const targetPlatform = resolveTargetPlatform();
    const session = await createBrowserRemoteSession({
      deviceId: authStatus.deviceId,
      fingerprint,
      forceRelay: options.forceRelay ?? (connectionRouteMode === "relay" ? true : undefined),
      gzipSdp: sdpTransportMode === "gzip",
      remoteAssistance: roomJoinContext?.kind === "remote_assistance",
      targetPlatform,
      onRemoteStream: handleRemoteStream,
      onRemoteClipboard: handleRemoteClipboard,
      onRemoteCursorShape: handleRemoteCursorShape,
    });
    await refreshSignalEvents(session);
  }

  async function handleStartBrowserRemote(options: { skipReadinessCheck?: boolean } = {}) {
    await run("browser-remote-start", async () => {
      await startBrowserRemoteSession(options);
    });
  }

  async function handleReconnectRemote(attemptCount = autoReconnectAttemptCount) {
    await run("reconnect", async () => {
      resetBrowserRemoteSession();
      // 自动切换方案：默认“自动路径”多次重连仍失败时，升级为强制 UU 中转以提升成功率。
      const escalateRelay = connectionRouteMode === "auto" && attemptCount >= 2;
      if (!signalGatewayMatchesRoom) {
        if (roomJoinContext?.kind !== "remote_assistance") {
          const joined = await joinRoomForDevice(selectedDeviceId, roomJoinContext?.forceJoin ?? false);
          if (!joined) throw new Error("重新加入房间失败，请重试");
        }
        if (!mounted.current) return;
        resetSignalEvents();
        const status = await startRemoteSignalGateway({
          gzipSdp: sdpTransportMode === "gzip",
          signalServerIndex: signalServerIndex > 0 ? signalServerIndex : undefined,
          streamerVersion: fingerprint.streamerVersion,
        }).catch((caught) => {
          if (
            roomJoinContext?.kind === "remote_assistance" &&
            caught instanceof Error &&
            caught.message.includes("Join the room")
          )
            setRoomJoinContext(null);
          throw caught;
        });
        if (!mounted.current) return;
        setSignalGatewayStatus(status);
        setSignalGatewayContext(status.status === "connected" ? roomJoinContext : null);
        setRemoteSignalDiagnostics(await getRemoteSignalDiagnostics());
        if (status.status !== "connected") {
          if (roomJoinContext?.kind === "remote_assistance" && status.error?.includes("Join the room"))
            setRoomJoinContext(null);
          throw new Error(formatSignalGatewayErrorHint(status) || "连接服务未启动");
        }
      }
      await startBrowserRemoteSession({ skipReadinessCheck: true, forceRelay: escalateRelay ? true : undefined });
    });
  }

  async function handleNextAction(force = forceJoin) {
    if (busy !== null) return;
    // 用户重新发起连接，自动恢复重新生效。
    setAutoResumeAllowed(true);
    if (!loggedIn) {
      setError("请先登录");
      return;
    }
    if (!selectedDeviceId || (deviceTotal === 0 && roomJoinContext?.kind !== "remote_assistance")) {
      await loadDevices();
      return;
    }
    if (browserWebRtcUnavailableReason) {
      setError(browserWebRtcUnavailableReason);
      return;
    }
    if (!roomJoinedForSelectedDevice || roomRequiresTakeover || signalGatewayState === "error") {
      // 自己上一个会话占用时直接接管（force），无需用户再点一次；他人占用仍保留显式两步。
      const joinWithForce = roomRequiresTakeover || occupiedBySelfClient ? true : force;
      const nextContext = await joinRoomForDevice(selectedDeviceId, joinWithForce);
      if (!nextContext || (nextContext.occupiedAtJoin && !nextContext.forceJoin)) return;
      const status = await handleStartSignalGateway(nextContext);
      if (status?.status === "connected") {
        await handleStartBrowserRemote({ skipReadinessCheck: true });
      }
      return;
    }
    if (!signalGatewayMatchesRoom) {
      const status = await handleStartSignalGateway();
      if (status?.status === "connected") {
        await handleStartBrowserRemote({ skipReadinessCheck: true });
      }
      return;
    }
    if (browserRemoteState.stage === "idle") {
      await handleStartBrowserRemote();
      return;
    }
    if (browserConnectionRecoverable) {
      await handleReconnectRemote();
      return;
    }
    if (!inputControlActive && controlChannelState === "open") {
      enableInputControl();
      return;
    }
  }

  function resolveTargetPlatform(): number | undefined {
    return roomJoinContext?.kind === "remote_assistance" ? roomJoinContext.targetPlatform : selectedDevice?.platform;
  }

  const loggedIn = Boolean(authStatus?.hasState);
  const signalGatewayStateBeforePresentation = signalGatewayStatus?.status ?? "idle";
  const roomJoinedBeforePresentation =
    roomJoinContext?.deviceId === selectedDeviceId && Boolean(roomResponse?.roomConfigSummary);
  const signalGatewayMatchesRoomBeforePresentation =
    signalGatewayStateBeforePresentation === "connected" &&
    signalGatewayContext?.deviceId === roomJoinContext?.deviceId &&
    signalGatewayContext?.forceJoin === roomJoinContext?.forceJoin &&
    (signalGatewayContext?.kind ?? "owned_device") === (roomJoinContext?.kind ?? "owned_device");
  const { autoReconnectAttemptCount, autoReconnectStatus, autoReconnectStopped, decodeStalledStreak } =
    useRemoteRecoveryController({
      autoReconnectEnabled,
      browserRemoteState,
      busy,
      controlChannelState,
      roomJoinedForSelectedDevice: roomJoinedBeforePresentation,
      signalGatewayMatchesRoom: signalGatewayMatchesRoomBeforePresentation,
      resumeAllowed: autoResumeAllowed,
      onReconnect: handleReconnectRemote,
    });
  const presentation = createRemoteControlPresentation({
    authDeviceId: authStatus?.deviceId,
    autoReconnectEnabled,
    autoReconnectStatus,
    browserRemoteState,
    browserWebRtcUnavailableReason,
    busy,
    connectionRouteMode,
    controlChannelState,
    decodeStalledStreak,
    devices,
    devicesLoaded,
    fingerprint,
    forceJoin,
    inputControlActive,
    localSignalReadiness,
    remoteBootstrap,
    remoteSignalDiagnostics,
    remoteVideoCount,
    roomJoinContext,
    roomResponse,
    sdpTransportMode,
    selectedDevice,
    selectedDeviceId,
    selectedDeviceOccupied,
    signalEvents,
    signalGatewayContext,
    signalGatewayStatus,
    textChannelState,
  });
  const {
    audioPlaybackLabel,
    autoReconnectLabel,
    autoSwitchThresholdLabel,
    browserConnectionRecoverable,
    browserIceServers,
    browserRtcBlockedReason,
    browserRtcReady,
    browserStageLabel,
    canDisconnectRemote,
    candidatePairSummary,
    connectionPathLabel,
    connectionQuality,
    controlChannelLabel,
    deviceNotFound,
    effectiveConnectionRouteLabel,
    fingerprintSummary,
    hasRemoteVideo,
    iceControlStatusLabel,
    inboundAudioStatsLabel,
    inboundVideoStatsLabel,
    inputControlLabel,
    joinModeLabel,
    networkSwitchSummary,
    nextAction,
    normalJoinTakeoverHint,
    publisherNetworkLabel,
    remoteAssistanceActive,
    remoteRecoveryLabel,
    roomDebugPayload,
    roomJoinedForSelectedDevice,
    roomJoinFailureMessage,
    roomJoinModeDebugLabel,
    roomReadyForBrowserRtc,
    roomReleaseDetail,
    roomReleaseLabel,
    roomRequiresTakeover,
    routingDecisionLabel,
    sdpTransportLabel,
    selectedDeviceIsCurrentAuthDevice,
    selectedTargetLabel,
    serviceRoutePolicyLabel,
    signalEventDump,
    signalGatewayDisplay,
    signalGatewayErrorHint,
    signalGatewayMatchesRoom,
    signalGatewayState,
    signalHeaderSummary,
    signalPathLabel,
    signalReadiness,
    signalServerOptions,
    stageStatusLabel,
    subscriberNetworkLabel,
    textChannelLabel,
    unexpectedSignalEventSummary,
    videoElementLabel,
    videoFlowLabel,
  } = presentation;
  const selfDeviceBlockedReason = selectedDeviceIsCurrentAuthDevice ? SELF_DEVICE_BLOCKED_REASON : "";
  const browserRtcDescription = browserRemoteState.controlResult ? "连接许可已确认" : "等待连接确认";
  const debugEvents = browserRemoteState.debugEvents;
  useRemoteAutoConnect({
    autoConnect,
    browserStage: browserRemoteState.stage,
    busy,
    devicesLoaded,
    loggedIn,
    occupiedByOthers,
    remoteAssistanceActive,
    resumeAllowed: autoResumeAllowed,
    selectedDeviceExists: selectedDevice !== null,
    selectedDeviceId,
    selectedDeviceIsCurrentAuthDevice,
    signalGatewayState,
    onConnect: handleNextAction,
  });

  const remoteShortcutPlatform = remoteShortcutGroupTitleForPlatform(resolveTargetPlatform());
  const canSendText =
    inputControlActive &&
    controlChannelState === "open" &&
    (isDesktopPlatform(resolveTargetPlatform()) || textChannelState === "open");
  const controlPageProps: RemoteControlPageProps = {
    shell: {
      deviceNotFound,
      error,
      isFullscreen,
      onReturnToDevices: () => void handleReturnToDevices(),
      remoteStageFrameRef,
    },
    topbar: {
      browserRemoteState,
      busy,
      canDisconnectRemote,
      onReturnToDevices: () => void handleReturnToDevices(),
      onStopSignalGateway: () => void handleStopSignalGateway(),
      selectedDevice,
      selectedTargetLabel,
      signalGatewayDisplay,
    },
    commandBar: {
      busy,
      controlChannelState,
      inputControlActive,
      isFullscreen,
      nextAction,
      onNextAction: (force) => void handleNextAction(force),
      onRemoteShortcut: handleRemoteShortcut,
      onStageViewModeChange: setRemoteStageViewMode,
      onToggleInputControl: handleToggleInputControl,
      onToggleFullscreen: handleToggleFullscreen,
      canSendText,
      onSendText: (text) => {
        const session = browserRemoteSession.current;
        if (!session || !canSendText) return false;
        try {
          session.sendPastedText(text);
          setBrowserRemoteState(session.getState());
          return true;
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught));
          return false;
        }
      },
      remoteAudio,
      remoteShortcutPlatform,
      remoteStageViewMode,
    },
    reconnect: {
      autoReconnectAttemptCount,
      autoReconnectStopped,
      busy,
      canReconnectRemote: browserConnectionRecoverable,
      onReconnectRemote: () => void handleReconnectRemote(),
      remoteRecoveryLabel,
    },
    stage: {
      browserRemoteState,
      browserStageLabel,
      hasRemoteVideo,
      inputControlActive,
      inputControlLabel,
      onRemoteStageKeyDown: handleRemoteStageKeyDown,
      onRemoteStageKeyUp: handleRemoteStageKeyUp,
      onRemoteStageBlur: handleRemoteStageBlur,
      onRemoteStagePaste: handleRemoteStagePaste,
      onRemoteStagePointerCancel: handleRemoteStagePointerCancel,
      onRemoteStagePointerDown: handleRemoteStagePointerDown,
      onRemoteStagePointerMove: handleRemoteStagePointerMove,
      onRemoteStagePointerUp: handleRemoteStagePointerUp,
      onRemoteStageWheel: handleRemoteStageWheel,
      onRemoteVideoSample: handleRemoteVideoSample,
      primaryRemoteVideoActive,
      primaryRemoteVideoId,
      remoteStageRef,
      remoteStageViewMode,
      remoteVideoCount,
      remoteVideoStreams,
      selectedDevice,
      stageStatusLabel,
      videoFlowLabel,
    },
    warnings: {
      browserWebRtcUnavailableReason,
      forceJoin,
      normalJoinTakeoverHint,
      occupiedBySelfClient,
      occupyingParticipantLabel,
      roomJoinFailureMessage,
      selectedDeviceOccupied,
      selfDeviceBlockedReason,
      signalGatewayErrorHint,
    },
    insights: {
      quality: {
        autoReconnectEnabled,
        autoReconnectLabel,
        connectionQuality,
        onAutoReconnectEnabledChange: setAutoReconnectEnabled,
      },
      clipboard: {
        canCopyRemoteClipboard,
        canReadLocalClipboard,
        canSendClipboardText,
        clipboardSyncAvailable,
        clipboardSyncEnabled,
        localClipboardStatusLabel,
        remoteClipboardPendingText,
        remoteClipboardStatusLabel,
        onClipboardSyncEnabledChange: handleClipboardSyncEnabledChange,
        onCopyRemoteClipboard: handleCopyRemoteClipboard,
        onReadLocalClipboard: () => void handleReadLocalClipboard(),
        onSendClipboardText: handleSendClipboardText,
      },
      videoSources: {
        onRemoteVideoSourceChange: setSelectedRemoteVideoId,
        primaryRemoteVideoId,
        remoteVideoSources,
      },
    },
    settings: {
      autoConnect,
      browserRtcReady,
      busy,
      connectionRouteMode,
      directSignalExtensionHint,
      fingerprint,
      forceJoin,
      onAutoConnectChange: setAutoConnect,
      onConnectionRouteModeChange: setConnectionRouteMode,
      onFingerprintPatch: applyFingerprintPatch,
      onFingerprintPreset: selectFingerprintPreset,
      onForceJoinChange: setForceJoin,
      onSignalChannelModeChange: setSignalChannelMode,
      onSignalServerIndexChange: setSignalServerIndex,
      onSdpTransportModeChange: setSdpTransportMode,
      onStartBrowserRemote: () => void handleStartBrowserRemote(),
      onStartSignalGateway: () => void handleStartSignalGateway(),
      onStopSignalGateway: () => void handleStopSignalGateway(),
      sdpTransportMode,
      selectedDevice,
      selectedParticipants,
      signalChannelMode,
      signalServerIndex,
      signalServerOptions,
    },
    diagnostics: {
      audioPlaybackLabel,
      autoSwitchThresholdLabel,
      browserIceServers,
      browserRemoteState,
      browserRtcDescription,
      browserStageLabel,
      candidatePairSummary,
      connectionPathLabel,
      controlChannelLabel,
      debugEvents,
      effectiveConnectionRouteLabel,
      fingerprintSummary,
      iceControlStatusLabel,
      inboundAudioStatsLabel,
      inboundVideoStatsLabel,
      inputControlActive,
      joinModeLabel,
      networkSwitchSummary,
      publisherNetworkLabel,
      remoteBootstrap,
      roomDebugPayload,
      roomJoinModeDebugLabel,
      roomReleaseDetail,
      roomReleaseLabel,
      routingDecisionLabel,
      runtimeProfile,
      selectedDevice,
      selectedDeviceId,
      serviceRoutePolicyLabel,
      signalEventDump,
      signalEvents,
      signalGatewayDisplay,
      signalHeaderSummary,
      signalPathLabel,
      signalReadiness,
      sdpTransportLabel,
      subscriberNetworkLabel,
      textChannelLabel,
      unexpectedSignalEventSummary,
      videoElementLabel,
      videoFlowLabel,
    },
  };

  return {
    toast,
    onDismissToast: dismissToast,
    page: controlPageProps,
  };
}
