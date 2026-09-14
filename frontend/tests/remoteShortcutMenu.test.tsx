import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RemoteShortcutMenu } from "../src/components/RemoteShortcutMenu.js";
import { rectFrom } from "./appTestValues.js";

describe("RemoteShortcutMenu", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens upward when the toolbar is near the bottom", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { container } = render(
      <RemoteShortcutMenu disabled={false} platformKey="mac" onOpenChange={onOpenChange} onRemoteShortcut={vi.fn()} />,
    );
    const details = container.querySelector("details") as HTMLDetailsElement;
    const summary = container.querySelector("summary") as HTMLElement;
    const panel = screen.getByRole("menu", { name: "远控快捷键" });
    vi.spyOn(details, "getBoundingClientRect").mockReturnValue(
      rectFrom({ left: 600, top: 430, width: 120, height: 38 }),
    );
    vi.spyOn(summary, "getBoundingClientRect").mockReturnValue(
      rectFrom({ left: 600, top: 430, width: 120, height: 38 }),
    );
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(
      rectFrom({ left: 360, top: 122, width: 360, height: 300 }),
    );

    await user.click(summary);

    await waitFor(() => expect(details).toHaveAttribute("data-placement", "up"));
    // 工具栏靠这个上报判断菜单是否打开：打开期间不能自动收起，否则面板会跟着消失。
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it("opens downward when there is more room below the toolbar", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <RemoteShortcutMenu disabled={false} platformKey="mac" onOpenChange={vi.fn()} onRemoteShortcut={vi.fn()} />,
    );
    const details = container.querySelector("details") as HTMLDetailsElement;
    const summary = container.querySelector("summary") as HTMLElement;
    const panel = screen.getByRole("menu", { name: "远控快捷键" });
    vi.spyOn(details, "getBoundingClientRect").mockReturnValue(
      rectFrom({ left: 600, top: 20, width: 120, height: 38 }),
    );
    vi.spyOn(summary, "getBoundingClientRect").mockReturnValue(
      rectFrom({ left: 600, top: 20, width: 120, height: 38 }),
    );
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(rectFrom({ left: 360, top: 66, width: 360, height: 300 }));

    await user.click(summary);

    await waitFor(() => expect(details).toHaveAttribute("data-placement", "down"));
  });

  it("calculates a bounded layout on narrow screens", async () => {
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 844);
    const user = userEvent.setup();
    const { container } = render(
      <RemoteShortcutMenu disabled={false} platformKey="mac" onOpenChange={vi.fn()} onRemoteShortcut={vi.fn()} />,
    );
    const details = container.querySelector("details") as HTMLDetailsElement;
    const summary = container.querySelector("summary") as HTMLElement;
    const panel = screen.getByRole("menu", { name: "远控快捷键" });
    vi.spyOn(details, "getBoundingClientRect").mockReturnValue(
      rectFrom({ left: 250, top: 20, width: 120, height: 38 }),
    );
    vi.spyOn(summary, "getBoundingClientRect").mockReturnValue(
      rectFrom({ left: 250, top: 20, width: 120, height: 38 }),
    );
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(rectFrom({ left: 10, top: 66, width: 360, height: 600 }));

    await user.click(summary);

    await waitFor(() => {
      expect(details).toHaveAttribute("data-placement", "down");
      expect(panel).toHaveStyle({ maxHeight: "770px", width: "360px" });
    });
  });

  it("restores its preferred width after the viewport expands", async () => {
    vi.stubGlobal("innerWidth", 300);
    vi.stubGlobal("innerHeight", 844);
    const user = userEvent.setup();
    const { container } = render(
      <RemoteShortcutMenu disabled={false} platformKey="mac" onOpenChange={vi.fn()} onRemoteShortcut={vi.fn()} />,
    );
    const details = container.querySelector("details") as HTMLDetailsElement;
    const summary = container.querySelector("summary") as HTMLElement;
    const panel = screen.getByRole("menu", { name: "远控快捷键" });
    vi.spyOn(details, "getBoundingClientRect").mockReturnValue(
      rectFrom({ left: 170, top: 20, width: 120, height: 38 }),
    );
    vi.spyOn(summary, "getBoundingClientRect").mockReturnValue(
      rectFrom({ left: 170, top: 20, width: 120, height: 38 }),
    );
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(rectFrom({ left: 8, top: 66, width: 284, height: 300 }));

    await user.click(summary);
    await waitFor(() => expect(panel).toHaveStyle({ width: "284px" }));

    vi.stubGlobal("innerWidth", 800);
    window.dispatchEvent(new Event("resize"));

    await waitFor(() => expect(panel).toHaveStyle({ width: "360px" }));
  });
});
