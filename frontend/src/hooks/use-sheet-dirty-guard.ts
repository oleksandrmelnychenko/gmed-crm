import { useCallback } from "react";

interface UseSheetDirtyGuardParams {
  isDirty: boolean;
  onClose: () => void;
  confirmMessage: string;
}

export function useSheetDirtyGuard({
  isDirty,
  onClose,
  confirmMessage,
}: UseSheetDirtyGuardParams) {
  return useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        return;
      }
      if (isDirty && !window.confirm(confirmMessage)) {
        return;
      }
      onClose();
    },
    [confirmMessage, isDirty, onClose],
  );
}
