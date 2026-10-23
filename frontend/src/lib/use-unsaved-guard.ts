import { useCallback, useEffect, useRef } from "react";

/**
 * Guards an autosaved draft against a closed tab: the browser asks before
 * leaving while an entry waits for its delay, is being written or was not
 * accepted, and a page hidden by the phone or another tab saves at once.
 * `track` wraps every save call; a result other than `false` counts as saved.
 */
export function useUnsavedGuard<Draft>(draft: Draft, saveNow: (snapshot: Draft) => unknown, active = true) {
  const key = JSON.stringify(draft);
  const state = useRef({ settled: key, current: key, running: 0, draft, saveNow, active });
  state.current.current = key;
  state.current.draft = draft;
  state.current.saveNow = saveNow;
  // A form that can no longer be written (sent, closed) has nothing to keep.
  state.current.active = active;

  const track = useCallback(<Result,>(snapshot: Draft, result: Result): Result => {
    const s = state.current;
    const snapshotKey = JSON.stringify(snapshot);
    s.running += 1;
    void Promise.resolve(result)
      .then(
        (ok) => {
          if (ok !== false) s.settled = snapshotKey;
        },
        () => undefined,
      )
      .finally(() => {
        s.running -= 1;
      });
    return result;
  }, []);

  useEffect(() => {
    const s = state.current;
    const unsaved = () => s.active && (s.running > 0 || s.current !== s.settled);
    const warn = (event: BeforeUnloadEvent) => {
      if (!unsaved()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const hidden = () => {
      if (document.visibilityState === "hidden" && s.active && s.running === 0 && s.current !== s.settled) {
        void Promise.resolve(track(s.draft, s.saveNow(s.draft))).catch(() => undefined);
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [track]);

  return track;
}
