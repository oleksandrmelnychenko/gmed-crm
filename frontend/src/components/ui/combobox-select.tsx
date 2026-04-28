"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react"

import { cn } from "@/lib/utils"

type PrimitiveValue = string | number

export type ComboboxSelectOption = {
  value: string
  label: React.ReactNode
  disabled?: boolean
  searchText?: string
}

type ComboboxSelectProps = {
  value?: PrimitiveValue | null
  defaultValue?: PrimitiveValue | null
  onValueChange?: (value: string) => void
  options: ComboboxSelectOption[]
  id?: string
  name?: string
  required?: boolean
  disabled?: boolean
  className?: string
  triggerClassName?: string
  placeholder?: React.ReactNode
  searchPlaceholder?: string
  emptyLabel?: React.ReactNode
  autoComplete?: string
  "aria-label"?: string
  "aria-describedby"?: string
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling"
  title?: string
  style?: React.CSSProperties
  onBlur?: React.FocusEventHandler<HTMLButtonElement>
  onFocus?: React.FocusEventHandler<HTMLButtonElement>
}

type NativeComboboxSelectProps = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "children" | "defaultValue" | "multiple" | "onBlur" | "onChange" | "onFocus" | "size" | "value"
> & {
  children?: React.ReactNode
  defaultValue?: PrimitiveValue | readonly string[] | null
  onBlur?: React.FocusEventHandler<HTMLSelectElement>
  onChange?: React.ChangeEventHandler<HTMLSelectElement>
  onFocus?: React.FocusEventHandler<HTMLSelectElement>
  searchPlaceholder?: string
  emptyLabel?: React.ReactNode
  value?: PrimitiveValue | readonly string[] | null
}

function textFromNode(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") {
    return ""
  }

  if (typeof node === "string" || typeof node === "number") {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(textFromNode).join(" ")
  }

  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode }

    return textFromNode(props.children)
  }

  return ""
}

function normalizeValue(value: PrimitiveValue | readonly string[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? ""
  }

  return value == null ? undefined : String(value)
}

function optionsFromChildren(children: React.ReactNode): ComboboxSelectOption[] {
  const options: ComboboxSelectOption[] = []

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child) || child.type !== "option") {
      return
    }

    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement> & {
      children?: React.ReactNode
    }
    const labelText = textFromNode(props.children)
    const value = props.value == null ? labelText : String(props.value)

    options.push({
      value,
      label: props.children ?? value,
      disabled: props.disabled,
      searchText: `${value} ${labelText}`,
    })
  })

  return options
}

function createSelectChangeEvent(value: string, name?: string) {
  const target = { value, name } as HTMLSelectElement

  return {
    target,
    currentTarget: target,
  } as React.ChangeEvent<HTMLSelectElement>
}

function ComboboxSelect({
  value,
  defaultValue,
  onValueChange,
  options,
  id,
  name,
  required,
  disabled,
  className,
  triggerClassName,
  placeholder,
  searchPlaceholder = "Поиск...",
  emptyLabel = "Ничего не найдено",
  autoComplete,
  style,
  title,
  onBlur,
  onFocus,
  ...ariaProps
}: ComboboxSelectProps) {
  const normalizedValue = normalizeValue(value)
  const normalizedDefaultValue = normalizeValue(defaultValue)
  const [uncontrolledValue, setUncontrolledValue] = React.useState(
    normalizedDefaultValue ?? options[0]?.value ?? "",
  )
  const selectedValue = normalizedValue ?? uncontrolledValue

  const optionsByValue = React.useMemo(() => {
    return new Map(options.map((option) => [option.value, option]))
  }, [options])

  const handleValueChange = React.useCallback(
    (nextValue: string | null) => {
      const next = nextValue ?? ""

      if (normalizedValue == null) {
        setUncontrolledValue(next)
      }

      onValueChange?.(next)
    },
    [normalizedValue, onValueChange],
  )

  return (
    <ComboboxPrimitive.Root<string>
      id={id}
      name={name}
      required={required}
      disabled={disabled}
      value={selectedValue}
      onValueChange={handleValueChange}
      items={options.map((option) => option.value)}
      itemToStringLabel={(itemValue) =>
        textFromNode(optionsByValue.get(String(itemValue))?.label ?? itemValue)
      }
      filter={(itemValue, query) => {
        const option = optionsByValue.get(String(itemValue))
        const haystack = `${option?.searchText ?? itemValue}`.toLocaleLowerCase()

        return haystack.includes(query.toLocaleLowerCase())
      }}
      autoHighlight={true}
      modal={false}
    >
      <ComboboxPrimitive.Trigger
        id={id}
        type="button"
        disabled={disabled}
        title={title}
        style={style}
        onBlur={onBlur}
        onFocus={onFocus}
        className={cn(
          "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors outline-none hover:bg-muted/35 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-muted-foreground [&_span]:min-w-0 [&_span]:truncate",
          className,
          triggerClassName,
        )}
        {...ariaProps}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          <ComboboxPrimitive.Value placeholder={placeholder} />
        </span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </ComboboxPrimitive.Trigger>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner sideOffset={4} align="start" className="isolate z-[150]">
          <ComboboxPrimitive.Popup className="relative isolate z-[150] min-w-(--anchor-width) max-w-[min(32rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <div className="flex items-center gap-2 border-b border-border bg-popover px-2.5 py-2">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
              <ComboboxPrimitive.Input
                autoComplete={autoComplete}
                placeholder={searchPlaceholder}
                className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ComboboxPrimitive.List className="max-h-[min(18rem,var(--available-height))] overflow-y-auto p-1">
              {(itemValue: string, index: number) => {
                const option = optionsByValue.get(String(itemValue))

                if (!option) {
                  return null
                }

                return (
                  <ComboboxPrimitive.Item
                    key={`${option.value}-${index}`}
                    value={option.value}
                    disabled={option.disabled}
                    className="relative flex min-h-8 w-full cursor-default select-none items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    <ComboboxPrimitive.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center">
                      <CheckIcon className="size-4" />
                    </ComboboxPrimitive.ItemIndicator>
                  </ComboboxPrimitive.Item>
                )
              }}
            </ComboboxPrimitive.List>
            <ComboboxPrimitive.Empty className="px-3 py-2 text-sm text-muted-foreground">
              {emptyLabel}
            </ComboboxPrimitive.Empty>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  )
}

function NativeComboboxSelect({
  children,
  value,
  defaultValue,
  onChange,
  className,
  disabled,
  required,
  name,
  id,
  autoComplete,
  searchPlaceholder,
  emptyLabel,
  title,
  style,
  onBlur,
  onFocus,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: NativeComboboxSelectProps) {
  const options = React.useMemo(() => optionsFromChildren(children), [children])

  return (
    <ComboboxSelect
      id={id}
      name={name}
      required={required}
      disabled={disabled}
      value={normalizeValue(value)}
      defaultValue={normalizeValue(defaultValue)}
      options={options}
      className={className}
      searchPlaceholder={searchPlaceholder}
      emptyLabel={emptyLabel}
      autoComplete={autoComplete}
      title={title}
      style={style}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      placeholder={options[0]?.label}
      onBlur={(event) => onBlur?.(event as unknown as React.FocusEvent<HTMLSelectElement>)}
      onFocus={(event) => onFocus?.(event as unknown as React.FocusEvent<HTMLSelectElement>)}
      onValueChange={(nextValue) => onChange?.(createSelectChangeEvent(nextValue, name))}
    />
  )
}

export { ComboboxSelect, NativeComboboxSelect }
