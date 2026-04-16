import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { DatePicker } from "@mui/x-date-pickers/DatePicker"
import dayjs from "dayjs"

import { cn } from "@/lib/utils"

const DATE_FORMAT = "YYYY-MM-DD"

function hasClassToken(className: string | undefined, token: string) {
  if (!className) {
    return false
  }
  return className.split(/\s+/).includes(token)
}

function parseDateValue(value: string | number | readonly string[] | undefined) {
  if (typeof value !== "string" || value.length === 0) {
    return null
  }
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed : null
}

function emitDateChange(
  onChange: React.ChangeEventHandler<HTMLInputElement> | undefined,
  nextValue: string,
  id: string | undefined,
  name: string | undefined,
) {
  if (!onChange) {
    return
  }

  const event = {
    target: { value: nextValue, id, name },
    currentTarget: { value: nextValue, id, name },
  } as unknown as React.ChangeEvent<HTMLInputElement>

  onChange(event)
}

function Input({
  className,
  type,
  value,
  onChange,
  id,
  name,
  required,
  disabled,
  onBlur,
  min,
  max,
  ...props
}: React.ComponentProps<"input">) {
  if (type === "date") {
    const isTall = hasClassToken(className, "h-10")
    const isRoundedXl = hasClassToken(className, "rounded-xl")
    const hasSlateBorder = hasClassToken(className, "border-slate-200")
    const hasSlateBackground = hasClassToken(className, "bg-slate-50")
    const controlHeight = isTall ? "2.5rem" : "2rem"
    const controlRadius = isRoundedXl ? "0.75rem" : "0.5rem"
    const controlBorderColor = hasSlateBorder ? "rgb(226 232 240)" : "var(--input)"
    const controlBackground = hasSlateBackground ? "rgb(248 250 252)" : "transparent"

    return (
      <DatePicker
        value={parseDateValue(value)}
        onChange={(nextDate, context) => {
          if (context.validationError) {
            return
          }
          const formatted = nextDate && nextDate.isValid() ? nextDate.format(DATE_FORMAT) : ""
          emitDateChange(onChange, formatted, id, name)
        }}
        minDate={typeof min === "string" && min ? parseDateValue(min) ?? undefined : undefined}
        maxDate={typeof max === "string" && max ? parseDateValue(max) ?? undefined : undefined}
        disabled={disabled}
        format={DATE_FORMAT}
        slotProps={{
          textField: {
            id,
            name,
            required,
            onBlur,
            fullWidth: true,
            className: "w-full",
            size: "small",
            error: props["aria-invalid"] === true || props["aria-invalid"] === "true",
            slotProps: {
              input: {
                className: cn(
                  "w-full min-w-0 px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
                  className,
                ),
                sx: {
                  height: controlHeight,
                  minHeight: controlHeight,
                  borderRadius: controlRadius,
                  backgroundColor: controlBackground,
                  color: "inherit",
                  boxShadow: "none",
                  transitionProperty: "color, background-color, border-color, text-decoration-color, fill, stroke, box-shadow",
                  transitionDuration: "150ms",
                  transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
                  "& .MuiPickersOutlinedInput-notchedOutline": {
                    borderColor: `${controlBorderColor} !important`,
                  },
                  "&:hover .MuiPickersOutlinedInput-notchedOutline": {
                    borderColor: `${controlBorderColor} !important`,
                  },
                  "&.Mui-focused .MuiPickersOutlinedInput-notchedOutline, &.MuiPickersInputBase-focused .MuiPickersOutlinedInput-notchedOutline": {
                    borderColor: `${controlBorderColor} !important`,
                    borderWidth: "1px !important",
                  },
                  "&.MuiPickersInputBase-colorPrimary, &.MuiPickersInputBase-colorSecondary": {
                    color: "inherit",
                  },
                  "&.MuiPickersInputBase-colorPrimary.Mui-focused .MuiPickersOutlinedInput-notchedOutline, &.MuiPickersInputBase-colorPrimary.MuiPickersInputBase-focused .MuiPickersOutlinedInput-notchedOutline": {
                    borderColor: `${controlBorderColor} !important`,
                  },
                  "&.Mui-focused, &.MuiPickersInputBase-focused": {
                    boxShadow: "0 0 0 3px rgba(14, 165, 233, 0.28)",
                  },
                  "&:not(.Mui-focused):not(.MuiPickersInputBase-focused)": {
                    boxShadow: "none",
                  },
                  "&.Mui-error .MuiPickersOutlinedInput-notchedOutline": {
                    borderColor: "var(--destructive)",
                  },
                  "&.Mui-disabled": {
                    opacity: 0.5,
                    cursor: "not-allowed",
                  },
                  "& .MuiPickersInputBase-input": {
                    padding: "0.25rem 0.625rem",
                    fontSize: "0.875rem",
                  },
                },
              },
              htmlInput: {
                "aria-label": typeof props["aria-label"] === "string" ? props["aria-label"] : undefined,
              },
            },
          },
        }}
      />
    )
  }

  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      value={value}
      onChange={onChange}
      id={id}
      name={name}
      required={required}
      disabled={disabled}
      onBlur={onBlur}
      min={min}
      max={max}
      {...props}
    />
  )
}

export { Input }
