import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"

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

type SheetRootProps = SheetPrimitive.Root.Props & {
  allowImplicitDismissal?: boolean
  dirty?: boolean
}

function Sheet({
  allowImplicitDismissal = false,
  dirty,
  onOpenChange,
  open,
  ...props
}: SheetRootProps) {
  const { t } = useLang()
  const isDirtyRef = React.useRef(false)
  const actionsRef = React.useRef<SheetPrimitive.Root.Actions | null>(null)
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
          NonNullable<SheetPrimitive.Root.Props["onOpenChange"]>
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
    NonNullable<SheetPrimitive.Root.Props["onOpenChange"]>
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
        <SheetPrimitive.Root
          actionsRef={actionsRef}
          data-slot="sheet"
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

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  inline = false,
  onChangeCapture,
  onClickCapture,
  onInputCapture,
  overlayClassName,
  side = "right",
  showCloseButton = true,
  showOverlay = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  inline?: boolean
  overlayClassName?: string
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  showOverlay?: boolean
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

  if (inline) {
    return (
      <div
        ref={contentRef}
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "flex min-h-0 flex-col gap-4 bg-popover text-sm text-popover-foreground",
          className
        )}
        onChangeCapture={handleChangeCapture}
        onClickCapture={handleClickCapture}
        onInputCapture={handleInputCapture}
        {...(props as React.ComponentProps<"div">)}
      >
        {children}
      </div>
    )
  }

  return (
    <SheetPortal>
      {showOverlay ? <SheetOverlay className={overlayClassName} /> : null}
      <SheetPrimitive.Popup
        ref={contentRef}
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition duration-200 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:data-ending-style:translate-y-[2.5rem] data-[side=bottom]:data-starting-style:translate-y-[2.5rem] data-[side=left]:top-3 data-[side=left]:bottom-3 data-[side=left]:left-3 data-[side=left]:w-3/4 data-[side=left]:rounded-[20px] data-[side=left]:border data-[side=left]:border-border data-[side=left]:data-ending-style:translate-x-[-2.5rem] data-[side=left]:data-starting-style:translate-x-[-2.5rem] data-[side=right]:top-3 data-[side=right]:bottom-3 data-[side=right]:right-3 data-[side=right]:w-3/4 data-[side=right]:rounded-[20px] data-[side=right]:border data-[side=right]:border-border data-[side=right]:data-ending-style:translate-x-[2.5rem] data-[side=right]:data-starting-style:translate-x-[2.5rem] data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-ending-style:translate-y-[-2.5rem] data-[side=top]:data-starting-style:translate-y-[-2.5rem] data-[side=left]:sm:max-w-[50vw] data-[side=right]:sm:max-w-[50vw]",
          className
        )}
        onChangeCapture={handleChangeCapture}
        onClickCapture={handleClickCapture}
        onInputCapture={handleInputCapture}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="absolute right-3 top-3 z-10"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">{t.common_close}</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function useSheetDismissalGuard(onDismiss: () => void) {
  const dirtyContext = React.useContext(OverlayDirtyContext)

  return React.useCallback(() => {
    if (dirtyContext && !dirtyContext.confirmDismiss(onDismiss)) {
      return
    }

    onDismiss()
  }, [dirtyContext, onDismiss])
}

export {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  useSheetDismissalGuard,
}
