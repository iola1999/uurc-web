import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  type WheelEvent,
} from "react";

import { STREAMER_CLIENT_TYPES } from "@uurc/shared/streamer/connectOptionsModel";

import type { RemoteStageViewMode } from "../app/remoteControlTypes.js";
import { getLocalClipboardAccessIssue, readLocalClipboardText } from "../browser/clipboard.js";
import type { BrowserRemoteSession } from "../remote/browserRemoteSession.js";
import type { BrowserRemoteSessionState } from "../remote/browserRemoteSessionTypes.js";
import { sendRemoteShortcut, type RemoteShortcut } from "../remote/remoteShortcuts.js";
import { toRemoteKeyValue, toRemoteMouseButton } from "../remote/remoteInputModel.js";
import { clientPointToRemoteMedia } from "../remote/remoteMediaGeometry.js";
import { isDesktopRemoteScrollTarget, RemoteScrollDeltaAccumulator } from "../remote/remoteScrollInput.js";
import { useRemoteCursorController } from "./useRemoteCursorController.js";
import { useRemoteMediaGeometry } from "./useRemoteMediaGeometry.js";

const HOLD_MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph"]);
const REMOTE_CONTROL_LEFT_KEY = 113;
const REMOTE_META_LEFT_KEY = 117;
const BROWSER_PASTE_SUPPRESSION_MS = 100;

interface PasteShortcutModifiers {
  ctrlKey: boolean;
  metaKey: boolean;
}

type PendingBrowserPaste =
  | {
      kind: "fallback";
      session: BrowserRemoteSession;
      modifiers: PasteShortcutModifiers;
    }
  | {
      kind: "suppress";
      session: BrowserRemoteSession;
    };

interface RemoteClipboardIntent {
  session: BrowserRemoteSession;
}

interface UseRemoteInputControllerOptions {
  browserSessionRef: RefObject<BrowserRemoteSession | null>;
  controlChannelState: RTCDataChannelState;
  targetPlatform?: number;
  primaryRemoteVideoId: string;
  remoteStageViewMode: RemoteStageViewMode;
  onError(message: string): void;
  onSessionStateChange(state: BrowserRemoteSessionState): void;
}

