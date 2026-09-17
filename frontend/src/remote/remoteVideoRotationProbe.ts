import type { RemoteVideoRotation } from "./remoteVideoOrientation.js";

// 远端在 RTP 的 urn:3gpp:video-orientation 里逐帧上报画面方向，浏览器会解析它并直接按该角度渲染。
// 页面 JS 拿不到这个值，只能从收到的帧上读：MediaStreamTrackProcessor 交付的 VideoFrame 带 rotation。
// 处理器会独占轨道，所以探针跑在 track.clone() 出来的副本上，原始轨道继续供画面渲染。
export interface RemoteVideoRotationProbe {
  stop(): void;
}

export interface StartRemoteVideoRotationProbeOptions {
  track: MediaStreamTrack;
  onRotation(rotation: RemoteVideoRotation): void;
  maxFrames?: number;
}

// WebCodecs 的 VideoFrame 在当前的 TS DOM 类型里没有 rotation，浏览器的 MediaStreamTrackProcessor 也未收录，这里补最小声明。
interface RotationCarryingVideoFrame {
  rotation: number;
  close(): void;
}

interface VideoFrameTrackProcessor {
  readable: ReadableStream<RotationCarryingVideoFrame>;
}

type VideoFrameTrackProcessorConstructor = new (init: { track: MediaStreamTrack }) => VideoFrameTrackProcessor;

interface RemoteVideoRotationProbeScope {
  MediaStreamTrackProcessor?: VideoFrameTrackProcessorConstructor;
  MediaStreamTrack?: { prototype?: { clone?: unknown } };
}

interface ProbeConstructors {
  createProcessor?: (track: MediaStreamTrack) => VideoFrameTrackProcessor;
  cloneTrack?: (track: MediaStreamTrack) => MediaStreamTrack;
}

// 采样预算：够覆盖一次方向变化，又不至于长期占着轨道副本。
const DEFAULT_MAX_FRAMES = 40;

function probeScope(): RemoteVideoRotationProbeScope {
  return globalThis as unknown as RemoteVideoRotationProbeScope;
}

export function isRemoteVideoRotationProbeSupported(): boolean {
  const scope = probeScope();
  return (
    typeof scope.MediaStreamTrackProcessor === "function" &&
    typeof scope.MediaStreamTrack?.prototype?.clone === "function"
  );
}

export function startRemoteVideoRotationProbe(
  options: StartRemoteVideoRotationProbeOptions,
  constructors: ProbeConstructors = {},
): RemoteVideoRotationProbe | null {
  const scope = probeScope();
  const ProcessorConstructor = scope.MediaStreamTrackProcessor;
  const createProcessor =
    constructors.createProcessor ??
    (ProcessorConstructor ? (track: MediaStreamTrack) => new ProcessorConstructor({ track }) : undefined);
  if (!createProcessor) return null;

  let clone: MediaStreamTrack;
  try {
    clone = constructors.cloneTrack ? constructors.cloneTrack(options.track) : options.track.clone();
  } catch {
    // 克隆失败时放弃探针，画面继续按浏览器的渲染走。
    return null;
  }

  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
  let stopped = false;
  let reader: ReadableStreamDefaultReader<RotationCarryingVideoFrame> | null = null;
  let observed = 0;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    reader?.cancel().catch(() => undefined);
    reader = null;
    clone.stop();
  };

  try {
    reader = createProcessor(clone).readable.getReader();
  } catch {
    stop();
    return null;
  }

  const activeReader = reader;
  void (async () => {
    while (!stopped) {
      if (observed >= maxFrames) {
        stop();
        return;
      }
      let frame: RotationCarryingVideoFrame | undefined;
      try {
        const chunk = await activeReader.read();
        if (chunk.done) break;
        frame = chunk.value;
      } catch {
        break;
      }
      if (!frame) continue;
      observed += 1;
      options.onRotation(normalizeFrameRotation(frame.rotation));
      frame.close();
    }
    stop();
  })();

  return { stop };
}

function normalizeFrameRotation(value: number): RemoteVideoRotation {
  if (value === 90 || value === 180 || value === 270) return value;
  return 0;
}
