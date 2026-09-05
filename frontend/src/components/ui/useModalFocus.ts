import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = ':is(button, input, textarea, select, a[href], [tabindex]):not(:disabled):not([tabindex="-1"])';

export function useModalFocus(ref: RefObject<HTMLElement | null>, active: boolean, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!active || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("root");
    const wasInert = root?.inert ?? false;
    if (root && !root.contains(dialog)) root.inert = true;
    const items = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.closest('[inert], [hidden], [aria-hidden="true"]'),
      );
    const focusFirst = () => (items()[0] ?? dialog).focus();
    const isTopDialog = () =>
      Array.from(document.querySelectorAll('[role="dialog"]:not([aria-hidden="true"])')).at(-1) === dialog;
    focusFirst();
    const keydown = (event: KeyboardEvent) => {
      if (!isTopDialog()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
      }
      if (event.key === "Tab") {
        const targets = items();
        const first = targets[0] ?? dialog;
        const last = targets.at(-1) ?? dialog;
        if (
          !dialog.contains(document.activeElement) ||
          (event.shiftKey ? document.activeElement === first : document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    const focusin = (event: FocusEvent) => {
      if (isTopDialog() && !dialog.contains(event.target as Node)) focusFirst();
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin);
      if (root) root.inert = wasInert;
      if (previous?.isConnected) previous.focus();
    };
  }, [ref, active]);
}
