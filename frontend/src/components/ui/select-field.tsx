"use client"

import { Select } from "@base-ui/react/select"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import type React from "react"

import { useOverlayDirtyField } from "@/components/ui/dismissal-guard"
import { cn } from "@/lib/utils"

export type SelectFieldOption = {
  value: string
  label: React.ReactNode
  disabled?: boolean
}

export function SelectField({
  value,
  options,
  onValueChange,
  disabled,
  className,
  title,
  "aria-label": ariaLabel,
}: {
  value: string
  options: SelectFieldOption[]
  onValueChange: (value: string) => void
  disabled?: boolean
  className?: string
  title?: string
  "aria-label"?: string
}) {
  const updateOverlayField = useOverlayDirtyField(value)

  return (
    <Select.Root
      value={value}
      disabled={disabled}
      items={options}
      modal={false}
      onValueChange={(nextValue) => {
        if (nextValue == null || nextValue === value) return
        updateOverlayField(nextValue)
        onValueChange(nextValue)
      }}
    >
      <Select.Trigger
        title={title}
        aria-label={ariaLabel}
        className={cn(
          "flex h-9 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-lg border border-input bg-field px-3 py-2 text-sm text-foreground outline-none transition-colors hover:bg-muted/35 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <Select.Value className="min-w-0 flex-1 truncate text-left" />
        <Select.Icon className="shrink-0 text-muted-foreground">
          <ChevronDownIcon className="size-4" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          data-overlay-interaction-root=""
          sideOffset={4}
          align="start"
          alignItemWithTrigger={false}
          className="isolate z-[150]"
        >
          <Select.Popup
            data-overlay-interaction-root=""
            className="relative isolate z-[150] min-w-(--anchor-width) max-w-[min(32rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            <Select.List className="max-h-[min(18rem,var(--available-height))] overflow-y-auto p-1">
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="relative flex min-h-8 w-full cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <Select.ItemText className="min-w-0 flex-1 truncate">
                    {option.label}
                  </Select.ItemText>
                  <Select.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center">
                    <CheckIcon className="size-4" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}
