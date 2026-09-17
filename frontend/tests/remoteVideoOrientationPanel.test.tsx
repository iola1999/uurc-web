import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RemoteVideoOrientationPanel } from "../src/components/RemoteVideoOrientationPanel.js";

afterEach(cleanup);

describe("RemoteVideoOrientationPanel", () => {
  it("shows the current setting and reports rotation and flip changes", async () => {
    const user = userEvent.setup();
    const onSettingChange = vi.fn();
    const view = render(
      <RemoteVideoOrientationPanel setting={{ rotation: "auto", flip: "none" }} onSettingChange={onSettingChange} />,
    );

    expect(screen.getByRole("radio", { name: "跟随" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "不翻转" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "90°" }));
    expect(onSettingChange).toHaveBeenLastCalledWith({ rotation: 90, flip: "none" });

    view.rerender(
      <RemoteVideoOrientationPanel setting={{ rotation: 90, flip: "horizontal" }} onSettingChange={onSettingChange} />,
    );
    expect(screen.getByRole("radio", { name: "90°" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "左右" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "上下" }));
    expect(onSettingChange).toHaveBeenLastCalledWith({ rotation: 90, flip: "vertical" });

    await user.click(screen.getByRole("radio", { name: "跟随" }));
    expect(onSettingChange).toHaveBeenLastCalledWith({ rotation: "auto", flip: "horizontal" });
  });
});
