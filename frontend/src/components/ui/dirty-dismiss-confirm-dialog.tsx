import * as React from "react"
import { createPortal } from "react-dom"

import { Button } from "@/components/ui/button"

type DirtyDismissConfirmDialogProps = {
  cancelLabel: string
  confirmLabel: string
  message: string
  onCancel: () => void
  onConfirm: () => void
  open: boolean
  title: string
}

export function DirtyDismissConfirmDialog({
  cancelLabel,
  confirmLabel,
  message,
  onCancel,
  onConfirm,
  open,
  title,
}: DirtyDismissConfirmDialogProps) {
  const cancelButtonRef = React.useRef<HTMLButtonElement | null>(null)

  React.useEffect(() => {
    if (!open) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      cancelButtonRef.current?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [open])

  React.useEffect(() => {
    if (!open) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }

    document.addEventListener("keydown", handleKeyDown, true)

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [onCancel, open])

  if (!open || typeof document === "undefined") {
    return null
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/25 px-4 py-6"
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dirty-dismiss-confirm-title"
        aria-describedby="dirty-dismiss-confirm-message"
        className="w-full max-w-[420px] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-2xl"
        onPointerDown={(event) => {
          event.stopPropagation()
        }}
      >
        <div className="space-y-2">
          <h2
            id="dirty-dismiss-confirm-title"
            className="text-sm font-semibold text-foreground"
          >
            {title}
          </h2>
          <p
            id="dirty-dismiss-confirm-message"
            className="text-sm leading-5 text-muted-foreground"
          >
            {message}
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            ref={cancelButtonRef}
            type="button"
            variant="outline"
            className="h-9 rounded-lg"
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            className="h-9 rounded-lg"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
