import { describe, expect, it } from "vitest"
import { createOverlayDirtyTracker } from "./overlay-dirty-tracker"

describe("overlay dirty values", () => {
  it("becomes clean when all edits are reverted", () => {
    const tracker = createOverlayDirtyTracker()
    tracker.update("name", "Original", "Changed")
    tracker.update("enabled", "true", "false")
    tracker.update("name", "Changed", "Original")
    expect(tracker.isDirty()).toBe(true)
    tracker.update("enabled", "false", "true")
    expect(tracker.isDirty()).toBe(false)
    tracker.update("name", "Original", "Second edit")
    expect(tracker.isDirty()).toBe(true)
  })

  it("ignores same-value changes and starts fresh for another editing session", () => {
    const tracker = createOverlayDirtyTracker()
    tracker.update("date", "2026-09-05", "2026-09-05")
    expect(tracker.isDirty()).toBe(false)
    tracker.update("date", "2026-09-05", "2026-09-06")
    tracker.reset()
    expect(tracker.isDirty()).toBe(false)
    tracker.update("date", "2026-10-01", "2026-10-02")
    tracker.update("date", "2026-10-02", "2026-10-01")
    expect(tracker.isDirty()).toBe(false)
  })
})
