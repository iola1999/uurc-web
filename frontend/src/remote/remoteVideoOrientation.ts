// 画面方向：被控端通过 RTP 的 urn:3gpp:video-orientation（CVO）逐帧上报屏幕方向，浏览器收到后会按这个
// 角度渲染，页面拿到的 <video> 已经是转过的。这里描述的是在浏览器渲染结果之上还要不要再转。
// 画面转正之后，屏幕上的位置就等于被控端桌面上的位置，所以指针坐标不按方向做换算；只有 90° 和 270°
// 会换掉画面在屏幕上的长宽，几何需要跟着换。
export type RemoteVideoRotation = 0 | 90 | 180 | 270;
// 旋转设置比实际角度多一个 auto：按被控端上报的方向自动摆正。选了具体角度就按该角度显示，不再自动判断。
export type RemoteVideoRotationSetting = RemoteVideoRotation | "auto";
export type RemoteVideoFlip = "none" | "horizontal" | "vertical";

// 面板上选的、按被控端记住的设置。
export interface RemoteVideoOrientationSetting {
  rotation: RemoteVideoRotationSetting;
  flip: RemoteVideoFlip;
}

// 解析后实际作用在画面图层上的方向，输入几何读的也是它。
export interface RemoteVideoOrientation {
  rotation: RemoteVideoRotation;
  flip: RemoteVideoFlip;
}

export const DEFAULT_REMOTE_VIDEO_ORIENTATION_SETTING: RemoteVideoOrientationSetting = {
  rotation: "auto",
  flip: "none",
};

const ROTATIONS: RemoteVideoRotation[] = [0, 90, 180, 270];
const FLIPS: RemoteVideoFlip[] = ["none", "horizontal", "vertical"];

export function normalizeRemoteVideoOrientationSetting(value: unknown): RemoteVideoOrientationSetting {
  if (!value || typeof value !== "object") return { ...DEFAULT_REMOTE_VIDEO_ORIENTATION_SETTING };
  const candidate = value as { rotation?: unknown; flip?: unknown };
  const rotation = ROTATIONS.includes(candidate.rotation as RemoteVideoRotation)
    ? (candidate.rotation as RemoteVideoRotation)
    : DEFAULT_REMOTE_VIDEO_ORIENTATION_SETTING.rotation;
  const flip = FLIPS.includes(candidate.flip as RemoteVideoFlip)
    ? (candidate.flip as RemoteVideoFlip)
    : DEFAULT_REMOTE_VIDEO_ORIENTATION_SETTING.flip;
  return { rotation, flip };
}

export function isDefaultRemoteVideoOrientationSetting(setting: RemoteVideoOrientationSetting): boolean {
  return setting.rotation === "auto" && setting.flip === "none";
}

export interface RemoteVideoSize {
  width?: number;
  height?: number;
}

// 判断浏览器已经把画面转过多少的两个来源。
export interface RemoteVideoRotationSignals {
  // 探针从轨道副本上读到的逐帧上报角度，浏览器渲染时已经按它转过。
  reportedRotation?: RemoteVideoRotation;
  // <video> 的 videoWidth/videoHeight，浏览器转过之后的尺寸。
  elementSize?: RemoteVideoSize;
  // getStats 里 inbound-rtp 的 frameWidth/frameHeight，解码出来、转之前的尺寸。
  decodedSize?: RemoteVideoSize;
}

export function resolveRemoteVideoOrientation(
  setting: RemoteVideoOrientationSetting,
  signals: RemoteVideoRotationSignals,
): RemoteVideoOrientation {
  if (setting.rotation !== "auto") return { rotation: setting.rotation, flip: setting.flip };
  return { rotation: browserRotatedQuarterTurn(signals) ? 180 : 0, flip: setting.flip };
}

// UU 的发送端在写进 CVO 之前把角度做了一次 90↔270 互换（libstreamer 里的 streamer::capture::ReverseRotation，
// 用在 VideoPreprocessSource::OnFrame），接收端没有再反回来，它自己的客户端按相反的约定解释，两边自洽。
// 浏览器按 WebRTC 标准的顺时针方向渲染，于是被控端屏幕转过 90° 或 270° 时画面整体差 180°，0° 和 180° 不差。
// 也就是说只要知道浏览器转的是不是 90/270 就够了，具体是哪个角度不影响补多少。
function browserRotatedQuarterTurn(signals: RemoteVideoRotationSignals): boolean {
  const { reportedRotation, elementSize, decodedSize } = signals;
  if (reportedRotation !== undefined) return reportedRotation === 90 || reportedRotation === 270;
  // 探针读不到时（Firefox、Safari 没有 MediaStreamTrackProcessor）改看尺寸：浏览器只在 90° 和 270° 下
  // 交换 <video> 的宽高。正方形画面区分不出来，按没转处理，剩下的交给手动选角度。
  if (!elementSize?.width || !elementSize.height || !decodedSize?.width || !decodedSize.height) return false;
  return (
    elementSize.width === decodedSize.height &&
    elementSize.height === decodedSize.width &&
    elementSize.width !== elementSize.height
  );
}

// 远端 SDP 里画面方向扩展的协商结果。known=false 表示远端还没给出 SDP，此时不能判断「没协商」。
export interface RemoteVideoOrientationNegotiation {
  known: boolean;
  extensionId?: number;
}

// 从 SDP 里找 urn:3gpp:video-orientation 的 extmap id。浏览器默认会提议它，是否真的进到会话里取决于被控端。
export function parseRemoteVideoOrientationExtensionId(sdp: string | undefined): number | undefined {
  if (!sdp) return undefined;
  for (const line of sdp.split(/\r\n|\n|\r/)) {
    const match = line.match(/^a=extmap:(\d+)(?:\/\w+)?\s+urn:3gpp:video-orientation\s*$/i);
    if (match) return Number(match[1]);
  }
  return undefined;
}

// 诊断用：把「远端上报了什么」「浏览器转成了什么尺寸」「设置是什么」「最后画面转了多少」压成一行。
export function formatRemoteVideoOrientationDiagnostics(input: {
  setting: RemoteVideoOrientationSetting;
  resolved: RemoteVideoOrientation;
  signals: RemoteVideoRotationSignals;
  probeAvailable: boolean;
  extension: RemoteVideoOrientationNegotiation;
}): string {
  const parts = [
    input.signals.reportedRotation === undefined
      ? input.probeAvailable
        ? "远端上报=未读到"
        : "远端上报=不可读"
      : `远端上报=${input.signals.reportedRotation}°`,
    !input.extension.known
      ? undefined
      : input.extension.extensionId === undefined
        ? "未协商方向扩展"
        : `已协商 id=${input.extension.extensionId}`,
    formatSize("元素", input.signals.elementSize),
    formatSize("解码", input.signals.decodedSize),
    `设置=${input.setting.rotation === "auto" ? "跟随" : `${input.setting.rotation}°`}`,
    `画面=${input.resolved.rotation}°/${formatFlip(input.resolved.flip)}`,
  ];
  return parts.filter((item): item is string => item !== undefined).join(" · ");
}

function formatSize(label: string, size: RemoteVideoSize | undefined): string | undefined {
  if (!size?.width || !size.height) return undefined;
  return `${label}=${size.width}x${size.height}`;
}

function formatFlip(flip: RemoteVideoFlip): string {
  if (flip === "horizontal") return "左右翻转";
  if (flip === "vertical") return "上下翻转";
  return "不翻转";
}
