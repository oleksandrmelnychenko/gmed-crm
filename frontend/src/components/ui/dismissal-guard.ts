import * as React from "react"

const DIRTY_DISMISS_REASONS = new Set([
  "outside-press",
  "trigger-press",
  "escape-key",
  "focus-out",
  "close-watcher",
  "close-press",
  "imperative-action",
])

export const CONFIRMED_DISMISS_REASON = "confirmed-dismiss"
const AUXILIARY_OVERLAY_SELECTOR = [
  "[data-overlay-interaction-root]",
  ".MuiPickerPopper-root",
  ".MuiPickersPopper-root",
  ".MuiPickersModalDialog-root",
  ".MuiPickersLayout-root",
  ".MuiDateCalendar-root",
  ".MuiTimeClock-root",
  ".MuiDigitalClock-root",
  ".MuiMultiSectionDigitalClock-root",
  ".MuiDialog-root",
  ".MuiModal-root",
].join(", ")
const OVERLAY_CONTENT_SELECTOR =
  "[data-slot='sheet-content'], [data-slot='dialog-content']"

function isElementInside(target: EventTarget | null | undefined, selector: string) {
  if (typeof Element === "undefined" || !(target instanceof Element)) {
    return false
  }

  return Boolean(target.closest(selector))
}

export function isOverlayDismissReason(reason: string) {
  return DIRTY_DISMISS_REASONS.has(reason)
}

export function isInternalOverlayInteractionEvent(event: Event | undefined) {
  if (!event) {
    return false
  }

  const relatedTarget =
    "relatedTarget" in event
      ? (event as FocusEvent).relatedTarget
      : null
  const activeElement =
    typeof document === "undefined" ? null : document.activeElement

  return (
    isElementInside(
      event.target,
      `${AUXILIARY_OVERLAY_SELECTOR}, ${OVERLAY_CONTENT_SELECTOR}`,
    ) ||
    isElementInside(
      relatedTarget,
      `${AUXILIARY_OVERLAY_SELECTOR}, ${OVERLAY_CONTENT_SELECTOR}`,
    ) ||
    isElementInside(activeElement, AUXILIARY_OVERLAY_SELECTOR)
  )
}

export function shouldConfirmDirtyDismiss(
  open: boolean,
  reason: string,
  isDirty: boolean,
) {
  return !open && isDirty && isOverlayDismissReason(reason)
}

export function isOverlayDirty(
  controlledDirty: boolean | undefined,
  markedDirty: boolean,
) {
  return controlledDirty ?? markedDirty
}

export function isOwnOverlayEvent(event: { target: EventTarget | null; currentTarget: EventTarget | null }) {
  return event.target instanceof Element && event.target.closest(OVERLAY_CONTENT_SELECTOR) === event.currentTarget
}

function normalizeDismissalLabel(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim().toLocaleLowerCase() ?? ""
}

export function isCancelDismissControl(
  target: EventTarget | null,
  cancelLabel: string,
) {
  if (!(target instanceof Element)) {
    return false
  }

  const control = target.closest("button, [role='button']")

  if (!control || !(control instanceof HTMLElement)) {
    return false
  }

  if (
    control.getAttribute("data-slot") === "sheet-close" ||
    control.getAttribute("data-slot") === "dialog-close"
  ) {
    return false
  }

  const normalizedCancelLabel = normalizeDismissalLabel(cancelLabel)

  if (!normalizedCancelLabel) {
    return false
  }

  return [
    control.textContent,
    control.getAttribute("aria-label"),
    control.getAttribute("title"),
  ].some((value) => normalizeDismissalLabel(value) === normalizedCancelLabel)
}

export function confirmDirtyDismiss(
  isDirty: boolean,
  message: string,
  confirmFn?: (message: string) => boolean,
) {
  if (!isDirty) {
    return true
  }

  const confirm =
    confirmFn ??
    (typeof window === "undefined" ? (() => true) : window.confirm.bind(window))

  return confirm(message)
}

export type OverlayDirtyContextValue = {
  isDirty: boolean
  requireChanges: boolean
  confirmDismiss: (onConfirm?: () => void) => boolean
  updateField: (key: unknown, previous: string, current: string) => void
  resetDirty: () => void
  resetVersion: number
}

export const OverlayDirtyContext =
  React.createContext<OverlayDirtyContextValue | null>(null)

export function useOverlaySaveDisabled(requireChanges?: boolean) {
  const context = React.useContext(OverlayDirtyContext)
  return Boolean(context && (requireChanges ?? context.requireChanges) && !context.isDirty)
}

