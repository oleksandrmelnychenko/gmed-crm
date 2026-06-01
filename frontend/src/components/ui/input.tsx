import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { DatePicker } from "@mui/x-date-pickers/DatePicker"
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker"
import { TimePicker } from "@mui/x-date-pickers/TimePicker"
import dayjs from "dayjs"

import { cn } from "@/lib/utils"

const DATE_FORMAT = "YYYY-MM-DD"
const DATETIME_LOCAL_FORMAT = "YYYY-MM-DD HH:mm"
const DATETIME_LOCAL_VALUE_FORMAT = "YYYY-MM-DDTHH:mm"
const TIME_FORMAT = "HH:mm"

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

function parseTimeValue(value: string | number | readonly string[] | undefined) {
  if (typeof value !== "string" || value.length === 0) {
    return null
  }
  const match = value.match(/^(\d{1,2}):(\d{1,2})$/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return dayjs().hour(hour).minute(minute).second(0).millisecond(0)
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

export function normalizeInputStep(
  type: React.ComponentProps<"input">["type"],
  step: React.ComponentProps<"input">["step"],
) {
  return type === "time" && step === undefined ? 60 : step
}

export function timePickerMinutesStep(step: React.ComponentProps<"input">["step"]) {
  if (step === undefined || step === "any") {
    return 1
  }
  const seconds = typeof step === "number" ? step : Number(step)
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 1
  }
  return Math.max(1, Math.round(seconds / 60))
}

function getPickerControlStyle(className: string | undefined) {
  const isTall = hasClassToken(className, "h-10")
  const isShellHeight = hasClassToken(className, "h-9")
  const isRoundedXl = hasClassToken(className, "rounded-xl")
  const hasSlateBorder = hasClassToken(className, "border-slate-200")
  const hasSlateBackground = hasClassToken(className, "bg-slate-50")
  const hasCardBackground = hasClassToken(className, "bg-card")
  const controlHeight = isTall ? "2.5rem" : isShellHeight ? "2.25rem" : "2rem"
  const controlRadius = isRoundedXl ? "0.75rem" : "0.5rem"
  const controlBorderColor = hasSlateBorder ? "rgb(226 232 240)" : "var(--input)"
  const controlBackground = hasSlateBackground
    ? "rgb(248 250 252)"
    : hasCardBackground
      ? "var(--card)"
      : "transparent"

  return {
    controlHeight,
    controlRadius,
    controlBorderColor,
    controlBackground,
  }
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
  step,
  ...props
}: React.ComponentProps<"input">) {
  if (type === "date" || type === "datetime-local" || type === "time") {
    const {
      controlHeight,
      controlRadius,
      controlBorderColor,
      controlBackground,
    } = getPickerControlStyle(className)
    const htmlInputProps = {
      ...props,
      min,
      max,
      step,
      "aria-label": typeof props["aria-label"] === "string" ? props["aria-label"] : undefined,
    }
    const sharedTextFieldProps = {
      id,
      name,
      required,
      onBlur,
      fullWidth: true,
      className: "w-full",
      size: "small" as const,
      error: props["aria-invalid"] === true || props["aria-invalid"] === "true",
      slotProps: {
        input: {
          className: cn(
            "w-full min-w-0 px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
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
              boxShadow: "0 0 0 2px rgba(249, 115, 22, 0.18)",
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
            "& .MuiPickersInputBase-sectionsContainer, & .MuiPickersSectionList-sectionContent, & .MuiPickersInputBase-sectionContent": {
              fontSize: "0.8125rem",
              lineHeight: 1.4,
            },
          },
        },
        htmlInput: htmlInputProps,
      },
    }

    if (type === "datetime-local") {
      return (
        <DateTimePicker
          value={parseDateValue(value)}
          onChange={(nextDate, context) => {
            if (context.validationError) {
              return
            }
            const formatted = nextDate && nextDate.isValid()
              ? nextDate.format(DATETIME_LOCAL_VALUE_FORMAT)
              : ""
            emitDateChange(onChange, formatted, id, name)
          }}
          minDateTime={typeof min === "string" && min ? parseDateValue(min) ?? undefined : undefined}
          maxDateTime={typeof max === "string" && max ? parseDateValue(max) ?? undefined : undefined}
          disabled={disabled}
          readOnly={props.readOnly}
          format={DATETIME_LOCAL_FORMAT}
          ampm={false}
          slotProps={{
            textField: sharedTextFieldProps,
          }}
        />
      )
    }

    if (type === "time") {
      return (
        <TimePicker
          value={parseTimeValue(value)}
          onChange={(nextDate, context) => {
            if (context.validationError) {
              return
            }
            const formatted = nextDate && nextDate.isValid() ? nextDate.format(TIME_FORMAT) : ""
            emitDateChange(onChange, formatted, id, name)
          }}
          minTime={typeof min === "string" && min ? parseTimeValue(min) ?? undefined : undefined}
          maxTime={typeof max === "string" && max ? parseTimeValue(max) ?? undefined : undefined}
          disabled={disabled}
          readOnly={props.readOnly}
          format={TIME_FORMAT}
          ampm={false}
          minutesStep={timePickerMinutesStep(step)}
          views={["hours", "minutes"]}
          slotProps={{
            textField: sharedTextFieldProps,
          }}
        />
      )
    }

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
        readOnly={props.readOnly}
        format={DATE_FORMAT}
        slotProps={{
          textField: sharedTextFieldProps,
        }}
      />
    )
  }

  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
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
      step={normalizeInputStep(type, step)}
      {...props}
    />
  )
}

export { Input }