export function useRemoteInputController({
  browserSessionRef,
  controlChannelState,
  targetPlatform,
  primaryRemoteVideoId,
  remoteStageViewMode,
  onError,
  onSessionStateChange,
}: UseRemoteInputControllerOptions) {
  const [inputControlEnabled, setInputControlEnabled] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    if (!isFullscreen) return;
    const exitFullscreen = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector('[role="dialog"]:not([aria-hidden="true"])')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setIsFullscreen(false);
    };
    document.addEventListener("keydown", exitFullscreen, true);
    return () => document.removeEventListener("keydown", exitFullscreen, true);
  }, [isFullscreen]);
  const remoteStageRef = useRef<HTMLDivElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const controlChannelOpenedRef = useRef(false);
  const scrollDeltaAccumulatorRef = useRef(new RemoteScrollDeltaAccumulator());
  const pendingPointerMoveRef = useRef<LocalPointerPosition | undefined>(undefined);
  const pointerMoveFrameRef = useRef<number | undefined>(undefined);
  const pendingBrowserPasteRef = useRef<PendingBrowserPaste | null>(null);
  const pendingBrowserPasteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pasteRevisionRef = useRef(0);
  const remoteClipboardIntentRef = useRef<RemoteClipboardIntent | null>(null);
  const clearPendingBrowserPaste = useCallback((): void => {
    pendingBrowserPasteRef.current = null;
    if (pendingBrowserPasteTimerRef.current === undefined) return;
    clearTimeout(pendingBrowserPasteTimerRef.current);
    pendingBrowserPasteTimerRef.current = undefined;
  }, []);
  const clearClipboardShortcutState = useCallback((): void => {
    pasteRevisionRef.current += 1;
    clearPendingBrowserPaste();
    remoteClipboardIntentRef.current = null;
  }, [clearPendingBrowserPaste]);
  const cancelPendingPointerMove = useCallback((): void => {
    pendingPointerMoveRef.current = undefined;
    if (pointerMoveFrameRef.current === undefined) return;
    cancelPointerFrame(pointerMoveFrameRef.current);
    pointerMoveFrameRef.current = undefined;
  }, []);

  const inputControlActive = inputControlEnabled && controlChannelState === "open";
  const { geometryRef, refreshGeometry, subscribeGeometryChange } = useRemoteMediaGeometry({
    stageRef: remoteStageRef,
    viewMode: remoteStageViewMode,
    primaryVideoId: primaryRemoteVideoId,
  });
  const { handleRemoteCursorShape, resetRemoteCursor } = useRemoteCursorController({
    stageRef: remoteStageRef,
    geometryRef,
    subscribeGeometryChange,
    active: inputControlActive,
    primaryVideoId: primaryRemoteVideoId,
  });

  useEffect(() => {
    if (controlChannelState !== "open" && inputControlEnabled) {
      setInputControlEnabled(false);
    }
    if (controlChannelState !== "open") {
      scrollDeltaAccumulatorRef.current.reset();
      cancelPendingPointerMove();
      clearClipboardShortcutState();
    }
  }, [cancelPendingPointerMove, clearClipboardShortcutState, controlChannelState, inputControlEnabled]);

  useEffect(() => {
    scrollDeltaAccumulatorRef.current.reset();
    clearClipboardShortcutState();
  }, [clearClipboardShortcutState, targetPlatform]);

  useEffect(() => {
    if (controlChannelState !== "open") {
      controlChannelOpenedRef.current = false;
      return;
    }
    if (controlChannelOpenedRef.current) return;
    controlChannelOpenedRef.current = true;
    setInputControlEnabled(true);
    remoteStageRef.current?.focus();
  }, [controlChannelState]);

  useEffect(() => {
    const releaseHeldInputs = () => {
      clearClipboardShortcutState();
      browserSessionRef.current?.releaseAllInputs();
    };
    const onVisibilityChange = () => {
      if (document.hidden) releaseHeldInputs();
    };
    window.addEventListener("blur", releaseHeldInputs);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", releaseHeldInputs);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [browserSessionRef, clearClipboardShortcutState]);

  useEffect(
    () => () => {
      clearClipboardShortcutState();
    },
    [clearClipboardShortcutState],
  );

  useEffect(() => {
    const stage = remoteStageRef.current;
    if (!stage || !inputControlActive) return;
    const lockPageScroll = (event: Event) => event.preventDefault();
    stage.addEventListener("wheel", lockPageScroll, { passive: false });
    return () => stage.removeEventListener("wheel", lockPageScroll);
  }, [inputControlActive]);

  useEffect(() => cancelPendingPointerMove, [cancelPendingPointerMove]);

  function resetInputControl(): void {
    activePointerIdRef.current = null;
    scrollDeltaAccumulatorRef.current.reset();
    cancelPendingPointerMove();
    clearClipboardShortcutState();
    setInputControlEnabled(false);
  }

  function enableInputControl(): void {
    if (controlChannelState !== "open") return;
    setInputControlEnabled(true);
    remoteStageRef.current?.focus();
  }

  function handleRemoteShortcut(shortcut: RemoteShortcut): void {
    const session = browserSessionRef.current;
    if (!inputControlActive || !session) return;
    try {
      sendRemoteShortcut(session, shortcut);
      onSessionStateChange(session.getState());
      remoteStageRef.current?.focus();
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  function handleToggleInputControl(): void {
    if (inputControlActive) {
      resetInputControl();
      return;
    }
    enableInputControl();
  }

  function handleRemoteStagePointerDown(event: PointerEvent<HTMLDivElement>): void {
    const session = browserSessionRef.current;
    if (!inputControlActive || !session) return;
    pasteRevisionRef.current += 1;
    event.preventDefault();
    event.currentTarget.focus();
    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (!flushPointerPosition(pointerPositionFromEvent(event))) {
      activePointerIdRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
      return;
    }
    try {
      session.sendMouseButton({ action: "mousePress", button: toRemoteMouseButton(event.button) });
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  function handleRemoteStagePointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (!inputControlActive || !browserSessionRef.current) return;
    if (activePointerIdRef.current !== null && activePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    pendingPointerMoveRef.current = pointerPositionFromEvent(event);
    if (pointerMoveFrameRef.current !== undefined) return;
    pointerMoveFrameRef.current = requestPointerFrame(() => {
      pointerMoveFrameRef.current = undefined;
      const latest = pendingPointerMoveRef.current;
      pendingPointerMoveRef.current = undefined;
      if (!latest) return;
      sendPointerPosition(latest, false, false);
    });
  }

  function handleRemoteStagePointerUp(event: PointerEvent<HTMLDivElement>): void {
    const session = browserSessionRef.current;
    if (!inputControlActive || !session) return;
    if (activePointerIdRef.current !== null && activePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    activePointerIdRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    flushPointerPosition(pointerPositionFromEvent(event));
    try {
      session.sendMouseButton({ action: "mouseRelease", button: toRemoteMouseButton(event.button) });
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  function handleRemoteStagePointerCancel(event: PointerEvent<HTMLDivElement>): void {
    if (activePointerIdRef.current !== event.pointerId) return;
    activePointerIdRef.current = null;
    const session = browserSessionRef.current;
    if (!inputControlActive || !session) return;
    flushPointerPosition(pointerPositionFromEvent(event));
    try {
      session.sendMouseButton({ action: "mouseRelease", button: toRemoteMouseButton(event.button) });
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  function handleRemoteStageWheel(event: WheelEvent<HTMLDivElement>): void {
    const session = browserSessionRef.current;
    if (!inputControlActive || !session) return;
    event.preventDefault();
    const desktopTarget = isDesktopRemoteScrollTarget(targetPlatform);
    const delta = scrollDeltaAccumulatorRef.current.push({
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      pageHeight: event.currentTarget.clientHeight,
      desktopTarget,
    });
    if (!delta) return;
    if (!flushPointerPosition(pointerPositionFromEvent(event))) return;
    try {
      session.sendMouseScroll(delta);
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  function handleRemoteStageKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const session = browserSessionRef.current;
    if (!inputControlActive || !session || event.nativeEvent.isComposing) return;
    if (isPasteShortcut(event)) {
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      if (shouldUseRemoteClipboard(event, targetPlatform, session, remoteClipboardIntentRef.current)) {
        pasteRevisionRef.current += 1;
        clearPendingBrowserPaste();
        event.preventDefault();
        suppressNextBrowserPaste(session);
        const value = toRemoteKeyValue(event);
        try {
          session.sendKeyboardInput({ action: "keyboardPress", value });
          session.sendKeyboardInput({ action: "keyboardRelease", value });
        } catch (caught) {
          onError(errorMessage(caught));
        }
        return;
      }
      const revision = pasteRevisionRef.current + 1;
      pasteRevisionRef.current = revision;
      clearPendingBrowserPaste();
      remoteClipboardIntentRef.current = null;
      const modifiers = { ctrlKey: event.ctrlKey, metaKey: event.metaKey };
      if (getLocalClipboardAccessIssue("read")) {
        pendingBrowserPasteRef.current = { kind: "fallback", session, modifiers };
        return;
      }
      event.preventDefault();
      try {
        releasePasteShortcutModifiers(session, modifiers);
      } catch (caught) {
        pasteRevisionRef.current += 1;
        onError(errorMessage(caught));
        return;
      }
      suppressNextBrowserPaste(session);
      void readLocalClipboardText()
        .then((text) => {
          if (
            !text ||
            browserSessionRef.current !== session ||
            pasteRevisionRef.current !== revision ||
            controlChannelState !== "open"
          ) {
            return;
          }
          session.sendPastedText(text);
          onSessionStateChange(session.getState());
        })
        .catch((caught) => {
          if (browserSessionRef.current !== session || pasteRevisionRef.current !== revision) return;
          onError(`读取本机剪贴板失败：${errorMessage(caught)}`);
        });
      return;
    }
    const isHoldModifier = HOLD_MODIFIER_KEYS.has(event.key);
    if (isHoldModifier && event.repeat) return;
    pasteRevisionRef.current += 1;
    event.preventDefault();
    const value = toRemoteKeyValue(event);
    const marksRemoteClipboard = isRemoteClipboardMutationShortcut(event, targetPlatform);
    if (marksRemoteClipboard) {
      clearPendingBrowserPaste();
    }
    try {
      session.sendKeyboardInput({ action: "keyboardPress", value });
      if (!isHoldModifier) session.sendKeyboardInput({ action: "keyboardRelease", value });
      if (marksRemoteClipboard) {
        remoteClipboardIntentRef.current = { session };
      }
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  function handleRemoteStageKeyUp(event: KeyboardEvent<HTMLDivElement>): void {
    const session = browserSessionRef.current;
    if (!inputControlActive || !session) return;
    if (isPasteKey(event)) {
      return;
    }
    if (!HOLD_MODIFIER_KEYS.has(event.key)) return;
    if (pendingBrowserPasteRef.current?.kind === "fallback") clearPendingBrowserPaste();
    event.preventDefault();
    try {
      session.sendKeyboardInput({ action: "keyboardRelease", value: toRemoteKeyValue(event) });
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  function handleRemoteStageBlur(): void {
    activePointerIdRef.current = null;
    scrollDeltaAccumulatorRef.current.reset();
    cancelPendingPointerMove();
    clearClipboardShortcutState();
    browserSessionRef.current?.releaseAllInputs();
  }

  function handleRemoteStagePaste(event: ClipboardEvent<HTMLDivElement>): void {
    const session = browserSessionRef.current;
    if (!inputControlActive || !session) return;
    const pendingPaste = pendingBrowserPasteRef.current;
    if (pendingPaste?.kind === "suppress" && pendingPaste.session === session) {
      clearPendingBrowserPaste();
      event.preventDefault();
      return;
    }
    const text = event.clipboardData?.getData("text") ?? "";
    if (!text) return;
    event.preventDefault();
    pasteRevisionRef.current += 1;
    clearPendingBrowserPaste();
    remoteClipboardIntentRef.current = null;
    try {
      if (pendingPaste?.kind === "fallback" && pendingPaste.session === session) {
        releasePasteShortcutModifiers(session, pendingPaste.modifiers);
      }
      session.sendPastedText(text);
      onSessionStateChange(session.getState());
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  function suppressNextBrowserPaste(session: BrowserRemoteSession): void {
    clearPendingBrowserPaste();
    const pendingPaste: PendingBrowserPaste = { kind: "suppress", session };
    pendingBrowserPasteRef.current = pendingPaste;
    pendingBrowserPasteTimerRef.current = setTimeout(() => {
      if (pendingBrowserPasteRef.current !== pendingPaste) return;
      pendingBrowserPasteRef.current = null;
      pendingBrowserPasteTimerRef.current = undefined;
    }, BROWSER_PASTE_SUPPRESSION_MS);
  }

  function flushPointerPosition(position: LocalPointerPosition): boolean {
    cancelPendingPointerMove();
    return sendPointerPosition(position, true, true);
  }

  function sendPointerPosition(position: LocalPointerPosition, critical: boolean, refresh: boolean): boolean {
    const session = browserSessionRef.current;
    if (!inputControlActive || !session) return false;
    const geometry = refresh ? refreshGeometry() : (geometryRef.current ?? refreshGeometry());
    if (!geometry) return false;
    const normalized = clientPointToRemoteMedia(geometry, { x: position.clientX, y: position.clientY });
    try {
      session.sendMouseMove(
        {
          absX: Math.round(normalized.x * geometry.mediaWidth),
          absY: Math.round(normalized.y * geometry.mediaHeight),
          surfaceWidth: geometry.mediaWidth,
          surfaceHeight: geometry.mediaHeight,
        },
        { critical },
      );
      return true;
    } catch (caught) {
      onError(errorMessage(caught));
      return false;
    }
  }

  return {
    inputControlActive,
    isFullscreen,
    remoteStageRef,
    handleRemoteCursorShape,
    resetRemoteCursor,
    enableInputControl,
    resetInputControl,
    handleRemoteShortcut,
    handleToggleFullscreen: () => setIsFullscreen((current) => !current),
    handleToggleInputControl,
    handleRemoteStagePointerDown,
    handleRemoteStagePointerMove,
    handleRemoteStagePointerUp,
    handleRemoteStagePointerCancel,
    handleRemoteStageWheel,
    handleRemoteStageKeyDown,
    handleRemoteStageKeyUp,
    handleRemoteStageBlur,
    handleRemoteStagePaste,
  };
}

interface LocalPointerPosition {
  clientX: number;
  clientY: number;
}

function pointerPositionFromEvent(event: { clientX: number; clientY: number }): LocalPointerPosition {
  return { clientX: event.clientX, clientY: event.clientY };
}

function requestPointerFrame(callback: FrameRequestCallback): number {
  if (typeof window.requestAnimationFrame === "function") return window.requestAnimationFrame(callback);
  return window.setTimeout(() => callback(performance.now()), 16);
}

function cancelPointerFrame(frame: number): void {
  if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(frame);
  else window.clearTimeout(frame);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPasteShortcut(event: KeyboardEvent<HTMLDivElement>): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v";
}

function isPasteKey(event: KeyboardEvent<HTMLDivElement>): boolean {
  return event.key.toLowerCase() === "v";
}

function isRemoteClipboardMutationShortcut(
  event: KeyboardEvent<HTMLDivElement>,
  targetPlatform: number | undefined,
): boolean {
  if (targetPlatform !== STREAMER_CLIENT_TYPES.Client_MAC || !event.metaKey) return false;
  const key = event.key.toLowerCase();
  return key === "c" || key === "x";
}

function shouldUseRemoteClipboard(
  event: KeyboardEvent<HTMLDivElement>,
  targetPlatform: number | undefined,
  session: BrowserRemoteSession,
  intent: RemoteClipboardIntent | null,
): boolean {
  return targetPlatform === STREAMER_CLIENT_TYPES.Client_MAC && event.metaKey && intent?.session === session;
}

function releasePasteShortcutModifiers(session: BrowserRemoteSession, modifiers: PasteShortcutModifiers): void {
  if (modifiers.ctrlKey) {
    session.sendKeyboardInput({ action: "keyboardRelease", value: REMOTE_CONTROL_LEFT_KEY });
  }
  if (modifiers.metaKey) {
    session.sendKeyboardInput({ action: "keyboardRelease", value: REMOTE_META_LEFT_KEY });
  }
}
