import { useCallback, useEffect, useState, type FocusEvent, type PointerEvent } from "react";

// 工具栏完整出现的时长：连上后先展示这么久，之后鼠标每次移开也等这么久才收起。
const AUTO_COLLAPSE_DELAY_MS = 2000;

interface CollapsibleToolbarOptions {
  // 未连接、文字输入窗口或快捷键菜单打开时必须保持展开，否则会在操作途中收起。
  holdOpen: boolean;
}

export function useCollapsibleToolbar({ holdOpen }: CollapsibleToolbarOptions) {
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focusInside, setFocusInside] = useState(false);

  useEffect(() => {
    if (collapsed || hovered || focusInside || holdOpen) return;
    const timer = window.setTimeout(() => setCollapsed(true), AUTO_COLLAPSE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [collapsed, focusInside, holdOpen, hovered]);

  const expand = useCallback(() => setCollapsed(false), []);

  const onPointerEnter = useCallback((event: PointerEvent<HTMLElement>) => {
    // 触摸没有 hover，展开交给点击，这里只处理鼠标和触控笔。
    if (event.pointerType === "touch") return;
    setHovered(true);
    setCollapsed(false);
  }, []);

  const onPointerLeave = useCallback((event: PointerEvent<HTMLElement>) => {
    setHovered(false);
    // 鼠标移开后清掉留在按钮上的焦点，否则点过按钮的工具栏会因为焦点还在里面而一直不收起。
    // 触摸指针抬起时同样会触发 pointerleave，那时焦点是触屏用户唯一的保持展开依据，不能清。
    if (event.pointerType !== "mouse") return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && event.currentTarget.contains(active)) active.blur();
  }, []);

  const onFocus = useCallback(() => {
    setFocusInside(true);
    setCollapsed(false);
  }, []);

  const onBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setFocusInside(false);
  }, []);

  return {
    collapsed,
    expand,
    dockProps: { onBlur, onFocus, onPointerEnter, onPointerLeave },
  };
}
