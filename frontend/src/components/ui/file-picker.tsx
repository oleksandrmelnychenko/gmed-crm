/**
 * App-styled file picker instead of the bare native control.
 *
 * A visible `<input type="file">` shows the browser's own button and status texts in the browser's
 * language ("Вибрати файл", "Keine ausgewählt"), not in the app's. This picker keeps the real file
 * input in the DOM — visually hidden but focusable, so the label of the surrounding field still
 * names it, keyboard users reach it with Tab and open it with Enter or Space, and tests keep calling
 * `setInputFiles` on it — and draws an app button (a `<label>` for the input, so a click opens the
 * file chooser natively) and the chosen file's name in the app language.
 *
 * Inside a read-only scope it renders disabled like `Input`.
 */

import { Upload } from "lucide-react";
import * as React from "react";

import { readOnlyDisables, useReadOnly, type ReadOnlyExemptProps } from "@/components/read-only-scope";
import { buttonVariants } from "@/components/ui/button";
import { formatUiText, useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type FilePickerTexts = {
  choose: string;
  chooseMultiple: string;
  none: string;
  /** With `{count}`. */
  count: string;
};

/** What the picker says next to its button: the chosen file's name, a count, or "none". */
export function filePickerSummary(files: readonly File[], texts: FilePickerTexts): string {
  if (files.length === 0) return texts.none;
  if (files.length === 1) return files[0].name;
  return formatUiText(texts.count, { count: files.length });
}

function asFileList(selected: readonly File[] | File | null | undefined): File[] | undefined {
  if (selected === undefined) return undefined;
  if (selected === null) return [];
  if (selected instanceof File) return [selected];
  return [...selected];
}

export type FilePickerProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "children" | "className"
> &
  ReadOnlyExemptProps & {
    ref?: React.Ref<HTMLInputElement>;
    /**
     * The files to show as chosen when the page keeps them in its state (and resets them after an
     * upload). Without it the picker shows what was chosen last.
     */
    selected?: readonly File[] | File | null;
    /** `false` for pickers that upload at once and reset: only the button is shown. */
    showSelection?: boolean;
    /** Text of the button; default "Datei auswählen" / "Выбрать файл" (plural with `multiple`). */
    buttonLabel?: string;
    /** Text while nothing is chosen; default "Keine Datei ausgewählt" / "Файл не выбран". */
    emptyLabel?: string;
    /** Classes of the wrapper. */
    className?: string;
    /** Classes of the button. */
    buttonClassName?: string;
  };

export function FilePicker({
  ref,
  id,
  selected,
  showSelection = true,
  buttonLabel,
  emptyLabel,
  className,
  buttonClassName,
  multiple,
  disabled,
  onChange,
  ...props
}: FilePickerProps) {
  const { t } = useLang();
  const generatedId = React.useId();
  const inputId = id ?? `file-picker-${generatedId}`;
  const readOnly = useReadOnly();
  const isDisabled =
    Boolean(disabled) ||
    readOnlyDisables(readOnly, { "data-readonly": props["data-readonly"], type: "file" });
  const [chosen, setChosen] = React.useState<File[]>([]);
  const shown = asFileList(selected) ?? chosen;
  const texts: FilePickerTexts = {
    choose: t.file_picker_choose,
    chooseMultiple: t.file_picker_choose_multiple,
    none: emptyLabel ?? t.file_picker_none,
    count: t.file_picker_count,
  };
  const label = buttonLabel ?? (multiple ? texts.chooseMultiple : texts.choose);

  return (
    <div data-slot="file-picker" className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <input
        {...props}
        ref={ref}
        id={inputId}
        type="file"
        multiple={multiple}
        disabled={isDisabled}
        className="peer sr-only"
        onChange={(event) => {
          setChosen(Array.from(event.currentTarget.files ?? []));
          onChange?.(event);
        }}
      />
      <label
        htmlFor={inputId}
        data-slot="file-picker-button"
        className={cn(
          buttonVariants({ variant: "outline", size: "default" }),
          "peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
          "peer-disabled:pointer-events-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
          buttonClassName,
        )}
      >
        <Upload aria-hidden />
        {label}
      </label>
      {showSelection ? (
        <span
          data-slot="file-picker-selection"
          aria-live="polite"
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            shown.length ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {filePickerSummary(shown, texts)}
        </span>
      ) : null}
    </div>
  );
}
