import { useEffect, type RefObject } from "react";

export function useOutsideClose(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  options?: { enabled?: boolean },
) {
  useEffect(() => {
    if (options?.enabled === false) return;
    function handlePointer(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, [ref, onClose, options?.enabled]);
}
