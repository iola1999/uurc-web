import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, useIsPresent } from "motion/react";
import * as m from "motion/react-m";
import { useRef } from "react";
import { useModalFocus } from "./useModalFocus.js";

import { dialogCardVariants, dialogScrimVariants } from "../../motion/presets.js";

export function Dialog({
  open,
  onClose,
  children,
  ariaLabel,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel: string;
  className?: string;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <DialogSurface ariaLabel={ariaLabel} className={className} onClose={onClose}>
          {children}
        </DialogSurface>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function DialogSurface({
  onClose,
  children,
  ariaLabel,
  className,
}: {
  onClose: () => void;
  children: ReactNode;
  ariaLabel: string;
  className: string;
}) {
  const isPresent = useIsPresent();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, isPresent, onClose);

  return (
    <m.div
      className="dialog-scrim"
      data-motion-state={isPresent ? "entered" : "exiting"}
      aria-hidden={isPresent ? undefined : true}
      inert={isPresent ? undefined : true}
      style={{ pointerEvents: isPresent ? undefined : "none" }}
      variants={dialogScrimVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      onMouseDown={(event) => {
        if (isPresent && event.target === event.currentTarget) onClose();
      }}
    >
      <m.div
        className={`dialog-card ${className}`}
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        variants={dialogCardVariants}
      >
        {children}
      </m.div>
    </m.div>
  );
}
