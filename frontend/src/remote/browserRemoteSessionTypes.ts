import type { DecodedStreamerCursorShape } from "@uurc/shared/streamer/controlChannelDecode";
import type { StreamerMouseButtonKind } from "@uurc/shared/streamer/inputDesktop";
import type { StreamerSignalControlResult } from "@uurc/shared/streamer/signalControl";
import type { StreamerIceNetworkType } from "@uurc/shared/streamer/signalSoac";
import type { StreamerConnectionPath, StreamerDataChannelLabel } from "@uurc/shared/streamer/transport";
import type {
  RemoteSignalControlRequest,
  RemoteSignalControlResult,
  RemoteSignalSoacRequest,
  RemoteSignalSoacResult,
} from "@uurc/shared/signalGateway/model";

interface BrowserRemoteSessionApi {
  sendSignalControl(input: RemoteSignalControlRequest): Promise<RemoteSignalControlResult>;
  sendSignalSoac(input: RemoteSignalSoacRequest): Promise<RemoteSignalSoacResult>;
}

export interface BrowserRemotePeerConnection {
  connectionState?: RTCPeerConnectionState;
  iceConnectionState?: RTCIceConnectionState;
  iceGatheringState?: RTCIceGatheringState;
  localDescription: RTCSessionDescriptionInit | null;
  remoteDescription: RTCSessionDescriptionInit | null;
  signalingState?: RTCSignalingState;
  onconnectionstatechange: ((event: Event) => void) | null;
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null;
  oniceconnectionstatechange: ((event: Event) => void) | null;
  onicegatheringstatechange: ((event: Event) => void) | null;
  onsignalingstatechange: ((event: Event) => void) | null;
  ontrack: ((event: RTCTrackEvent) => void) | null;
  createDataChannel(label: string): BrowserRemoteDataChannel;
  addTransceiver(kind: "audio" | "video", init?: RTCRtpTransceiverInit): RTCRtpTransceiver;
  createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  close?: () => void;
  getStats?: () => Promise<BrowserRemoteStatsReport>;
  restartIce?: () => void;
}

export interface BrowserRemoteDataChannel {
  label: string;
  readyState: RTCDataChannelState;
  bufferedAmount?: number;
  bufferedAmountLowThreshold?: number;
  binaryType?: BinaryType;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage?: ((event: MessageEvent) => void) | null;
  onbufferedamountlow?: ((event: Event) => void) | null;
  close?: () => void;
  send(data: string | Blob | ArrayBuffer | ArrayBufferView): void;
}

export interface BrowserRemoteSessionOptions {
  api: BrowserRemoteSessionApi;
  createPeerConnection?: (configuration: RTCConfiguration) => BrowserRemotePeerConnection;
  getVideoCodecPreferences?: () => RTCRtpCodec[];
  initialDebugEvents?: readonly BrowserRemoteDebugEvent[];
  now?: () => number;
  onRemoteStream?: (stream: MediaStream) => void;
  onRemoteClipboard?: (text: string) => void;
  onRemoteCursorShape?: (shape: DecodedStreamerCursorShape | null) => void;
  onStateChange?: (state: BrowserRemoteSessionState) => void;
}

export type BrowserRemoteStatsReport = {
  forEach(callback: (value: unknown, key: string) => void): void;
  get?(key: string): unknown;
};

export interface BrowserRemoteSessionStartInput extends RemoteSignalControlRequest {
  iceId?: string;
  iceNetworkType?: StreamerIceNetworkType;
  forceRelay?: boolean;
  gzipSdp?: boolean;
  targetPlatform?: number;
}

export interface BrowserRemoteMousePositionInput {
  absX: number;
  absY: number;
  surfaceWidth?: number;
  surfaceHeight?: number;
}

export interface BrowserRemoteMouseClickInput extends BrowserRemoteMousePositionInput {
  button?: StreamerMouseButtonKind | number;
}

export interface BrowserRemoteMouseMoveOptions {
  critical?: boolean;
}

export interface BrowserRemoteMouseButtonInput {
  action: "mousePress" | "mouseRelease" | "mouseClick";
  button?: StreamerMouseButtonKind | number;
}

export interface BrowserRemoteMouseScrollInput {
  deltaX: number;
  deltaY: number;
}

export interface BrowserRemoteKeyboardInput {
  action: "keyboardPress" | "keyboardRelease" | "keyboardClick";
  value: string | number;
}

export interface BrowserRemoteSelectedCandidatePair {
  localCandidateType?: string;
  remoteCandidateType?: string;
  localAddress?: string;
  remoteAddress?: string;
  protocol?: string;
  bytesReceived?: number;
  bytesSent?: number;
  currentRoundTripTime?: number;
  availableIncomingBitrate?: number;
  availableOutgoingBitrate?: number;
}

