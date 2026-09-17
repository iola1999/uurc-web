import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { REMOTE_VIDEO_ORIENTATION_STORAGE_KEY } from "../src/controllers/useRemoteVideoOrientation.js";
import { openOfficeMacControl, openSettingsTab } from "./appTestActions.js";
import { App, cleanupAppTest, setupAppTest } from "./appTestEnvironment.js";

describe("remote video orientation settings", () => {
  beforeEach(setupAppTest);
  afterEach(() => {
    cleanupAppTest();
    window.localStorage.clear();
  });

  it("offers the picture orientation in the settings tab and persists the chosen angle per device", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openOfficeMacControl(user);
    await openSettingsTab(user);

    expect(screen.getByRole("radio", { name: "跟随" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "180°" }));
    await user.click(screen.getByRole("radio", { name: "左右" }));

    expect(screen.getByRole("radio", { name: "180°" })).toBeChecked();
    expect(JSON.parse(window.localStorage.getItem(REMOTE_VIDEO_ORIENTATION_STORAGE_KEY) ?? "{}")).toEqual({
      "desktop-1": { rotation: 180, flip: "horizontal" },
    });
  });

  it("restores the stored angle for the selected device", async () => {
    window.localStorage.setItem(
      REMOTE_VIDEO_ORIENTATION_STORAGE_KEY,
      JSON.stringify({ "desktop-1": { rotation: 270, flip: "vertical" } }),
    );

    const user = userEvent.setup();
    render(<App />);
    await openOfficeMacControl(user);
    await openSettingsTab(user);

    expect(screen.getByRole("radio", { name: "270°" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "上下" })).toBeChecked();
  });
});
