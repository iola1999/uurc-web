import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMOTE_VIDEO_ORIENTATION,
  isDefaultRemoteVideoOrientation,
  normalizeRemoteVideoOrientation,
} from "../src/remote/remoteVideoOrientation.js";

describe("remoteVideoOrientation", () => {
  it("keeps a valid rotation and flip", () => {
    expect(normalizeRemoteVideoOrientation({ rotation: 90, flip: "horizontal" })).toEqual({
      rotation: 90,
      flip: "horizontal",
    });
    expect(normalizeRemoteVideoOrientation({ rotation: 270, flip: "vertical" })).toEqual({
      rotation: 270,
      flip: "vertical",
    });
  });

  it("falls back to the default orientation for unknown values", () => {
    expect(normalizeRemoteVideoOrientation({ rotation: 45, flip: "diagonal" })).toEqual(
      DEFAULT_REMOTE_VIDEO_ORIENTATION,
    );
    expect(normalizeRemoteVideoOrientation(undefined)).toEqual(DEFAULT_REMOTE_VIDEO_ORIENTATION);
    expect(normalizeRemoteVideoOrientation("90")).toEqual(DEFAULT_REMOTE_VIDEO_ORIENTATION);
    expect(normalizeRemoteVideoOrientation(null)).toEqual(DEFAULT_REMOTE_VIDEO_ORIENTATION);
  });

  it("recognizes the default orientation", () => {
    expect(isDefaultRemoteVideoOrientation({ rotation: 0, flip: "none" })).toBe(true);
    expect(isDefaultRemoteVideoOrientation({ rotation: 0, flip: "vertical" })).toBe(false);
    expect(isDefaultRemoteVideoOrientation({ rotation: 180, flip: "none" })).toBe(false);
  });
});
