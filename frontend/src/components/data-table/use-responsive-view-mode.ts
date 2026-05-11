import { useEffect, useState } from "react";

import type { ViewMode } from "./types";

const DEFAULT_SPLIT_BREAKPOINT = 1280;

export function useResponsiveViewMode(breakpoint: number = DEFAULT_SPLIT_BREAKPOINT): ViewMode {
  const [mode, setMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "overlay";
    return window.matchMedia(`(min-width: ${breakpoint}px)`).matches ? "split" : "overlay";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const handler = (event: MediaQueryListEvent | MediaQueryList) =>
      setMode(event.matches ? "split" : "overlay");
    handler(media);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [breakpoint]);

  return mode;
}
