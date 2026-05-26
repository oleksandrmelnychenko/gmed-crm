import * as React from "react"

const DIRTY_DISMISS_REASONS = new Set([
  "outside-press",
  "escape-key",
  "focus-out",
  "close-watcher",
  "close-press",
])

export const CONFIRMED_DISMISS_REASON = "confirmed-dismiss"
const AUXILIARY_OVERLAY_SELECTOR = "[data-overlay-interaction-root]"
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
  confirmDismiss: (onConfirm?: () => void) => boolean
  markDirty: () => void
  resetDirty: () => void
}

export const OverlayDirtyContext =
  React.createContext<OverlayDirtyContextValue | null>(null)

export function useOverlayDirtyMarker() {
  const dirtyContext = React.useContext(OverlayDirtyContext)

  return React.useCallback(() => {
    dirtyContext?.markDirty()
  }, [dirtyContext])
}

export function useOverlayDirtyReset() {
  const dirtyContext = React.useContext(OverlayDirtyContext)

  return React.useCallback(() => {
    dirtyContext?.resetDirty()
  }, [dirtyContext])
}

export function useOverlayDirtyNativeListeners<T extends HTMLElement>() {
  const dirtyContext = React.useContext(OverlayDirtyContext)
  const contentRef = React.useRef<T | null>(null)

  React.useEffect(() => {
    const content = contentRef.current

    if (!content || !dirtyContext) {
      return
    }

    const markDirty = () => {
      dirtyContext.markDirty()
    }

    content.addEventListener("beforeinput", markDirty, true)
    content.addEventListener("input", markDirty, true)
    content.addEventListener("change", markDirty, true)
    content.addEventListener("paste", markDirty, true)

    return () => {
      content.removeEventListener("beforeinput", markDirty, true)
      content.removeEventListener("input", markDirty, true)
      content.removeEventListener("change", markDirty, true)
      content.removeEventListener("paste", markDirty, true)
    }
  }, [dirtyContext])

  return contentRef
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
