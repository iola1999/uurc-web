import { Volume1, Volume2, VolumeX } from "lucide-react";
import type { RefObject } from "react";

import type { RemoteAudioPlaybackState } from "../app/remoteControlTypes.js";

export interface RemoteAudioControlProps {
  elementRef: RefObject<HTMLAudioElement | null>;
  available: boolean;
  muted: boolean;
  volume: number;
  playbackState: RemoteAudioPlaybackState;
  playbackErrorName: string;
  onToggleMuted: () => void;
  onVolumeChange: (volume: number) => void;
  onResumePlayback: () => void;
}

export function RemoteAudioControl({
  elementRef,
  available,
  muted,
  volume,
  playbackState,
  playbackErrorName,
  onToggleMuted,
  onVolumeChange,
  onResumePlayback,
}: RemoteAudioControlProps) {
  const resumeRequired = playbackState === "blocked" || playbackState === "error";
  const buttonLabel = resumeRequired
    ? playbackState === "blocked"
      ? "播放远程声音"
      : "重试远程声音"
    : muted
      ? "开启远程声音"
      : "静音远程声音";
  const Icon = muted || resumeRequired || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="remote-audio-control" data-playback-state={playbackState}>
      <audio ref={elementRef} preload="auto" playsInline hidden />
      <button
        type="button"
        className={resumeRequired ? "remote-audio-button is-attention" : "remote-audio-button"}
        aria-label={buttonLabel}
        aria-pressed={resumeRequired ? undefined : muted}
        title={playbackErrorName ? `${buttonLabel} (${playbackErrorName})` : buttonLabel}
        disabled={!available}
        onClick={resumeRequired ? onResumePlayback : onToggleMuted}
      >
        <Icon size={14} />
      </button>
      <input
        className="remote-volume-slider"
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={volume}
        aria-label="远程音量"
        aria-valuetext={`${Math.round(volume * 100)}%`}
        title={`远程音量 ${Math.round(volume * 100)}%`}
        disabled={!available}
        onChange={(event) => onVolumeChange(event.currentTarget.valueAsNumber)}
      />
    </div>
  );
}
