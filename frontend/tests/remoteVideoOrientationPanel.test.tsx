import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RemoteVideoOrientationPanel } from "../src/components/RemoteVideoOrientationPanel.js";

afterEach(cleanup);

describe("RemoteVideoOrientationPanel", () => {
  it("shows the current correction and reports rotation and flip changes", async () => {
    const user = userEvent.setup();
    const onOrientationChange = vi.fn();
    const view = render(
      <RemoteVideoOrientationPanel
        orientation={{ rotation: 0, flip: "none" }}
        onOrientationChange={onOrientationChange}
      />,
    );

    expect(screen.getByRole("radio", { name: "0°" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "不翻转" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "90°" }));
    expect(onOrientationChange).toHaveBeenLastCalledWith({ rotation: 90, flip: "none" });

    view.rerender(
      <RemoteVideoOrientationPanel
        orientation={{ rotation: 90, flip: "horizontal" }}
        onOrientationChange={onOrientationChange}
      />,
    );
    expect(screen.getByRole("radio", { name: "90°" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "左右" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "上下" }));
    expect(onOrientationChange).toHaveBeenLastCalledWith({ rotation: 90, flip: "vertical" });
  });
});
