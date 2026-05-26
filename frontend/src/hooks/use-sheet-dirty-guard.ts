import { useCallback } from "react";
import {
  CONFIRMED_DISMISS_REASON,
  shouldConfirmDirtyDismiss,
} from "@/components/ui/dismissal-guard";

interface UseSheetDirtyGuardParams {
  isDirty: boolean;
  onClose: () => void;
  confirmMessage: string;
}

export function useSheetDirtyGuard(params: UseSheetDirtyGuardParams) {
  const { isDirty, onClose } = params;

  return useCallback(
    (nextOpen: boolean, eventDetails?: { reason: string }) => {
      if (nextOpen) {
        return;
      }
      if (eventDetails?.reason === CONFIRMED_DISMISS_REASON) {
        onClose();
        return;
      }
      if (
        eventDetails &&
        shouldConfirmDirtyDismiss(nextOpen, eventDetails.reason, isDirty)
      ) {
        return;
      }
      if (isDirty) {
        return;
      }
      onClose();
    },
    [isDirty, onClose],
  );
}
