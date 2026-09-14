import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Keyboard } from "lucide-react";

import { orderRemoteShortcutGroups, type RemoteShortcut } from "../remote/remoteShortcuts.js";

interface RemoteShortcutMenuProps {
  disabled: boolean;
  platformKey: string;
  onOpenChange: (open: boolean) => void;
  onRemoteShortcut: (shortcut: RemoteShortcut) => void;
}

type ShortcutMenuLayout = {
  left: number;
  maxHeight: number;
  placement: "up" | "down";
  width: number;
};

const MENU_GAP = 8;
const MENU_MARGIN = 8;
const MENU_PREFERRED_WIDTH = 360;

export function RemoteShortcutMenu({ disabled, platformKey, onOpenChange, onRemoteShortcut }: RemoteShortcutMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => orderRemoteShortcutGroups(platformKey), [platformKey]);
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<ShortcutMenuLayout | null>(null);

  // 菜单打开期间工具栏不能自动收起，否则面板会跟着一起消失。
  useEffect(() => {
    onOpenChange(open);
  }, [onOpenChange, open]);

  const updateLayout = useCallback(() => {
    const details = detailsRef.current;
    const panel = panelRef.current;
    const summary = details?.querySelector("summary");
    if (!details?.open || !panel || !(summary instanceof HTMLElement)) return;

    const stage = details.closest<HTMLElement>(".control-stage-frame");
    const stageRect = stage?.getBoundingClientRect();
    const hasStageBounds = Boolean(stageRect && stageRect.width > 0 && stageRect.height > 0);
    const boundsLeft = Math.max(MENU_MARGIN, hasStageBounds ? stageRect!.left + MENU_MARGIN : MENU_MARGIN);
    const boundsTop = Math.max(MENU_MARGIN, hasStageBounds ? stageRect!.top + MENU_MARGIN : MENU_MARGIN);
    const boundsRight = Math.min(
      window.innerWidth - MENU_MARGIN,
      hasStageBounds ? stageRect!.right - MENU_MARGIN : window.innerWidth - MENU_MARGIN,
    );
    const boundsBottom = Math.min(
      window.innerHeight - MENU_MARGIN,
      hasStageBounds ? stageRect!.bottom - MENU_MARGIN : window.innerHeight - MENU_MARGIN,
    );
    const boundsWidth = Math.max(0, boundsRight - boundsLeft);

    const detailsRect = details.getBoundingClientRect();
    const summaryRect = summary.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const panelHeight = panel.scrollHeight || panelRect.height;
    const availableAbove = Math.max(0, summaryRect.top - MENU_GAP - boundsTop);
    const availableBelow = Math.max(0, boundsBottom - summaryRect.bottom - MENU_GAP);
    const placement = availableAbove >= panelHeight || availableAbove >= availableBelow ? "up" : "down";
    const maxHeight = Math.floor(placement === "up" ? availableAbove : availableBelow);
    const width = Math.floor(Math.min(MENU_PREFERRED_WIDTH, boundsWidth));
    const maxLeft = Math.max(boundsLeft, boundsRight - width);
    const viewportLeft = Math.min(maxLeft, Math.max(boundsLeft, summaryRect.right - width));

    const nextLayout: ShortcutMenuLayout = {
      left: Math.round(viewportLeft - detailsRect.left),
      maxHeight,
      placement,
      width,
    };
    setLayout((current) =>
      current &&
      current.left === nextLayout.left &&
      current.maxHeight === nextLayout.maxHeight &&
      current.placement === nextLayout.placement &&
      current.width === nextLayout.width
        ? current
        : nextLayout,
    );
  }, []);

  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;
    // 展开后点击菜单外部或按 Esc 自动收起。
    const onPointerDown = (event: Event) => {
      if (details.open && event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && details.open) {
        details.open = false;
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateLayout();

    let animationFrame = 0;
    const scheduleUpdate = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(updateLayout);
    };
    const details = detailsRef.current;
    const toolbar = details?.closest<HTMLElement>(".control-command-bar");
    const stage = details?.closest<HTMLElement>(".control-stage-frame");
    const mutationObserver =
      typeof MutationObserver === "function" && toolbar ? new MutationObserver(scheduleUpdate) : undefined;
    mutationObserver?.observe(toolbar!, { attributes: true, attributeFilter: ["class", "style"] });

    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleUpdate) : undefined;
    if (toolbar) resizeObserver?.observe(toolbar);
    if (stage) resizeObserver?.observe(stage);

    window.addEventListener("pointermove", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("pointermove", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
    };
  }, [open, updateLayout]);

  return (
    <details
      className={`shortcut-menu shortcut-menu--opens-${layout?.placement ?? "up"}`}
      data-placement={layout?.placement ?? "up"}
      ref={detailsRef}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <Keyboard size={14} />
        快捷键
        <ChevronDown className="shortcut-menu-chevron" size={12} />
      </summary>
      <div
        className="shortcut-menu-panel"
        ref={panelRef}
        role="menu"
        aria-label="远控快捷键"
        style={
          layout
            ? {
                left: `${layout.left}px`,
                right: "auto",
                width: `${layout.width}px`,
                maxHeight: `${layout.maxHeight}px`,
              }
            : undefined
        }
      >
        {groups.map((group) => (
          <section className="shortcut-menu-group" key={group.title} aria-label={group.title}>
            <h3>{group.title}</h3>
            <div className="shortcut-menu-grid">
              {group.shortcuts.map((shortcut) => (
                <button
                  type="button"
                  key={shortcut.id}
                  disabled={disabled}
                  onClick={() => onRemoteShortcut(shortcut.id)}
                >
                  {shortcut.label}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </details>
  );
}
