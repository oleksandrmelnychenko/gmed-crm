import { useEffect, useRef } from "react";

/**
 * Signs the user out after a period without any input. An unattended, unlocked
 * workstation is the most likely way patient data gets seen by the wrong
 * person, and a 60-minute access token that refreshes silently for 30 days
 * never ends on its own.
 *
 * The last-activity stamp lives in localStorage so that working in one tab
 * keeps the others alive, and an expired stamp signs out all of them.
 */
const ACTIVITY_KEY = "gmed_last_activity";
const CHECK_INTERVAL_MS = 30_000;
const WRITE_THROTTLE_MS = 5_000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

export const DEFAULT_IDLE_LOGOUT_MINUTES = 30;

export function resolveIdleLogoutMinutes(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_IDLE_LOGOUT_MINUTES;
  const parsed = Number(raw);
  // 0 switches the timer off (kiosk-style demo screens); junk falls back.
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_IDLE_LOGOUT_MINUTES;
  return parsed;
}

export function isIdleExpired(lastActivity: number | null, now: number, limitMinutes: number): boolean {
  if (limitMinutes <= 0 || lastActivity === null) return false;
  return now - lastActivity >= limitMinutes * 60_000;
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

export function useIdleLogout(active: boolean, onIdle: () => void, limitMinutes: number) {
  const onIdleRef = useRef(onIdle);
  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (!active || limitMinutes <= 0) return undefined;

    let lastSeen = Date.now();
    let lastWritten = 0;
    const touch = () => {
      lastSeen = Date.now();
      if (lastSeen - lastWritten >= WRITE_THROTTLE_MS) {
        lastWritten = lastSeen;
        writeLastActivity(lastSeen);
      }
    };
    const check = () => {
      const latest = Math.max(lastSeen, readLastActivity() ?? 0);
      if (isIdleExpired(latest, Date.now(), limitMinutes)) onIdleRef.current();
    };
    // Coming back to a tab that slept past the limit must not count as activity.
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };

    touch();
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, touch, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, touch);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [active, limitMinutes]);
}