export function useOverlayDirtyField(value: string) {
  const dirtyContext = React.useContext(OverlayDirtyContext)
  const updateField = dirtyContext?.updateField
  const key = React.useId()
  const editedRef = React.useRef(false)

  // Keep the comparison in sync with controlled values, including undo/reset.
  React.useLayoutEffect(() => {
    if (editedRef.current) updateField?.(key, value, value)
  }, [updateField, key, value])

  return React.useCallback((nextValue: string) => {
    editedRef.current = true
    updateField?.(key, value, nextValue)
  }, [updateField, key, value])
}

export function useOverlayDirtyReset() {
  const dirtyContext = React.useContext(OverlayDirtyContext)

  return React.useCallback(() => {
    dirtyContext?.resetDirty()
  }, [dirtyContext])
}

export function useOverlayDirtyNativeListeners<T extends HTMLElement>() {
  const dirtyContext = React.useContext(OverlayDirtyContext)
  const updateField = dirtyContext?.updateField
  const resetVersion = dirtyContext?.resetVersion
  return React.useCallback((content: T | null) => {
    if (!content || !updateField) return
    // A saved/discarded draft establishes a new baseline even if the popup is
    // still mounted for its closing animation.

    const baseline = new WeakMap<Element, string>()
    const edited = new WeakSet<Element>()
    const selector = "input, textarea, select"
    const fieldValue = (field: Element) => {
      if (field instanceof HTMLInputElement) {
        if (["hidden", "submit", "button", "reset", "search"].includes(field.type)) return null
        if (field.type === "checkbox" || field.type === "radio") return String(field.checked)
        if (field.type === "file") {
          return JSON.stringify(Array.from(field.files ?? []).map((file) => [file.name, file.size, file.lastModified]))
        }
        return field.value
      }
      if (field instanceof HTMLTextAreaElement) return field.value
      if (field instanceof HTMLSelectElement) return JSON.stringify(Array.from(field.selectedOptions, (option) => option.value))
      return null
    }
    const ownsField = (field: Element) =>
      field.closest(OVERLAY_CONTENT_SELECTOR) === content &&
      !field.closest("[data-overlay-dirty-ignore], [aria-hidden='true']")
    const remember = (field: Element) => {
      if (!ownsField(field) || edited.has(field)) return
      const value = fieldValue(field)
      if (value !== null) baseline.set(field, value)
    }
    const rememberFields = () => content.querySelectorAll(selector).forEach((field) => {
      if (!ownsField(field)) return
      if (!edited.has(field)) {
        remember(field)
        return
      }
      const current = fieldValue(field)
      const initial = baseline.get(field)
      if (current !== null && initial !== undefined) updateField(field, initial, current)
    })
    rememberFields()
    // React also updates default values when a controlled field is reset, e.g.
    // after posting an inline comment. Reconcile those changes without requiring
    // another keystroke. Async/conditional fields establish their own baseline.
    const observer = new MutationObserver(rememberFields)
    observer.observe(content, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["value", "checked"],
    })
    const beforeEdit = (event: Event) => {
      if (event.target instanceof Element) remember(event.target)
    }
    const update = (event: Event) => {
      const field = event.target
      if (!(field instanceof Element) || !ownsField(field)) return
      const current = fieldValue(field)
      if (current === null) return
      const initial = baseline.get(field)
      if (initial === undefined) return
      edited.add(field)
      updateField(field, initial, current)
      // Radio groups and dependent controls can change without their own event.
      content.querySelectorAll(selector).forEach((other) => {
        if (other === field || !ownsField(other)) return
        const value = fieldValue(other)
        const previous = baseline.get(other)
        if (value !== null && previous !== undefined && (edited.has(other) || value !== previous)) {
          edited.add(other)
          updateField(other, previous, value)
        }
      })
    }

    content.addEventListener("focusin", beforeEdit, true)
    content.addEventListener("beforeinput", beforeEdit, true)
    content.addEventListener("input", update, true)
    content.addEventListener("change", update, true)

    return () => {
      observer.disconnect()
      content.removeEventListener("focusin", beforeEdit, true)
      content.removeEventListener("beforeinput", beforeEdit, true)
      content.removeEventListener("input", update, true)
      content.removeEventListener("change", update, true)
    }
  }, [updateField, resetVersion])
}

export function createConfirmedDismissEventDetails() {
  let canceled = false
  let propagationAllowed = false

  return {
    reason: CONFIRMED_DISMISS_REASON,
    event:
      typeof Event === "undefined"
        ? undefined
        : new Event(CONFIRMED_DISMISS_REASON),
    cancel() {
      canceled = true
    },
    allowPropagation() {
      propagationAllowed = true
    },
    get isCanceled() {
      return canceled
    },
    get isPropagationAllowed() {
      return propagationAllowed
    },
    trigger: undefined,
    preventUnmountOnClose() {},
  }
}
