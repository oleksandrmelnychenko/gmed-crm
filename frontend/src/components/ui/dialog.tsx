"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  createConfirmedDismissEventDetails,
  isOverlayDirty,
  isOwnOverlayEvent,
  isCancelDismissControl,
  isInternalOverlayInteractionEvent,
  OverlayDirtyContext,
  shouldConfirmDirtyDismiss,
  useOverlayDirtyNativeListeners,
} from "@/components/ui/dismissal-guard"
import { createOverlayDirtyTracker } from "@/components/ui/overlay-dirty-tracker"
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog"
import { useLang } from "@/lib/i18n"
import { XIcon } from "lucide-react"

type DialogRootProps = DialogPrimitive.Root.Props & {
  allowImplicitDismissal?: boolean
  dirty?: boolean
  requireChanges?: boolean
}

function Dialog({
  allowImplicitDismissal = false,
  requireChanges = false,
  dirty,
  onOpenChange,
  open,
  ...props
}: DialogRootProps) {
  const { t } = useLang()
  const [dirtyTracker] = React.useState(createOverlayDirtyTracker)
  const actionsRef = React.useRef<DialogPrimitive.Root.Actions | null>(null)
  const allowConfirmedDismissRef = React.useRef(false)
  const pendingConfirmActionRef = React.useRef<(() => void) | null>(null)
  const [internalDirty, setInternalDirty] = React.useState(false)
  const [resetVersion, bumpResetVersion] = React.useReducer((version: number) => version + 1, 0)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const getCurrentDirty = React.useCallback(
    () => isOverlayDirty(dirty, dirtyTracker.isDirty()),
    [dirty, dirtyTracker],
  )

  React.useEffect(() => {
    if (dirty === false || open === false) {
      dirtyTracker.reset()
      bumpResetVersion()
      setInternalDirty(false)
    }
  }, [dirty, dirtyTracker, open])

  const resetInternalDirty = React.useCallback(() => {
    dirtyTracker.reset()
    bumpResetVersion()
    setInternalDirty(false)
  }, [dirtyTracker])

  const closeAfterConfirmedDismiss = React.useCallback(() => {
    if (open !== undefined) {
      onOpenChange?.(
        false,
        createConfirmedDismissEventDetails() as Parameters<
          NonNullable<DialogPrimitive.Root.Props["onOpenChange"]>
        >[1],
      )
      return
    }

    actionsRef.current?.close()
  }, [onOpenChange, open])

  const confirmDismiss = React.useCallback((onConfirm?: () => void) => {
    if (allowImplicitDismissal) {
      return true
    }

    if (allowConfirmedDismissRef.current) {
      return true
    }

    const currentDirty = getCurrentDirty()

    if (!currentDirty) {
      return true
    }

    pendingConfirmActionRef.current = onConfirm ?? closeAfterConfirmedDismiss
    setConfirmOpen(true)

    return false
  }, [
    allowImplicitDismissal,
    closeAfterConfirmedDismiss,
    getCurrentDirty,
  ])
  const handleConfirmDismiss = React.useCallback(() => {
    const action = pendingConfirmActionRef.current ?? closeAfterConfirmedDismiss

    pendingConfirmActionRef.current = null
    setConfirmOpen(false)
    allowConfirmedDismissRef.current = true
    resetInternalDirty()
    action()
    window.setTimeout(() => {
      allowConfirmedDismissRef.current = false
    }, 0)
  }, [closeAfterConfirmedDismiss, resetInternalDirty])
  const handleCancelDismiss = React.useCallback(() => {
    pendingConfirmActionRef.current = null
    setConfirmOpen(false)
  }, [])
  const updateField = React.useCallback((key: unknown, previous: string, current: string) => {
    const previousDirty = dirtyTracker.isDirty()
    dirtyTracker.update(key, previous, current)
    // Native capture runs before React commits the field value. Publish after
    // its onChange handler, while getCurrentDirty can still read synchronously.
    if (previousDirty !== dirtyTracker.isDirty()) {
      window.setTimeout(() => setInternalDirty(dirtyTracker.isDirty()), 0)
    }
  }, [dirtyTracker])
  const dirtyContext = React.useMemo(
    () => ({ confirmDismiss, updateField, resetDirty: resetInternalDirty, resetVersion, requireChanges, isDirty: isOverlayDirty(dirty, internalDirty) }),
    [confirmDismiss, dirty, internalDirty, updateField, resetInternalDirty, resetVersion, requireChanges],
  )

  const handleOpenChange = React.useCallback<
    NonNullable<DialogPrimitive.Root.Props["onOpenChange"]>
  >(
    (open, eventDetails) => {
      if (open) {
        resetInternalDirty()
      }

      if (!open && eventDetails.reason === "focus-out") {
        eventDetails.cancel()
        return
      }

      if (
        !open &&
        eventDetails.reason === "outside-press" &&
        isInternalOverlayInteractionEvent(eventDetails.event)
      ) {
        eventDetails.cancel()
        return
      }

      if (
        !allowImplicitDismissal &&
        shouldConfirmDirtyDismiss(
          open,
          eventDetails.reason,
          getCurrentDirty(),
        )
      ) {
        if (!confirmDismiss(closeAfterConfirmedDismiss)) {
          eventDetails.cancel()
          return
        }
      }

      onOpenChange?.(open, eventDetails)
    },
    [
      allowImplicitDismissal,
      closeAfterConfirmedDismiss,
      confirmDismiss,
      getCurrentDirty,
      onOpenChange,
      resetInternalDirty,
    ]
  )

  return (
    <>
      <OverlayDirtyContext.Provider value={dirtyContext}>
        <DialogPrimitive.Root
          actionsRef={actionsRef}
          data-slot="dialog"
          onOpenChange={handleOpenChange}
          open={open}
          {...props}
        />
      </OverlayDirtyContext.Provider>
      <DirtyDismissConfirmDialog
        open={confirmOpen}
        title={t.common_discard_unsaved_confirm}
        message={t.common_overlay_dismiss_blocked}
        cancelLabel={t.common_cancel}
        confirmLabel={t.common_discard_unsaved_action}
        onCancel={handleCancelDismiss}
        onConfirm={handleConfirmDismiss}
      />
    </>
  )
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        // No backdrop-filter on the animated overlay: animating opacity over a
        // full-viewport blur layer flashes the whole page in Chrome on macOS
        // (compositor promote/demote glitch at animation start and end).
        "fixed inset-0 isolate z-50 bg-black/20 duration-100 motion-reduce:animate-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  onChangeCapture,
  onClickCapture,
  onInputCapture,
  onSubmitCapture,
  overlayClassName,
  showOverlay = true,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  overlayClassName?: string
  showOverlay?: boolean
  showCloseButton?: boolean
}) {
  const { t } = useLang()
  const dirtyContext = React.useContext(OverlayDirtyContext)
  const contentRef = useOverlayDirtyNativeListeners<HTMLDivElement>()
  const handleSubmitCapture: React.FormEventHandler<HTMLDivElement> = (event) => {
    if (isOwnOverlayEvent(event) && dirtyContext?.requireChanges && !dirtyContext.isDirty) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    ;(onSubmitCapture as ((event: unknown) => void) | undefined)?.(event)
  }

  const handleClickCapture = React.useCallback<
    React.MouseEventHandler<HTMLDivElement>
  >(
    (event) => {
      if (
        dirtyContext &&
        isOwnOverlayEvent(event) &&
        isCancelDismissControl(event.target, t.common_cancel) &&
        !dirtyContext.confirmDismiss()
      ) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      ;(onClickCapture as ((event: unknown) => void) | undefined)?.(event)
    },
    [dirtyContext, onClickCapture, t.common_cancel]
  )

  return (
    <DialogPortal>
      {showOverlay ? <DialogOverlay className={overlayClassName} /> : null}
      <DialogPrimitive.Popup
        ref={contentRef}
        data-slot="dialog-content"
        className={cn(
          "fixed left-2 right-2 bottom-2 z-50 grid max-h-[calc(100dvh-1rem)] w-auto max-w-none gap-4 overflow-y-auto overscroll-contain rounded-xl bg-popover p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm text-popover-foreground shadow-2xl ring-1 ring-foreground/10 duration-100 outline-none motion-reduce:animate-none sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:pb-4 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        onChangeCapture={onChangeCapture}
        onClickCapture={handleClickCapture}
        onInputCapture={onInputCapture}
        onSubmitCapture={handleSubmitCapture}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">{t.common_close}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  const { t } = useLang()
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          {t.common_close}
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading break-words pr-8 text-base leading-snug font-medium sm:leading-none",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "break-words text-sm leading-relaxed text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
}
