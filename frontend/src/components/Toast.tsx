import { AnimatePresence, useIsPresent, type Variants } from "motion/react";
import * as m from "motion/react-m";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

type ToastPosition = {
  left: number;
  maxWidth: number;
  top: number;
};

type ToastPlacement = "bottom" | "remote";

const TOAST_GAP = 8;
const TOAST_MARGIN = 8;
const TOAST_VARIANTS = {
  initial: { opacity: 0, y: 8, scale: 0.98 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
  },
  exit: {
    opacity: 0,
    y: 6,
    scale: 0.985,
    transition: { duration: 0.14, ease: [0.4, 0, 1, 1] },
  },
} satisfies Variants;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function overlaps(
  first: { bottom: number; left: number; right: number; top: number },
  second: { bottom: number; left: number; right: number; top: number },
): boolean {
  return (
    first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top
  );
}

function overlapArea(
  first: { bottom: number; left: number; right: number; top: number },
  second: { bottom: number; left: number; right: number; top: number },
): number {
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  return width * height;
}

export function Toast({
  toast,
  onDismiss,
  placement = "bottom",
}: {
  toast: { id: number; message: string } | null;
  onDismiss: () => void;
  placement?: ToastPlacement;
}) {
  return (
    <AnimatePresence>
      {toast ? <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} placement={placement} /> : null}
    </AnimatePresence>
  );
}

function ToastItem({
  toast,
  onDismiss,
  placement,
}: {
  toast: { id: number; message: string };
  onDismiss: () => void;
  placement: ToastPlacement;
}) {
  const toastRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<ToastPosition | null>(null);
  const isPresent = useIsPresent();

  useLayoutEffect(() => {
    if (placement !== "remote") {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const element = toastRef.current;
      const toolbar = document.querySelector<HTMLElement>(".command-dock");
      if (!element || !toolbar) {
        setPosition(null);
        return;
      }

      const stage = toolbar.closest<HTMLElement>(".control-stage-frame");
      const stageRect = stage?.getBoundingClientRect();
      const hasStageBounds = Boolean(stageRect && stageRect.width > 0 && stageRect.height > 0);
      const boundsLeft = Math.max(TOAST_MARGIN, hasStageBounds ? stageRect!.left + TOAST_MARGIN : TOAST_MARGIN);
      const boundsTop = Math.max(TOAST_MARGIN, hasStageBounds ? stageRect!.top + TOAST_MARGIN : TOAST_MARGIN);
      const boundsRight = Math.min(
        window.innerWidth - TOAST_MARGIN,
        hasStageBounds ? stageRect!.right - TOAST_MARGIN : window.innerWidth - TOAST_MARGIN,
      );
      const boundsBottom = Math.min(
        window.innerHeight - TOAST_MARGIN,
        hasStageBounds ? stageRect!.bottom - TOAST_MARGIN : window.innerHeight - TOAST_MARGIN,
      );
      const availableWidth = Math.max(0, boundsRight - boundsLeft);
      const toastRect = element.getBoundingClientRect();
      const toolbarRect = toolbar.getBoundingClientRect();
      const width = Math.min(toastRect.width, availableWidth);
      const height = toastRect.height;
      if (width <= 0 || height <= 0) return;

      const maxLeft = Math.max(boundsLeft, boundsRight - width);
      const maxTop = Math.max(boundsTop, boundsBottom - height);
      const centeredLeft = clamp(toolbarRect.left + (toolbarRect.width - width) / 2, boundsLeft, maxLeft);
      const centeredTop = clamp(toolbarRect.top + (toolbarRect.height - height) / 2, boundsTop, maxTop);
      const boundsCenterLeft = clamp(boundsLeft + (availableWidth - width) / 2, boundsLeft, maxLeft);
      const candidates = [
        { left: centeredLeft, top: toolbarRect.top - TOAST_GAP - height },
        { left: centeredLeft, top: toolbarRect.bottom + TOAST_GAP },
        { left: toolbarRect.left - TOAST_GAP - width, top: centeredTop },
        { left: toolbarRect.right + TOAST_GAP, top: centeredTop },
        { left: boundsCenterLeft, top: boundsTop },
        { left: boundsCenterLeft, top: boundsBottom - height },
      ];
      const toolbarWithGap = {
        bottom: toolbarRect.bottom + TOAST_GAP,
        left: toolbarRect.left - TOAST_GAP,
        right: toolbarRect.right + TOAST_GAP,
        top: toolbarRect.top - TOAST_GAP,
      };
      const candidateRect = (item: { left: number; top: number }) => ({
        bottom: item.top + height,
        left: item.left,
        right: item.left + width,
        top: item.top,
      });
      const availableCandidate = candidates.find((item) => {
        const rect = candidateRect(item);
        const insideBounds =
          rect.left >= boundsLeft && rect.right <= boundsRight && rect.top >= boundsTop && rect.bottom <= boundsBottom;
        return insideBounds && !overlaps(rect, toolbarWithGap);
      });
      const candidate =
        availableCandidate ??
        candidates
          .map((item) => ({
            left: clamp(item.left, boundsLeft, maxLeft),
            top: clamp(item.top, boundsTop, maxTop),
          }))
          .reduce((best, item) =>
            overlapArea(candidateRect(item), toolbarWithGap) < overlapArea(candidateRect(best), toolbarWithGap)
              ? item
              : best,
          );

      const nextPosition = {
        left: Math.round(candidate.left),
        maxWidth: Math.floor(availableWidth),
        top: Math.round(candidate.top),
      };
      setPosition((current) =>
        current &&
        current.left === nextPosition.left &&
        current.maxWidth === nextPosition.maxWidth &&
        current.top === nextPosition.top
          ? current
          : nextPosition,
      );
    };

    updatePosition();
    let animationFrame = 0;
    const scheduleUpdate = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(updatePosition);
    };
    const toolbar = document.querySelector<HTMLElement>(".command-dock");
    const stage = toolbar?.closest<HTMLElement>(".control-stage-frame");
    const mutationObserver =
      typeof MutationObserver === "function" && toolbar ? new MutationObserver(scheduleUpdate) : undefined;
    mutationObserver?.observe(toolbar!, { attributes: true, attributeFilter: ["class", "style"] });

    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleUpdate) : undefined;
    if (toastRef.current) resizeObserver?.observe(toastRef.current);
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
  }, [placement, toast.id]);

  const positionedStyle: CSSProperties | undefined = position
    ? {
        bottom: "auto",
        left: `${position.left}px`,
        marginInline: 0,
        maxWidth: `${position.maxWidth}px`,
        right: "auto",
        top: `${position.top}px`,
      }
    : undefined;

  return (
    <m.div
      className={`app-toast${placement === "remote" ? " app-toast--remote" : ""}${position ? " app-toast--positioned" : ""}`}
      ref={toastRef}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-hidden={isPresent ? undefined : true}
      inert={isPresent ? undefined : true}
      data-motion-state={isPresent ? "entered" : "exiting"}
      variants={TOAST_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{ ...positionedStyle, pointerEvents: isPresent ? undefined : "none" }}
      onClick={isPresent ? onDismiss : undefined}
    >
      {toast.message}
    </m.div>
  );
}
