"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  createConfirmedDismissEventDetails,
  isOverlayDirty,
  isCancelDismissControl,
  isInternalOverlayInteractionEvent,
  OverlayDirtyContext,
  shouldConfirmDirtyDismiss,
  useOverlayDirtyNativeListeners,
} from "@/components/ui/dismissal-guard"
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog"
import { useLang } from "@/lib/i18n"
import { XIcon } from "lucide-react"

type DialogRootProps = DialogPrimitive.Root.Props & {
  allowImplicitDismissal?: boolean
  dirty?: boolean
}

function Dialog({
  allowImplicitDismissal = false,
  dirty,
  onOpenChange,
  open,
  ...props
}: DialogRootProps) {
  const { t } = useLang()
  const isDirtyRef = React.useRef(false)
  const actionsRef = React.useRef<DialogPrimitive.Root.Actions | null>(null)
  const allowConfirmedDismissRef = React.useRef(false)
  const pendingConfirmActionRef = React.useRef<(() => void) | null>(null)
  const [internalDirty, setInternalDirty] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const getCurrentDirty = React.useCallback(
    () => isOverlayDirty(dirty, internalDirty || isDirtyRef.current),
    [dirty, internalDirty],
  )

  React.useEffect(() => {
    if (dirty === false) {
      isDirtyRef.current = false
      setInternalDirty(false)
    }
  }, [dirty])

  const resetInternalDirty = React.useCallback(() => {
    isDirtyRef.current = false
    setInternalDirty(false)
  }, [])

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
  const markDirty = React.useCallback(() => {
    isDirtyRef.current = true
    setInternalDirty(true)
  }, [])
  const dirtyContext = React.useMemo(
    () => ({ confirmDismiss, markDirty, resetDirty: resetInternalDirty }),
    [confirmDismiss, markDirty, resetInternalDirty],
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
        confirmLabel={t.common_ok}
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
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
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
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  const { t } = useLang()
  const dirtyContext = React.useContext(OverlayDirtyContext)
  const contentRef = useOverlayDirtyNativeListeners<HTMLDivElement>()

  const handleChangeCapture = React.useCallback<
    React.FormEventHandler<HTMLDivElement>
  >(
    (event) => {
      dirtyContext?.markDirty()
      ;(onChangeCapture as ((event: unknown) => void) | undefined)?.(event)
    },
    [dirtyContext, onChangeCapture]
  )

  const handleInputCapture = React.useCallback<
    React.FormEventHandler<HTMLDivElement>
  >(
    (event) => {
      dirtyContext?.markDirty()
      ;(onInputCapture as ((event: unknown) => void) | undefined)?.(event)
    },
    [dirtyContext, onInputCapture]
  )

  const handleClickCapture = React.useCallback<
    React.MouseEventHandler<HTMLDivElement>
  >(
    (event) => {
      if (
        dirtyContext &&
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
      <DialogOverlay />
      <DialogPrimitive.Popup
        ref={contentRef}
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        onChangeCapture={handleChangeCapture}
        onClickCapture={handleClickCapture}
        onInputCapture={handleInputCapture}
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
        "font-heading text-base leading-none font-medium",
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
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
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
