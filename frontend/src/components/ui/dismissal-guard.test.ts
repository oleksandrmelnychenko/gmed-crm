import { afterEach, describe, expect, it, vi } from "vitest"

import {
  confirmDirtyDismiss,
  isAuxiliaryOverlayEscape,
  isCancelDismissControl,
  isInternalOverlayInteractionEvent,
  isOverlayDirty,
  isOverlayDismissReason,
  shouldConfirmDirtyDismiss,
} from "./dismissal-guard"

describe("dismissal guard", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("leaves the cancel button of an inline form to that form (QA D-08)", () => {
    class FakeElement {
      attributes: Record<string, string>
      textContent: string
      constructor(attributes: Record<string, string>, textContent: string) {
        this.attributes = attributes
        this.textContent = textContent
      }
      closest() {
        return this
      }
      getAttribute(name: string) {
        return this.attributes[name] ?? null
      }
      hasAttribute(name: string) {
        return name in this.attributes
      }
    }
    vi.stubGlobal("Element", FakeElement)
    vi.stubGlobal("HTMLElement", FakeElement)

    expect(isCancelDismissControl(new FakeElement({}, "Отмена") as unknown as EventTarget, "Отмена")).toBe(true)
    expect(
      isCancelDismissControl(
        new FakeElement({ "data-inline-cancel": "" }, "Отмена") as unknown as EventTarget,
        "Отмена",
      ),
    ).toBe(false)
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

  it("treats MUI mobile picker dialogs as internal overlay interactions", () => {
    class FakeElement {
      closest(selector: string) {
        return selector.includes(".MuiDialog-root") ||
          selector.includes(".MuiPickersModalDialog-root")
          ? this
          : null
      }
    }
    vi.stubGlobal("Element", FakeElement)

    const event = { target: new FakeElement() } as unknown as Event

    expect(isInternalOverlayInteractionEvent(event)).toBe(true)
  })

  it("keeps the dialog open on Escape inside a list over it, not on Escape in the dialog itself", () => {
    class FakeElement {
      inPopup: boolean
      constructor(inPopup: boolean) {
        this.inPopup = inPopup
      }
      closest(selector: string) {
        if (this.inPopup) return selector.includes("[data-overlay-interaction-root]") ? this : null
        return selector.includes("[data-slot='dialog-content']") ? this : null
      }
    }
    vi.stubGlobal("Element", FakeElement)

    const inList = { target: new FakeElement(true) } as unknown as Event
    const inDialog = { target: new FakeElement(false) } as unknown as Event

    expect(isAuxiliaryOverlayEscape("escape-key", inList)).toBe(true)
    expect(isAuxiliaryOverlayEscape("escape-key", inDialog)).toBe(false)
    expect(isAuxiliaryOverlayEscape("outside-press", inList)).toBe(false)
    expect(isAuxiliaryOverlayEscape("escape-key", undefined)).toBe(false)
  })

  it("keeps the dialog open on an Escape a list inside it already handled, however often the dialog hears it", () => {
    class FakeElement {
      closest() {
        return null
      }
    }
    vi.stubGlobal("Element", FakeElement)

    // QA 2026-10-25, F-V1: the list closed and prevented the default; the dialog
    // must not ask "close without saving?" for the same key press.
    const handled = { target: new FakeElement(), defaultPrevented: true } as unknown as Event
    expect(isAuxiliaryOverlayEscape("escape-key", handled)).toBe(true)
    expect(isAuxiliaryOverlayEscape("escape-key", handled)).toBe(true)
    const own = { target: new FakeElement(), defaultPrevented: false } as unknown as Event
    expect(isAuxiliaryOverlayEscape("escape-key", own)).toBe(false)
  })

  it("closes the dialog on Escape in the search input of a list that is already closing", () => {
    // Closest-match emulation: the list root carries data-closed during its exit animation.
    class FakeElement {
      closing: boolean
      constructor(closing: boolean) {
        this.closing = closing
      }
      closest(selector: string) {
        const match = selector
          .split(", ")
          .some((part) => part.startsWith("[data-overlay-interaction-root]") && (!this.closing || !part.includes(":not([data-closed])")))
        return match ? this : null
      }
    }
    vi.stubGlobal("Element", FakeElement)

    expect(isAuxiliaryOverlayEscape("escape-key", { target: new FakeElement(false) } as unknown as Event)).toBe(true)
    expect(isAuxiliaryOverlayEscape("escape-key", { target: new FakeElement(true) } as unknown as Event)).toBe(false)
  })

  it("keeps the dialog open on Escape in a combobox input whose list is open", () => {
    class FakeElement {
      expanded: boolean
      constructor(expanded: boolean) {
        this.expanded = expanded
      }
      closest(selector: string) {
        return this.expanded && selector.includes("[aria-expanded='true']") ? this : null
      }
    }
    vi.stubGlobal("Element", FakeElement)

    const openList = { target: new FakeElement(true) } as unknown as Event
    const closedList = { target: new FakeElement(false) } as unknown as Event

    expect(isAuxiliaryOverlayEscape("escape-key", openList)).toBe(true)
    expect(isAuxiliaryOverlayEscape("escape-key", closedList)).toBe(false)
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
