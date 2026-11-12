import { useEffect, useRef } from "react";

import { useOverlayDirtyReset } from "@/components/ui/dismissal-guard";

/**
 * Rendered inside a sheet or dialog: whenever `version` changes, what the
 * fields show now becomes the unchanged state of the overlay. For a card that
 * stays open after a save, so closing it right after «Сохранить данные» does
 * not ask «Закрыть без сохранения?» (QA F-C1).
 */
export function OverlayDirtyBaseline({ version }: { version: number }) {
  const reset = useOverlayDirtyReset();
  const resetRef = useRef(reset);
  useEffect(() => {
    resetRef.current = reset;
  }, [reset]);
  useEffect(() => {
    if (version > 0) resetRef.current();
  }, [version]);
  return null;
}
