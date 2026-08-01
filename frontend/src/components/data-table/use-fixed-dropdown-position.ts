import { useLayoutEffect, useState, type RefObject } from "react";

export type FixedDropdownAlign = "start" | "end";

type FixedDropdownPosition = { left: number; top: number };

/**
 * Positions a dropdown with `position: fixed` next to its anchor so it can
 * escape clipping ancestors (e.g. the table toolbar's `overflow-x-auto`).
 * Returns `null` until the first measurement — render the menu invisible then.
 */
export function useFixedDropdownPosition(
  anchorRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  open: boolean,
  align: FixedDropdownAlign = "start",
): FixedDropdownPosition | null {
  const [position, setPosition] = useState<FixedDropdownPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const margin = 8;
    const gap = 4;
    const update = () => {
      const anchor = anchorRef.current;
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      const rect = anchor.getBoundingClientRect();
      let left = align === "end" ? rect.right - menu.offsetWidth : rect.left;
      left = Math.min(left, window.innerWidth - menu.offsetWidth - margin);
      left = Math.max(margin, left);
      let top = rect.bottom + gap;
      if (top + menu.offsetHeight > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - menu.offsetHeight - gap);
      }
      setPosition((current) =>
        current && current.left === left && current.top === top
          ? current
          : { left, top },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    if (anchorRef.current) observer.observe(anchorRef.current);
    if (menuRef.current) observer.observe(menuRef.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [align, anchorRef, menuRef, open]);

  return position;
}

export function fixedDropdownStyle(
  position: FixedDropdownPosition | null,
): { left: number; top: number; visibility?: "hidden" } {
  return position ?? { left: 0, top: 0, visibility: "hidden" };
}
