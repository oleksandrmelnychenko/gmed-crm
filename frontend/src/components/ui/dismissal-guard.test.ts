import { describe, expect, it } from "vitest"

import {
  confirmDirtyDismiss,
  isInternalOverlayInteractionEvent,
  isOverlayDirty,
  isOverlayDismissReason,
  shouldConfirmDirtyDismiss,
} from "./dismissal-guard"

describe("dismissal guard", () => {
  it("asks for confirmation only when a dirty surface is being dismissed", () => {
    expect(shouldConfirmDirtyDismiss(false, "outside-press", true)).toBe(true)
    expect(shouldConfirmDirtyDismiss(false, "escape-key", true)).toBe(true)
    expect(shouldConfirmDirtyDismiss(false, "close-press", true)).toBe(true)
  })

  it("allows clean surfaces to close without confirmation", () => {
    expect(shouldConfirmDirtyDismiss(false, "outside-press", false)).toBe(false)
    expect(shouldConfirmDirtyDismiss(false, "escape-key", false)).toBe(false)
    expect(shouldConfirmDirtyDismiss(false, "close-press", false)).toBe(false)
  })

  it("does not intercept opening or unrelated close reasons", () => {
    expect(shouldConfirmDirtyDismiss(true, "outside-press", true)).toBe(false)
    expect(shouldConfirmDirtyDismiss(false, "trigger-press", true)).toBe(false)
    expect(shouldConfirmDirtyDismiss(false, "imperative-action", true)).toBe(false)
  })

  it("recognizes supported dismiss reasons", () => {
    expect(isOverlayDismissReason("outside-press")).toBe(true)
    expect(isOverlayDismissReason("escape-key")).toBe(true)
    expect(isOverlayDismissReason("trigger-press")).toBe(false)
  })

  it("treats missing overlay interaction events as external", () => {
    expect(isInternalOverlayInteractionEvent(undefined)).toBe(false)
  })

  it("uses controlled dirty as the source of truth when provided", () => {
    expect(isOverlayDirty(false, true)).toBe(false)
    expect(isOverlayDirty(false, false)).toBe(false)
    expect(isOverlayDirty(true, false)).toBe(true)
    expect(isOverlayDirty(undefined, true)).toBe(true)
  })

  it("confirms only dirty dismissals", () => {
    const confirmCalls: string[] = []
    const confirm = (message: string) => {
      confirmCalls.push(message)
      return false
    }

    expect(confirmDirtyDismiss(false, "Unsaved data", confirm)).toBe(true)
    expect(confirmDirtyDismiss(true, "Unsaved data", confirm)).toBe(false)
    expect(confirmCalls).toEqual(["Unsaved data"])
  })
})
