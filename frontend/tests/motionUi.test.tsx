import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppMotionProvider } from "../src/motion/AppMotionProvider.js";
import { AnimatedDisclosure } from "../src/components/ui/AnimatedDisclosure.js";
import { Dialog } from "../src/components/ui/Dialog.js";
import { SegmentedControl } from "../src/components/ui/SegmentedControl.js";
import { Tabs } from "../src/components/ui/Tabs.js";

function TestTabs() {
  const [value, setValue] = useState("summary");

  return (
    <Tabs
      ariaLabel="测试标签页"
      value={value}
      onChange={setValue}
      items={[
        { value: "summary", label: "摘要", content: <p>摘要内容</p> },
        { value: "settings", label: "设置", content: <p>设置内容</p> },
      ]}
    />
  );
}

function TestSegmentedControl() {
  const [value, setValue] = useState("normal");

  return (
    <SegmentedControl
      name="join-mode"
      ariaLabel="加入模式"
      value={value}
      onChange={setValue}
      options={[
        { value: "normal", label: "普通加入" },
        { value: "force", label: "接管控制" },
      ]}
    />
  );
}

describe("motion UI", () => {
  afterEach(cleanup);
  it("contains keyboard focus and restores it when the modal closes", async () => {
    const user = userEvent.setup();
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>打开</button>
          <Dialog open={open} onClose={() => setOpen(false)} ariaLabel="焦点测试">
            <input aria-label="第一项" />
            <button onClick={() => setOpen(false)}>关闭</button>
          </Dialog>
        </>
      );
    }
    render(
      <AppMotionProvider>
        <Example />
      </AppMotionProvider>,
    );
    const opener = screen.getByRole("button", { name: "打开" });
    await user.click(opener);
    const first = screen.getByRole("textbox", { name: "第一项" });
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(opener).toHaveFocus();
  });
  it("keeps tabs semantic while supporting arrow-key navigation", async () => {
    const user = userEvent.setup();
    render(
      <AppMotionProvider>
        <TestTabs />
      </AppMotionProvider>,
    );

    const summaryTab = screen.getByRole("tab", { name: "摘要" });
    const settingsTab = screen.getByRole("tab", { name: "设置" });
    expect(summaryTab).toHaveAttribute("aria-selected", "true");
    expect(summaryTab).toHaveAttribute("aria-controls");
    expect(settingsTab).toHaveAttribute("tabindex", "-1");

    summaryTab.focus();
    await user.keyboard("{ArrowRight}");

    expect(settingsTab).toHaveFocus();
    expect(settingsTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("设置内容");
  });

  it("keeps disclosure semantics while animating the content region", async () => {
    const user = userEvent.setup();
    render(
      <AppMotionProvider>
        <AnimatedDisclosure className="test-disclosure" summary="展开内容">
          <button type="button">内容操作</button>
        </AnimatedDisclosure>
      </AppMotionProvider>,
    );

    const summary = screen.getByText("展开内容").closest("summary");
    const disclosure = summary?.closest("details");
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(disclosure).toHaveAttribute("data-expanded", "false");

    await user.click(summary!);

    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(disclosure).toHaveAttribute("open");
    expect(disclosure).toHaveAttribute("data-expanded", "true");
    expect(screen.getByRole("region", { name: "展开内容" })).toContainElement(
      screen.getByRole("button", { name: "内容操作" }),
    );
  });

  it("moves one selected background while preserving native radio behavior", async () => {
    const user = userEvent.setup();
    render(
      <AppMotionProvider>
        <TestSegmentedControl />
      </AppMotionProvider>,
    );

    const normal = screen.getByRole("radio", { name: "普通加入" });
    const force = screen.getByRole("radio", { name: "接管控制" });
    expect(normal).toBeChecked();
    expect(document.querySelectorAll(".segmented-control-indicator")).toHaveLength(1);
    expect(document.querySelector(".segmented-control-indicator")?.closest("label")).toContainElement(normal);

    await user.click(force);

    expect(force).toBeChecked();
    expect(document.querySelectorAll(".segmented-control-indicator")).toHaveLength(1);
    expect(document.querySelector(".segmented-control-indicator")?.closest("label")).toContainElement(force);
  });

  it("keeps the dialog mounted for its exit phase without accepting another dismiss action", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <AppMotionProvider>
        <Dialog open onClose={onClose} ariaLabel="测试对话框">
          <p>对话框内容</p>
        </Dialog>
      </AppMotionProvider>,
    );

    expect(screen.getByRole("dialog", { name: "测试对话框" })).toBeInTheDocument();

    rerender(
      <AppMotionProvider>
        <Dialog open={false} onClose={onClose} ariaLabel="测试对话框">
          <p>对话框内容</p>
        </Dialog>
      </AppMotionProvider>,
    );

    const scrim = document.querySelector(".dialog-scrim");
    expect(scrim).toHaveAttribute("data-motion-state", "exiting");
    expect(scrim).toHaveStyle({ pointerEvents: "none" });
    expect(screen.queryByRole("dialog", { name: "测试对话框" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
