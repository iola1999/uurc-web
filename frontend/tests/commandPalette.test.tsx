import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { CommandPalette } from "../src/components/CommandPalette.js";
import { AppMotionProvider } from "../src/motion/AppMotionProvider.js";
import type { UuDevice } from "@uurc/shared/devices";

it("executes the focused action and reserves first-result Enter for the search input", async () => {
  const user = userEvent.setup();
  const onSelectDevice = vi.fn();
  const onRefresh = vi.fn();
  render(
    <AppMotionProvider>
      <CommandPalette
        open
        query=""
        matches={
          [
            { deviceId: "synthetic-a", alias: "First" },
            { deviceId: "synthetic-b", alias: "Second" },
          ] as UuDevice[]
        }
        setOpen={vi.fn()}
        setQuery={vi.fn()}
        onSelectDevice={onSelectDevice}
        onConnectByIdFromQuery={vi.fn()}
        onRefresh={onRefresh}
      />
    </AppMotionProvider>,
  );
  screen.getByRole("button", { name: /刷新设备列表/ }).focus();
  await user.keyboard("{Enter}");
  expect(onRefresh).toHaveBeenCalledOnce();
  expect(onSelectDevice).not.toHaveBeenCalled();
  screen.getByRole("button", { name: /Second/ }).focus();
  await user.keyboard("{Enter}");
  expect(onSelectDevice).toHaveBeenLastCalledWith("synthetic-b");
  screen.getByRole("textbox").focus();
  await user.keyboard("{Enter}");
  expect(onSelectDevice).toHaveBeenLastCalledWith("synthetic-a");
});
