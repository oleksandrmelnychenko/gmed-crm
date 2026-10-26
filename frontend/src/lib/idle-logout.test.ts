import { describe, expect, it, vi } from "vitest";

import { formatIdleCountdown, idleWarningText } from "@/components/idle-warning-dialog";

import {
  ACTIVITY_EVENTS,
  DEFAULT_IDLE_LOGOUT_MINUTES,
  IDLE_WARNING_MS,
  createIdleTracker,
  idlePhase,
  isIdleExpired,
  resolveIdleLogoutMinutes,
} from "./idle-logout";

const MINUTE = 60_000;

/** A tracker on a hand-moved clock with a shared stamp, like two tabs of one origin. */
function harness(limitMinutes: number, shared?: { stamp: number | null }) {
  const clock = { now: 1_000_000 };
  const storage = shared ?? { stamp: null as number | null };
  const onIdle = vi.fn();
  const warnings: Array<number | null> = [];
  const tracker = createIdleTracker({
    limitMinutes,
    now: () => clock.now,
    readStamp: () => storage.stamp,
    writeStamp: (value) => { storage.stamp = value; },
    onIdle,
    onWarning: (deadline) => warnings.push(deadline),
  });
  return { clock, storage, onIdle, warnings, tracker };
}

describe("idle logout", () => {
  it("expires once the limit has passed without activity", () => {
    const start = 1_000_000;
    expect(isIdleExpired(start, start + 29 * MINUTE, 30)).toBe(false);
    expect(isIdleExpired(start, start + 30 * MINUTE, 30)).toBe(true);
  });

  it("never expires when switched off or without a stamp", () => {
    expect(isIdleExpired(0, Number.MAX_SAFE_INTEGER, 0)).toBe(false);
    expect(isIdleExpired(null, Number.MAX_SAFE_INTEGER, 30)).toBe(false);
  });

  it("defaults to 120 minutes and lets the server value override the build-time one", () => {
    expect(DEFAULT_IDLE_LOGOUT_MINUTES).toBe(120);
    expect(resolveIdleLogoutMinutes(undefined)).toBe(DEFAULT_IDLE_LOGOUT_MINUTES);
    expect(resolveIdleLogoutMinutes("abc")).toBe(DEFAULT_IDLE_LOGOUT_MINUTES);
    expect(resolveIdleLogoutMinutes("-5")).toBe(DEFAULT_IDLE_LOGOUT_MINUTES);
    expect(resolveIdleLogoutMinutes("0")).toBe(0);
    expect(resolveIdleLogoutMinutes("15")).toBe(15);
    expect(resolveIdleLogoutMinutes(undefined, 45)).toBe(45);
    expect(resolveIdleLogoutMinutes("15", 240)).toBe(240);
    expect(resolveIdleLogoutMinutes("15", 0)).toBe(0);
    // A server without the setting leaves the build-time value in charge.
    expect(resolveIdleLogoutMinutes("15", null)).toBe(15);
    expect(resolveIdleLogoutMinutes("15", undefined)).toBe(15);
  });

  it("counts mouse movement and scrolling as activity", () => {
    expect(ACTIVITY_EVENTS).toEqual(expect.arrayContaining(["mousemove", "scroll", "pointerdown", "keydown"]));
  });

  it("opens the warning two minutes before the limit", () => {
    const start = 1_000_000;
    expect(idlePhase(start, start + 117 * MINUTE, 120)).toEqual({ kind: "active", warningAt: start + 118 * MINUTE });
    expect(idlePhase(start, start + 118 * MINUTE, 120)).toEqual({ kind: "warning", deadline: start + 120 * MINUTE });
    expect(idlePhase(start, start + 120 * MINUTE, 120)).toEqual({ kind: "expired" });
    // A limit within the warning window signs out without a dialog.
    expect(idlePhase(start, start + 30_000, 1)).toEqual({ kind: "active", warningAt: null });
  });

  it("mouse movement keeps the session alive", () => {
    const { clock, onIdle, warnings, tracker } = harness(15);
    clock.now += 10 * MINUTE;
    tracker.activity();
    clock.now += 10 * MINUTE;
    tracker.check();
    expect(warnings).toEqual([]);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("warns at limit minus two minutes, then signs out at the limit", () => {
    const { clock, onIdle, warnings, tracker } = harness(15);
    const start = clock.now;
    clock.now = start + 12 * MINUTE;
    // The next check is planned for the moment the warning is due.
    expect(tracker.check()).toBe(30_000);
    clock.now = start + 13 * MINUTE - 10_000;
    expect(tracker.check()).toBe(10_000);
    clock.now = start + 13 * MINUTE;
    expect(tracker.check()).toBe(1_000);
    expect(warnings).toEqual([start + 15 * MINUTE]);
    // Input while the dialog is open does not end it on its own.
    tracker.activity();
    clock.now = start + 15 * MINUTE;
    tracker.check();
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(warnings).toEqual([start + 15 * MINUTE, null]);
  });

  it("continue resets the stamp and closes the warning", () => {
    const { clock, storage, onIdle, warnings, tracker } = harness(15);
    clock.now += 13 * MINUTE + 30_000;
    tracker.check();
    expect(warnings).toHaveLength(1);
    tracker.stayActive();
    expect(storage.stamp).toBe(clock.now);
    expect(warnings).toEqual([warnings[0], null]);
    clock.now += 12 * MINUTE;
    tracker.check();
    expect(onIdle).not.toHaveBeenCalled();
    expect(warnings).toHaveLength(2);
  });

  it("activity in another tab closes the warning through the shared stamp", () => {
    const shared = { stamp: null as number | null };
    const first = harness(15, shared);
    first.clock.now += 13 * MINUTE;
    first.tracker.check();
    expect(first.warnings).toHaveLength(1);
    shared.stamp = first.clock.now; // another tab wrote a fresh stamp
    first.tracker.check();
    expect(first.warnings.at(-1)).toBeNull();
  });

  it("0 switches the timer off", () => {
    const { clock, onIdle, warnings, tracker } = harness(0);
    clock.now += 10_000 * MINUTE;
    tracker.check();
    expect(onIdle).not.toHaveBeenCalled();
    expect(warnings).toEqual([]);
  });

  it("speaks the owner's wording and counts down in m:ss", () => {
    expect(idleWarningText("ru")).toMatchObject({
      title: "Вы ещё здесь?",
      body: "Через 2 минуты вы выйдете из системы из-за бездействия.",
      stay: "Продолжить работу",
      signOut: "Выйти",
    });
    expect(idleWarningText("de")).toMatchObject({
      title: "Sind Sie noch da?",
      body: "In 2 Minuten werden Sie wegen Inaktivität abgemeldet.",
      stay: "Weiterarbeiten",
      signOut: "Abmelden",
    });
    expect(idleWarningText("uk").stay).toBe("Продовжити роботу");
    expect(idleWarningText("en").stay).toBe("Continue working");
    expect(formatIdleCountdown(IDLE_WARNING_MS)).toBe("2:00");
    expect(formatIdleCountdown(61_500)).toBe("1:02");
    expect(formatIdleCountdown(-5)).toBe("0:00");
  });
});
