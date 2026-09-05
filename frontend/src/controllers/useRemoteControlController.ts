import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { STREAMER_CLIENT_TYPES } from "@uurc/shared/streamer/connectOptionsModel";
import { analyzeRemoteSignalReadiness } from "@uurc/shared/streamer/readiness";
import { STREAMER_DATA_CHANNEL_LABELS } from "@uurc/shared/streamer/transport";
import type { RuntimeProfile } from "@uurc/shared/runtimeProfile";

import type { RemoteControlContext } from "../app/remoteControlTypes.js";
import { SELF_DEVICE_BLOCKED_REASON } from "../app/remoteControlTypes.js";
import { getRemoteSignalDiagnostics, startRemoteSignalGateway } from "../api/remoteSignalApi.js";
import { getRuntimeProfile } from "../api/runtimeApi.js";
import { getDeviceGroups } from "../uu/roomApi.js";
import type { RemoteControlPageProps } from "../components/RemoteControlPage.js";
import { formatParticipantMeta } from "../devices/deviceLabels.js";
import { createRemoteControlPresentation } from "../remote/remoteControlPresentation.js";
import { isDesktopPlatform } from "../remote/browserRemote/utils.js";
import { remoteShortcutGroupTitleForPlatform } from "../remote/remoteShortcuts.js";
import { formatSignalGatewayErrorHint } from "../remote/remoteSignalUiModel.js";
import { useBrowserRemoteSessionController } from "./useBrowserRemoteSessionController.js";
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
    autoConnect,
    setAutoConnect,
    remoteStageViewMode,
    setRemoteStageViewMode,
    signalServerIndex,
    setSignalServerIndex,
    browserWebRtcUnavailableReason,
  } = useRemoteControlPreferences(remoteBootstrap?.signalServers.length ?? 0);
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
  // 用 participant.clientId 与当前网页控制端的 clientId 比对，区分“占用者是不是自己上一个会话”。
  // 仅当占用者全部是自己时才自动接管；任一占用者是他人则保留显式接管步骤（避免误踢真实控制端）。
  const currentClientId = authStatus?.clientId ?? "";
  const occupiedBySelfClient =
    selectedParticipants.length > 0 &&
    currentClientId.length > 0 &&
    selectedParticipants.every((participant) => participant.clientId === currentClientId);
  const occupiedByOthers = selectedParticipants.some(
    (participant) => !participant.clientId || participant.clientId !== currentClientId,
  );
  const occupyingParticipant =
    selectedParticipants.find((participant) => !participant.clientId || participant.clientId !== currentClientId) ??
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
    stopSignalGateway: handleStopSignalGateway,
  } = createRemoteRoomLifecycle({
    allDevices,
    authDeviceId: authStatus?.deviceId,
    forceJoin,
    selectedDeviceId,
    sdpTransportMode,
    signalServerIndex,
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
  const { autoReconnectAttemptCount, autoReconnectStatus, decodeStalledStreak } = useRemoteRecoveryController({
    autoReconnectEnabled,
    browserRemoteState,
    busy,
    controlChannelState,
    roomJoinedForSelectedDevice: roomJoinedBeforePresentation,
    signalGatewayMatchesRoom: signalGatewayMatchesRoomBeforePresentation,
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
    hasRemoteVideo,
    iceControlStatusLabel,
    inboundAudioStatsLabel,
    inboundVideoStatsLabel,
    inputControlLabel,
    joinModeLabel,
    networkSwitchSummary,
    nextAction,
    normalJoinTakeoverHint,
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
    sdpTransportLabel,
    selectedDeviceIsCurrentAuthDevice,
    selectedTargetLabel,
    serviceRoutePolicyLabel,
    signalGatewayDisplay,
    signalGatewayErrorHint,
    signalGatewayMatchesRoom,
    signalGatewayState,
    signalHeaderSummary,
    signalReadiness,
    signalServerOptions,
    stageStatusLabel,
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
      forceJoin,
      onAutoConnectChange: setAutoConnect,
      onConnectionRouteModeChange: setConnectionRouteMode,
      onForceJoinChange: setForceJoin,
      onSignalServerIndexChange: setSignalServerIndex,
      onSdpTransportModeChange: setSdpTransportMode,
      onStartBrowserRemote: () => void handleStartBrowserRemote(),
      onStartSignalGateway: () => void handleStartSignalGateway(),
      onStopSignalGateway: () => void handleStopSignalGateway(),
      sdpTransportMode,
      selectedDevice,
      selectedParticipants,
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
      iceControlStatusLabel,
      inboundAudioStatsLabel,
      inboundVideoStatsLabel,
      inputControlActive,
      joinModeLabel,
      networkSwitchSummary,
      remoteBootstrap,
      roomDebugPayload,
      roomJoinModeDebugLabel,
      roomReleaseDetail,
      roomReleaseLabel,
      runtimeProfile,
      selectedDevice,
      selectedDeviceId,
      serviceRoutePolicyLabel,
      signalEvents,
      signalGatewayDisplay,
      signalHeaderSummary,
      signalReadiness,
      sdpTransportLabel,
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
