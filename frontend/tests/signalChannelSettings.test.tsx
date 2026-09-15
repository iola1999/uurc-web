import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openAdvancedSettings, openOfficeMacControl } from "./appTestActions.js";
import { App, cleanupAppTest, setupAppTest } from "./appTestEnvironment.js";

describe("signal channel settings", () => {
  beforeEach(setupAppTest);
  afterEach(() => {
    cleanupAppTest();
    window.localStorage.clear();
  });

  it("offers the signal channel modes and persists an explicit selection", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openOfficeMacControl(user);
    await openAdvancedSettings(user);

    expect(screen.getByRole("radio", { name: "自动" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "部署侧网关" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "浏览器直连" })).not.toBeChecked();
    // 扩展探测状态提示(检测中/未检出/已检出都包含扩展名)
    expect(screen.getByText(/Direct Signal 扩展/)).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "浏览器直连" }));

    expect(screen.getByRole("radio", { name: "浏览器直连" })).toBeChecked();
    expect(window.localStorage.getItem("uurc.signalChannelMode")).toBe("direct");
  });

  it("restores the persisted signal channel mode", async () => {
    window.localStorage.setItem("uurc.signalChannelMode", "gateway");
    const user = userEvent.setup();
    render(<App />);
    await openOfficeMacControl(user);
    await openAdvancedSettings(user);

    expect(screen.getByRole("radio", { name: "部署侧网关" })).toBeChecked();
  });
});
