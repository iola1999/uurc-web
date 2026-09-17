import { describe, expect, it, vi } from "vitest";

import {
  isRemoteVideoRotationProbeSupported,
  startRemoteVideoRotationProbe,
} from "../src/remote/remoteVideoRotationProbe.js";

interface FakeFrame {
  rotation: number;
  close(): void;
}

function createProcessor(rotations: number[]) {
  let index = 0;
  const readable = new ReadableStream<FakeFrame>({
    pull(controller) {
      if (index >= rotations.length) {
        controller.close();
        return;
      }
      controller.enqueue({ rotation: rotations[index++], close: () => undefined });
    },
  });
  return { readable };
}

function createTrack() {
  const stop = vi.fn();
  return { track: { stop } as unknown as MediaStreamTrack, stop };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("remoteVideoRotationProbe", () => {
  it("reports the rotation carried by the received frames", async () => {
    const { track, stop } = createTrack();
    const cloneTrack = vi.fn(() => track);
    const onRotation = vi.fn();

    const probe = startRemoteVideoRotationProbe(
      { track: {} as MediaStreamTrack, onRotation },
      { createProcessor: () => createProcessor([90, 90, 270]), cloneTrack },
    );
    expect(probe).not.toBeNull();

    await flush();

    expect(onRotation.mock.calls).toEqual([[90], [90], [270]]);
    expect(cloneTrack).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalled();
  });

  it("stops after the sampling budget without touching the original track", async () => {
    const { track, stop } = createTrack();
    const original = { stop: vi.fn() } as unknown as MediaStreamTrack;
    const onRotation = vi.fn();

    startRemoteVideoRotationProbe(
      { track: original, onRotation, maxFrames: 2 },
      { createProcessor: () => createProcessor([90, 180, 270]), cloneTrack: () => track },
    );

    await flush();

    expect(onRotation.mock.calls).toEqual([[90], [180]]);
    expect(stop).toHaveBeenCalled();
    expect((original as unknown as { stop: ReturnType<typeof vi.fn> }).stop).not.toHaveBeenCalled();
  });

  it("gives up when the browser cannot clone a received track", () => {
    const onRotation = vi.fn();
    const probe = startRemoteVideoRotationProbe(
      { track: {} as MediaStreamTrack, onRotation },
      {
        createProcessor: () => createProcessor([90]),
        cloneTrack: () => {
          throw new Error("clone is not supported");
        },
      },
    );

    expect(probe).toBeNull();
    expect(onRotation).not.toHaveBeenCalled();
  });

  it("reports that the probe is unavailable without MediaStreamTrackProcessor", () => {
    // jsdom 里没有这两个 API，探针整体不可用，调用方据此退回手动设置。
    expect(isRemoteVideoRotationProbeSupported()).toBe(false);
    expect(startRemoteVideoRotationProbe({ track: {} as MediaStreamTrack, onRotation: vi.fn() })).toBeNull();
  });
});
