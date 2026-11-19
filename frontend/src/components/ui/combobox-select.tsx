"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react"

import { readOnlyDisables, useReadOnly, type ReadOnlyExemptProps } from "@/components/read-only-scope"
import { noteMultiSelectPick, useOverlayDirtyField } from "@/components/ui/dismissal-guard"
import { useLang } from "@/lib/i18n"
import { useComboboxText } from "@/components/ui/combobox-text"
import { cn } from "@/lib/utils"

type PrimitiveValue = string | number

type ComboboxSelectOption = {
  value: string
  label: React.ReactNode
  disabled?: boolean
  disabledPresentation?: "group"
  searchText?: string
  /** A catalog price under its service pill: indented, soft highlight, a green check when already picked. */
  variant?: "catalog-price"
  picked?: boolean
}

type ComboboxSelectProps = {
  value?: PrimitiveValue | null
  defaultValue?: PrimitiveValue | null
  onValueChange?: (value: string) => void
  options: ComboboxSelectOption[]
  selectedValues?: readonly PrimitiveValue[]
  showValueIndicator?: boolean
  hidePlaceholderOption?: boolean
  id?: string
  name?: string
  required?: boolean
  disabled?: boolean
  className?: string
  triggerClassName?: string
  placeholder?: React.ReactNode
  /** Compact trigger content; options retain their full labels for browsing and search. */
  selectedLabel?: React.ReactNode
  searchPlaceholder?: string
  emptyLabel?: React.ReactNode
  missingValueLabel?: React.ReactNode | ((value: string) => React.ReactNode)
  autoComplete?: string
  "aria-label"?: string
  "aria-describedby"?: string
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling"
  title?: string
  style?: React.CSSProperties
  onBlur?: React.FocusEventHandler<HTMLButtonElement>
  onFocus?: React.FocusEventHandler<HTMLButtonElement>
  /** Fires as the user types in the built-in search box (for server-driven lookups). */
  onSearchChange?: (query: string) => void
} & ReadOnlyExemptProps

type NativeComboboxSelectProps = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "children" | "defaultValue" | "multiple" | "onBlur" | "onChange" | "onFocus" | "size" | "value"
> & {
  children?: React.ReactNode
  defaultValue?: PrimitiveValue | readonly string[] | null
  onBlur?: React.FocusEventHandler<HTMLSelectElement>
  onChange?: React.ChangeEventHandler<HTMLSelectElement>
  onFocus?: React.FocusEventHandler<HTMLSelectElement>
  selectedValues?: readonly PrimitiveValue[]
  showValueIndicator?: boolean
  hidePlaceholderOption?: boolean
  searchPlaceholder?: string
  emptyLabel?: React.ReactNode
  missingValueLabel?: React.ReactNode | ((value: string) => React.ReactNode)
  onSearchChange?: (query: string) => void
  selectedLabel?: React.ReactNode
  value?: PrimitiveValue | readonly string[] | null
} & ReadOnlyExemptProps

const EMPTY_SELECTED_VALUES: readonly PrimitiveValue[] = []

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

  function collect(nodes: React.ReactNode, groupSearchText = "") {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement(child)) {
        return
      }

      if (child.type === "optgroup") {
        const props = child.props as React.OptgroupHTMLAttributes<HTMLOptGroupElement> & {
          children?: React.ReactNode
          "data-variant"?: "pill"
        }
        const groupLabel = textFromNode(props.label)

        if (groupLabel) {
          options.push({
            value: `__combobox_group_${options.length}_${groupLabel}`,
            label: props["data-variant"] === "pill" ? (
              <span className="inline-flex max-w-full items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-sm font-semibold text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-200">
                <span className="truncate">{props.label}</span>
              </span>
            ) : (
              <span className="text-[11px] font-semibold text-muted-foreground">
                {props.label}
              </span>
            ),
            disabled: true,
            disabledPresentation: "group",
            searchText: groupLabel,
          })
        }

        collect(props.children, groupLabel)
        return
      }

      if (child.type !== "option") {
        return
      }

      const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement> & {
        children?: React.ReactNode
        "data-search-text"?: string
        "data-disabled-presentation"?: "group"
        "data-variant"?: "catalog-price"
        "data-picked"?: boolean
      }
      const labelText = textFromNode(props.children)
      const value = props.value == null ? labelText : String(props.value)

      options.push({
        value,
        label: props.children ?? value,
        disabled: props.disabled,
        disabledPresentation: props["data-disabled-presentation"],
        variant: props["data-variant"],
        picked: props["data-picked"],
        searchText: props["data-search-text"] ?? `${value} ${labelText} ${groupSearchText}`,
      })
    })
  }

  collect(children)

  return options
}

function createSelectChangeEvent(value: string, name?: string) {
  const target = { value, name } as HTMLSelectElement

  return {
    target,
    currentTarget: target,
  } as React.ChangeEvent<HTMLSelectElement>
}

