import { useState } from "react";
import { hasFormChanges } from "@/lib/form-changes";

/** For drafts prepared before opening; async forms should pass open only when ready. */
export function useOpenedFormDirty<T>(open: boolean, draft: T) {
  const [snapshot, setSnapshot] = useState({ open, initial: draft });
  if (snapshot.open !== open) {
    setSnapshot({ open, initial: draft });
    return false;
  }
  return open && hasFormChanges(draft, snapshot.initial);
}