export interface BrowserRemoteInboundAudioStats {
  codecId?: string;
  codecMimeType?: string;
  codecPayloadType?: number;
  codecClockRate?: number;
  codecChannels?: number;
  packetsReceived?: number;
  packetsLost?: number;
  bytesReceived?: number;
  jitter?: number;
  jitterBufferDelay?: number;
  jitterBufferEmittedCount?: number;
  totalSamplesReceived?: number;
  concealedSamples?: number;
  silentConcealedSamples?: number;
  totalAudioEnergy?: number;
  audioLevel?: number;
  timestampMs?: number;
}

export interface BrowserRemoteInboundVideoStats {
  id?: string;
  codecId?: string;
  codecMimeType?: string;
  codecPayloadType?: number;
  mid?: string;
  trackIdentifier?: string;
  ssrc?: number;
  decoderImplementation?: string;
  powerEfficientDecoder?: boolean;
  packetsReceived?: number;
  packetsLost?: number;
  bytesReceived?: number;
  framesDecoded?: number;
  framesReceived?: number;
  framesDropped?: number;
  keyFramesDecoded?: number;
  freezeCount?: number;
  totalFreezesDuration?: number;
  pauseCount?: number;
  totalPausesDuration?: number;
  jitterBufferDelay?: number;
  jitterBufferEmittedCount?: number;
  nackCount?: number;
  pliCount?: number;
  firCount?: number;
  frameWidth?: number;
  frameHeight?: number;
  framesPerSecond?: number;
  framesAssembledFromMultiplePackets?: number;
  totalAssemblyTime?: number;
  timestampMs?: number;
}

export interface BrowserRemoteVideoElementSample {
  event: string;
  trackIdentifier?: string;
  currentTimeMs: number;
  presentedFrames?: number;
  totalVideoFrames?: number;
  droppedVideoFrames?: number;
  readyState?: number;
  paused?: boolean;
  ended?: boolean;
  width?: number;
  height?: number;
  errorCode?: number;
  errorMessage?: string;
  errorName?: string;
}

export interface BrowserRemoteAudioElementSample {
  event: string;
  currentTimeMs: number;
  readyState?: number;
  paused?: boolean;
  ended?: boolean;
  muted?: boolean;
  volume?: number;
  autoplayBlocked?: boolean;
  errorName?: string;
}

export interface BrowserRemoteVideoFlowDelta {
  packetsReceived?: number;
  bytesReceived?: number;
  framesDecoded?: number;
  framesReceived?: number;
  framesDropped?: number;
  keyFramesDecoded?: number;
  pliCount?: number;
  nackCount?: number;
  firCount?: number;
  freezeCount?: number;
  sampleIntervalMs?: number;
  candidateBytesReceived?: number;
  candidateBytesSent?: number;
  presentedFrames?: number;
  videoElementFrames?: number;
  videoElementTimeMs?: number;
}

export interface BrowserRemoteVideoFlowDiagnostics {
  status: "waiting" | "receiving" | "decode_stalled" | "presentation_stalled" | "transport_stalled";
  title: string;
  detail: string;
  delta?: BrowserRemoteVideoFlowDelta;
  updatedAtMs: number;
}

export type BrowserRemoteDebugEventKind =
  "session" | "signal" | "data_channel" | "data_send" | "data_recv" | "stats" | "video_element" | "audio_element";

export interface BrowserRemoteDebugEvent {
  id: number;
  atMs: number;
  kind: BrowserRemoteDebugEventKind;
  summary: string;
  details?: Record<string, unknown>;
}

export interface BrowserRemoteSessionState {
  audioElement?: BrowserRemoteAudioElementSample;
  appControlId: string;
  clientId?: string;
  connectionPath: StreamerConnectionPath;
  controlIceIdMatch?: boolean;
  controlResult?: StreamerSignalControlResult;
  controlResultIceId?: string;
  dataChannels: Partial<Record<StreamerDataChannelLabel, RTCDataChannelState>>;
  debugEvents: BrowserRemoteDebugEvent[];
  iceId?: string;
  inboundAudio?: BrowserRemoteInboundAudioStats;
  inboundVideo?: BrowserRemoteInboundVideoStats;
  peerConnectionState?: RTCPeerConnectionState;
  peerIceConnectionState?: RTCIceConnectionState;
  peerIceGatheringState?: RTCIceGatheringState;
  peerSignalingState?: RTCSignalingState;
  remoteTrackCount: number;
  remoteDisplayId?: number;
  remoteInputDisplayId?: number;
  selectedCandidatePair?: BrowserRemoteSelectedCandidatePair;
  stage: "idle" | "controlled" | "offered" | "connected";
  failureReason?: string;
  videoElement?: BrowserRemoteVideoElementSample;
  videoFlow?: BrowserRemoteVideoFlowDiagnostics;
}