function resolveMissingValueLabel(
  value: string,
  label: React.ReactNode | ((value: string) => React.ReactNode) | undefined,
  fallback: React.ReactNode,
) {
  if (typeof label === "function") {
    return label(value)
  }

  return label ?? fallback
}

function ComboboxSelect({
  value,
  defaultValue,
  onValueChange,
  options,
  selectedValues = EMPTY_SELECTED_VALUES,
  showValueIndicator = true,
  hidePlaceholderOption = false,
  id,
  name,
  required,
  disabled: disabledProp,
  className,
  triggerClassName,
  placeholder,
  selectedLabel,
  searchPlaceholder,
  emptyLabel,
  missingValueLabel,
  autoComplete,
  style,
  title,
  onBlur,
  onFocus,
  onSearchChange,
  "data-readonly": readOnlyExempt,
  ...ariaProps
}: ComboboxSelectProps) {
  const actionsRef = React.useRef<ComboboxPrimitive.Root.Actions | null>(null)
  // When an option was picked: the click that follows the pick lands on the
  // trigger and must not open the list again (QA3: the catalog picker reopened).
  const pickedAtRef = React.useRef(0)
  const swallowReopen = (event: React.SyntheticEvent) => {
    if (Date.now() - pickedAtRef.current > 400) return
    ;(event as React.SyntheticEvent & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.()
    event.preventDefault()
  }
  const isMultiSelect = selectedValues !== EMPTY_SELECTED_VALUES
  const { t } = useLang()
  const pageText = useComboboxText()
  const readOnly = useReadOnly()
  const disabled =
    disabledProp || readOnlyDisables(readOnly, { "data-readonly": readOnlyExempt })
  const normalizedValue = normalizeValue(value)
  const normalizedDefaultValue = normalizeValue(defaultValue)
  const [uncontrolledValue, setUncontrolledValue] = React.useState(
    normalizedDefaultValue ?? options[0]?.value ?? "",
  )
  const selectedValue = normalizedValue ?? uncontrolledValue
  const updateOverlayField = useOverlayDirtyField(selectedValue)
  const resolvedSearchPlaceholder =
    searchPlaceholder
      ? searchPlaceholder
      : pageText?.search ?? t.common_search_placeholder
  const resolvedEmptyLabel =
    emptyLabel ?? pageText?.empty ?? t.common_no_results

  const displayOptions = React.useMemo(() => {
    if (!selectedValue || options.some((option) => option.value === selectedValue)) {
      return options
    }

    const label = resolveMissingValueLabel(
      selectedValue,
      missingValueLabel,
      t.select_missing_value,
    )

    return [
      {
        value: selectedValue,
        label,
        disabled: true,
        disabledPresentation: undefined,
        searchText: textFromNode(label),
      },
      ...options,
    ]
  }, [missingValueLabel, options, selectedValue, t.select_missing_value])

  const optionsByValue = React.useMemo(() => {
    return new Map(displayOptions.map((option) => [option.value, option]))
  }, [displayOptions])
  const listOptions = React.useMemo(
    () => hidePlaceholderOption
      ? displayOptions.filter((option) => option.value !== "")
      : displayOptions,
    [displayOptions, hidePlaceholderOption],
  )
  const selectedValueSet = React.useMemo(
    () => new Set(selectedValues.map((item) => String(item))),
    [selectedValues],
  )

  const handleValueChange = React.useCallback(
    (nextValue: string | null) => {
      const next = nextValue ?? ""

      if (next !== selectedValue) {
        updateOverlayField(next)
      }

      if (normalizedValue == null) {
        setUncontrolledValue(next)
      }

      onValueChange?.(next)
    },
    [updateOverlayField, normalizedValue, onValueChange, selectedValue],
  )

  return (
    <ComboboxPrimitive.Root<string>
      id={id}
      name={name}
      required={required}
      disabled={disabled}
      value={selectedValue}
      onValueChange={handleValueChange}
      onInputValueChange={onSearchChange}
      items={listOptions.map((option) => option.value)}
      itemToStringLabel={(itemValue) =>
        textFromNode(optionsByValue.get(String(itemValue))?.label ?? t.select_missing_value)
      }
      filter={(itemValue, query) => {
        const option = optionsByValue.get(String(itemValue))
        const haystack = `${option?.searchText ?? itemValue}`.toLocaleLowerCase()

        return haystack.includes(query.toLocaleLowerCase())
      }}
      autoHighlight={true}
      modal={false}
      actionsRef={actionsRef}
      // A multi-select closes on each pick; the Escape that follows belongs to
      // it, not to the dialog behind (QA 2026-11-13, F-C2).
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen && eventDetails.reason === "item-press") pickedAtRef.current = Date.now()
        if (!nextOpen && isMultiSelect && eventDetails.reason === "item-press") noteMultiSelectPick()
      }}
    >
      <ComboboxPrimitive.Trigger
        id={id}
        type="button"
        disabled={disabled}
        title={title}
        style={style}
        data-placeholder={!selectedValue && selectedLabel == null ? "" : undefined}
        onBlur={onBlur}
        onFocus={onFocus}
        onPointerDown={swallowReopen}
        onMouseDown={swallowReopen}
        onClick={swallowReopen}
        // Escape while the focus is still on the trigger of an open list (right
        // after opening, before it moves into the search box): the list does
        // not hear the key itself, so the trigger closes it — one Escape, as in
        // the list; the dialog behind sees the handled key and stays (QA
        // 2026-10-25, F-F7).
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.currentTarget.getAttribute("aria-expanded") !== "true") return
          event.preventDefault()
          actionsRef.current?.close()
        }}
        className={cn(
          "flex h-9 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-lg border border-input bg-field px-3 py-2 text-sm text-foreground transition-colors outline-none hover:bg-muted/35 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-[var(--control-placeholder,var(--muted-foreground))] [&_span]:min-w-0 [&_span]:truncate",
          className,
          triggerClassName,
        )}
        {...ariaProps}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {selectedLabel ?? <ComboboxPrimitive.Value placeholder={placeholder} />}
        </span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </ComboboxPrimitive.Trigger>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          data-overlay-interaction-root=""
          sideOffset={4}
          align="start"
          // Kept clear of the screen's edges: on a small phone the flipped popup started above it (QA 2026-11-10, A-5).
          collisionPadding={8}
          className="isolate z-[300]"
        >
          <ComboboxPrimitive.Popup
            data-overlay-interaction-root=""
            className="relative isolate z-[300] min-w-(--anchor-width) max-w-[min(32rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-popover [background-image:linear-gradient(var(--control-popover,var(--popover)),var(--control-popover,var(--popover)))] text-popover-foreground shadow-xl duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            <div className="flex items-center gap-2 border-b border-border bg-[var(--control-popover,var(--popover))] px-2.5 py-2">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
              <ComboboxPrimitive.Input data-overlay-dirty-ignore=""
                autoComplete={autoComplete}
                placeholder={resolvedSearchPlaceholder}
                className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--control-placeholder,var(--muted-foreground))]"
              />
            </div>
            {/* The available height is the whole popup's: the search row above the list takes its share. */}
            <ComboboxPrimitive.List className="max-h-[min(18rem,calc(var(--available-height)-3rem))] overflow-y-auto p-1">
              {(itemValue: string) => {
                const option = optionsByValue.get(String(itemValue))

                if (!option) {
                  return null
                }
                const isChecked =
                  selectedValueSet.has(option.value) ||
                  (showValueIndicator && option.value === selectedValue)
                const { variant, picked } = option as ComboboxSelectOption
                const catalogPrice = variant === "catalog-price"
                const disabledClassName = option.disabled
                  ? option.disabledPresentation === "group" || (catalogPrice && picked)
                    ? "data-disabled:pointer-events-none data-disabled:cursor-default"
                    : "data-disabled:pointer-events-none data-disabled:opacity-50"
                  : undefined

                return (
                  <ComboboxPrimitive.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className={cn(
                      "relative flex min-h-8 w-full cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-none",
                      catalogPrice
                        ? "pl-5 text-foreground data-highlighted:bg-muted/60"
                        : "data-highlighted:bg-[var(--control-highlight,var(--accent))] data-highlighted:text-accent-foreground",
                      disabledClassName,
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    <span className="absolute right-2 flex size-4 items-center justify-center">
                      {catalogPrice && picked ? <CheckIcon aria-hidden="true" className="size-4 text-emerald-600 dark:text-emerald-400" /> : isChecked ? <CheckIcon className="size-4" /> : null}
                    </span>
                  </ComboboxPrimitive.Item>
                )
              }}
            </ComboboxPrimitive.List>
            <ComboboxPrimitive.Empty className="px-3 py-2 text-sm text-muted-foreground">
              {resolvedEmptyLabel}
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
  selectedValues,
  showValueIndicator,
  hidePlaceholderOption,
  autoComplete,
  searchPlaceholder,
  emptyLabel,
  missingValueLabel,
  title,
  style,
  onBlur,
  onFocus,
  onSearchChange,
  selectedLabel,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "data-readonly": readOnlyExempt,
}: NativeComboboxSelectProps) {
  const options = React.useMemo(() => optionsFromChildren(children), [children])

  return (
    <ComboboxSelect
      id={id}
      name={name}
      required={required}
      disabled={disabled}
      data-readonly={readOnlyExempt}
      value={normalizeValue(value)}
      defaultValue={normalizeValue(defaultValue)}
      options={options}
      selectedValues={selectedValues}
      showValueIndicator={showValueIndicator}
      hidePlaceholderOption={hidePlaceholderOption}
      className={className}
      searchPlaceholder={searchPlaceholder}
      emptyLabel={emptyLabel}
      missingValueLabel={missingValueLabel}
      selectedLabel={selectedLabel}
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
      onSearchChange={onSearchChange}
    />
  )
}

export { NativeComboboxSelect }
