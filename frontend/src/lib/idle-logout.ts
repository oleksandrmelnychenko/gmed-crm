import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Signs the user out after a period without any input. An unattended, unlocked
 * workstation is the most likely way patient data gets seen by the wrong
 * person, and a 60-minute access token that refreshes silently for 30 days
 * never ends on its own.
 *
 * The last-activity stamp lives in localStorage so that working in one tab
 * keeps the others alive, and an expired stamp signs out all of them.
 *
 * Owner decision 2026-10-26 ("it throws me out too often"): moving the mouse
 * and scrolling count as activity, the limit is a CEO setting
 * (`idle_logout_minutes`, default 120, 0 = off) and two minutes before it a
 * dialog asks whether the user is still there.
 */
const ACTIVITY_KEY = "gmed_last_activity";
const CHECK_INTERVAL_MS = 30_000;
const WARNING_CHECK_INTERVAL_MS = 1_000;
const MIN_CHECK_DELAY_MS = 250;
const WRITE_THROTTLE_MS = 5_000;
export const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "mousemove",
  "scroll",
] as const;

export const DEFAULT_IDLE_LOGOUT_MINUTES = 120;
/** The "are you still there?" dialog opens this long before the sign-out. */
export const IDLE_WARNING_MS = 2 * 60_000;

function asMinutes(value: unknown): number | null {
  const parsed = typeof value === "string" ? (value.trim() === "" ? Number.NaN : Number(value)) : value;
  // 0 switches the timer off (kiosk-style demo screens); junk is ignored.
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * The limit in minutes: the server setting (`GET /me` → `idle_logout_minutes`)
 * when present, else the build-time `VITE_IDLE_LOGOUT_MINUTES`, else the default.
 */
export function resolveIdleLogoutMinutes(raw: string | undefined, serverMinutes?: number | null): number {
  return asMinutes(serverMinutes) ?? asMinutes(raw) ?? DEFAULT_IDLE_LOGOUT_MINUTES;
}

export function isIdleExpired(lastActivity: number | null, now: number, limitMinutes: number): boolean {
  return idlePhase(lastActivity, now, limitMinutes).kind === "expired";
}

export type IdlePhase =
  | { kind: "active"; warningAt: number | null }
  | { kind: "warning"; deadline: number }
  | { kind: "expired" };

/** Where the session stands: working, in the last two minutes (`deadline` = sign-out), or over. */
export function idlePhase(lastActivity: number | null, now: number, limitMinutes: number): IdlePhase {
  if (limitMinutes <= 0 || lastActivity === null) return { kind: "active", warningAt: null };
  const limitMs = limitMinutes * 60_000;
  const deadline = lastActivity + limitMs;
  if (now >= deadline) return { kind: "expired" };
  // A limit shorter than the warning window signs out without a dialog.
  if (limitMs <= IDLE_WARNING_MS) return { kind: "active", warningAt: null };
  const warningAt = deadline - IDLE_WARNING_MS;
  return now >= warningAt ? { kind: "warning", deadline } : { kind: "active", warningAt };
}

export interface IdleTrackerOptions {
  limitMinutes: number;
  now?: () => number;
  readStamp: () => number | null;
  writeStamp: (value: number) => void;
  onIdle: () => void;
  /** The sign-out moment while the warning is due, null when it is not. Called on change only. */
  onWarning: (deadline: number | null) => void;
}

export interface IdleTracker {
  /** Input in this tab. Ignored while the warning is open: only "continue" (or another tab) ends it. */
  activity: () => void;
  /** "Continue working": a fresh stamp for every tab, the warning closes. */
  stayActive: () => void;
  /** Re-evaluates the phase; returns the delay until the next check. */
  check: () => number;
}

/** The timer logic without the DOM, so it can be driven with a fake clock. */
export function createIdleTracker(options: IdleTrackerOptions): IdleTracker {
  const now = options.now ?? Date.now;
  let lastSeen = now();
  let lastWritten = Number.NEGATIVE_INFINITY;
  let warningDeadline: number | null = null;
  let ended = false;

  const write = (value: number) => {
    lastWritten = value;
    options.writeStamp(value);
  };
  const setWarning = (deadline: number | null) => {
    if (deadline === warningDeadline) return;
    warningDeadline = deadline;
    options.onWarning(deadline);
  };

  write(lastSeen);

  return {
    activity() {
      if (ended || warningDeadline !== null) return;
      lastSeen = now();
      if (lastSeen - lastWritten >= WRITE_THROTTLE_MS) write(lastSeen);
    },
    stayActive() {
      if (ended) return;
      lastSeen = now();
      write(lastSeen);
      setWarning(null);
    },
    check() {
      if (ended) return CHECK_INTERVAL_MS;
      const at = now();
      const phase = idlePhase(Math.max(lastSeen, options.readStamp() ?? 0), at, options.limitMinutes);
      if (phase.kind === "expired") {
        ended = true;
        setWarning(null);
        options.onIdle();
        return CHECK_INTERVAL_MS;
      }
      if (phase.kind === "warning") {
        setWarning(phase.deadline);
        return WARNING_CHECK_INTERVAL_MS;
      }
      setWarning(null);
      // Wake up when the warning is due, so it opens a full two minutes early.
      return phase.warningAt === null
        ? CHECK_INTERVAL_MS
        : Math.min(CHECK_INTERVAL_MS, Math.max(MIN_CHECK_DELAY_MS, phase.warningAt - at));
    },
  };
}

function readLastActivity(): number | null {
  try {
    const raw = window.localStorage.getItem(ACTIVITY_KEY);
    const parsed = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeLastActivity(value: number) {
  try {
    window.localStorage.setItem(ACTIVITY_KEY, String(value));
  } catch {
    // Storage can be unavailable (private mode); the in-memory stamp still works.
  }
}

export interface IdleLogoutState {
  /** When the session ends unless the user continues; null while no warning is due. */
  warningDeadline: number | null;
  stayActive: () => void;
}

export function useIdleLogout(active: boolean, onIdle: () => void, limitMinutes: number): IdleLogoutState {
  const onIdleRef = useRef(onIdle);
  const trackerRef = useRef<IdleTracker | null>(null);
  const [warningDeadline, setWarningDeadline] = useState<number | null>(null);
  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (!active || limitMinutes <= 0) return undefined;

    let timer = 0;
    const tracker = createIdleTracker({
      limitMinutes,
      readStamp: readLastActivity,
      writeStamp: writeLastActivity,
      onIdle: () => onIdleRef.current(),
      onWarning: setWarningDeadline,
    });
    trackerRef.current = tracker;
    const check = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, tracker.check());
    };
    const touch = () => tracker.activity();
    // Coming back to a tab that slept past the limit must not count as activity.
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    // Activity or "continue" in another tab closes this tab's warning at once.
    const onStorage = (event: StorageEvent) => {
      if (event.key === ACTIVITY_KEY) check();
    };

    // Capture: scrolling inside a panel does not bubble to the window.
    const listenerOptions = { capture: true, passive: true } as const;
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, touch, listenerOptions);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onStorage);
    check();

    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, touch, listenerOptions);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
      window.clearTimeout(timer);
      if (trackerRef.current === tracker) trackerRef.current = null;
      setWarningDeadline(null);
    };
  }, [active, limitMinutes]);

  const stayActive = useCallback(() => trackerRef.current?.stayActive(), []);
  return { warningDeadline, stayActive };
}
