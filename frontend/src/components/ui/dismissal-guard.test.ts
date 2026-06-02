import { afterEach, describe, expect, it, vi } from "vitest"

import {
  confirmDirtyDismiss,
  isInternalOverlayInteractionEvent,
  isOverlayDirty,
  isOverlayDismissReason,
  shouldConfirmDirtyDismiss,
} from "./dismissal-guard"

describe("dismissal guard", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("asks for confirmation only when a dirty surface is being dismissed", () => {
    expect(shouldConfirmDirtyDismiss(false, "outside-press", true)).toBe(true)
    expect(shouldConfirmDirtyDismiss(false, "escape-key", true)).toBe(true)
    expect(shouldConfirmDirtyDismiss(false, "close-press", true)).toBe(true)
    expect(shouldConfirmDirtyDismiss(false, "trigger-press", true)).toBe(true)
    expect(shouldConfirmDirtyDismiss(false, "imperative-action", true)).toBe(true)
  })

  it("allows clean surfaces to close without confirmation", () => {
    expect(shouldConfirmDirtyDismiss(false, "outside-press", false)).toBe(false)
    expect(shouldConfirmDirtyDismiss(false, "escape-key", false)).toBe(false)
    expect(shouldConfirmDirtyDismiss(false, "close-press", false)).toBe(false)
  })

  it("does not intercept opening or unrelated close reasons", () => {
    expect(shouldConfirmDirtyDismiss(true, "outside-press", true)).toBe(false)
    expect(shouldConfirmDirtyDismiss(false, "none", true)).toBe(false)
  })

  it("recognizes supported dismiss reasons", () => {
    expect(isOverlayDismissReason("outside-press")).toBe(true)
    expect(isOverlayDismissReason("escape-key")).toBe(true)
    expect(isOverlayDismissReason("trigger-press")).toBe(true)
    expect(isOverlayDismissReason("imperative-action")).toBe(true)
    expect(isOverlayDismissReason("none")).toBe(false)
  })

  it("treats missing overlay interaction events as external", () => {
    expect(isInternalOverlayInteractionEvent(undefined)).toBe(false)
  })

  it("treats MUI picker poppers as internal overlay interactions", () => {
    class FakeElement {
      closest(selector: string) {
        return selector.includes(".MuiPickerPopper-root") ? this : null
      }
    }
    vi.stubGlobal("Element", FakeElement)

    const event = { target: new FakeElement() } as unknown as Event

    expect(isInternalOverlayInteractionEvent(event)).toBe(true)
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
