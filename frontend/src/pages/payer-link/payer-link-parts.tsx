import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Check, CircleAlert, FileText, LoaderCircle, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { selectClass, tokens } from "@/components/record-workspace/primitives/design-tokens";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/pages/patient-lead/lead-request-model";

import type { PayerDocument } from "./payer-link-api";
import type { PayerLinkText } from "./payer-link-text";

// Small building blocks of the payer page. They follow the lead cabinet's
// (`patient-lead/lead-request-parts.tsx`) but live here: that module brings
// the cabinet's API calls, which a page without an account must not carry.

export type SaveState = "idle" | "saving" | "saved" | "error";

/** Runs the writes one after another, so an older answer never replaces a newer one on screen. */
export type RequestQueue = <Result>(task: () => Promise<Result>) => Promise<Result>;

export function useRequestQueue(): RequestQueue {
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  return useCallback<RequestQueue>((task) => {
    const run = tail.current.then(task);
    // A failed write is the caller's to report; the next one still runs.
    tail.current = run.catch(() => undefined);
    return run;
  }, []);
}

const AUTOSAVE_DELAY_MS = 700;

/**
 * `save` runs once the draft has rested for 700 ms, and at once when the form
 * goes away, so the last entry is not lost. `save` itself sends only what changed.
 */
export function useAutosave<Draft>(draft: Draft, save: (snapshot: Draft) => unknown) {
  const latest = useRef({ draft, save });
  latest.current = { draft, save };

  useEffect(() => {
    const timer = window.setTimeout(() => void save(draft), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draft, save]);

  useEffect(() => () => void latest.current.save(latest.current.draft), []);
}

/** The asterisk of a required field, kept on the line of the last word. */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-destructive">
      {"⁠*"}
    </span>
  );
}

/** A label, its control and the error below it; `question` shows the label as a sentence. */
export function LabeledField({
  id,
  label,
  error,
  required = false,
  question = false,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  question?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <label htmlFor={id} className={cn(question ? "text-sm leading-snug text-foreground" : tokens.text.label, "block")}>
        {label}
        {required ? <RequiredMark /> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A yes/no answer, empty until answered. */
export function YesNoSelect({
  id,
  value,
  text,
  onChange,
  className,
  invalid = false,
  label,
}: {
  id: string;
  value: string;
  text: PayerLinkText;
  onChange: (answer: string) => void;
  className?: string;
  invalid?: boolean;
  label?: string;
}) {
  return (
    <NativeComboboxSelect
      id={id}
      className={cn(selectClass, className)}
      value={value}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-error` : undefined}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{text.choose}</option>
      <option value="yes">{text.yesNo.yes}</option>
      <option value="no">{text.yesNo.no}</option>
    </NativeComboboxSelect>
  );
}

export function SaveIndicator({ state, text }: { state: SaveState; text: PayerLinkText }) {
  if (state === "idle") return null;
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="payer-link-save-state"
      className={cn("inline-flex items-center gap-1.5 text-xs", state === "error" ? "text-destructive" : "text-muted-foreground")}
    >
      {state === "saving" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
      {state === "saved" ? <Check aria-hidden="true" className="size-3.5 text-emerald-600" /> : null}
      {state === "error" ? <CircleAlert aria-hidden="true" className="size-3.5" /> : null}
      {state === "saving" ? text.saving : state === "saved" ? text.saved : text.notSaved}
    </span>
  );
}

/** A note in a box: neutral, amber (check) or red (refused). */
export function Notice({
  tone = "neutral",
  children,
  testId,
  role,
}: {
  tone?: "neutral" | "warning" | "error" | "success";
  children: ReactNode;
  testId?: string;
  role?: "alert" | "status" | "note";
}) {
  return (
    <div
      role={role}
      data-testid={testId}
      className={cn(
        "rounded-lg border px-3 py-2 text-sm leading-snug",
        tone === "neutral" && "border-border bg-muted/10 text-muted-foreground",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200",
        tone === "error" && "border-destructive/30 bg-destructive/5 text-destructive",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200",
      )}
    >
      {children}
    </div>
  );
}

/** Uploaded files of one kind with "remove", the button to add more and what went wrong. */
export function UploadBlock({
  id,
  label,
  required,
  badge,
  hint,
  buttonLabel,
  documents,
  busy,
  errors,
  disabled,
  text,
  lang,
  testId,
  onFiles,
  onRemove,
}: {
  id: string;
  label: string;
  required: boolean;
  badge?: string;
  hint: string;
  buttonLabel: string;
  documents: readonly PayerDocument[];
  busy: boolean;
  errors: readonly string[];
  disabled: boolean;
  text: PayerLinkText;
  lang: string;
  testId: string;
  onFiles: (files: File[]) => void;
  onRemove: (documentId: string) => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <div className="space-y-2" data-testid={testId}>
      <p className={cn(tokens.text.label, "flex flex-wrap items-center gap-x-2")} id={`${id}-label`}>
        <span>
          {label}
          {required ? <RequiredMark /> : null}
        </span>
        {badge ? (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium",
              required ? "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" : "bg-muted text-muted-foreground",
            )}
            data-testid={`${testId}-badge`}
          >
            {badge}
          </span>
        ) : null}
      </p>
      <input
        ref={input}
        id={id}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png"
        className="sr-only"
        aria-labelledby={`${id}-label`}
        disabled={disabled || busy}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          onFiles(files);
        }}
      />
      <Button
        type="button"
        variant="outline"
        // The label may wrap on a phone instead of widening the page.
        className="h-auto min-h-8 w-full gap-2 whitespace-normal py-1.5 text-left sm:w-auto"
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
      >
        {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Upload aria-hidden="true" className="size-4" />}
        {busy ? text.uploading : buttonLabel}
      </Button>
      <p className="text-xs leading-5 text-muted-foreground">{hint}</p>
      {errors.map((message) => (
        <p key={message} role="alert" className="text-xs text-destructive">
          {message}
        </p>
      ))}
      {/* Nothing uploaded yet: no "no file yet" line (QA 2026-10-10), as in the lead cabinet. */}
      {documents.length > 0 ? (
        <DocumentList documents={documents} text={text} lang={lang} emptyText="" onRemove={onRemove} />
      ) : null}
    </div>
  );
}

/** The files of a kind; read-only without `onRemove`. */
export function DocumentList({
  documents,
  text,
  lang,
  emptyText,
  onRemove,
}: {
  documents: readonly PayerDocument[];
  text: PayerLinkText;
  lang: string;
  emptyText: string;
  onRemove?: (documentId: string) => void;
}) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {documents.length === 0 ? (
        <li className="px-3 py-2.5 text-sm text-muted-foreground">{emptyText}</li>
      ) : (
        documents.map((document) => (
          <li key={document.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
            <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{document.file_name ?? "—"}</span>
              <span className="block text-xs text-muted-foreground">
                {[formatAppDateTime(document.uploaded_at), formatFileSize(document.size_bytes, lang)].filter(Boolean).join(" · ")}
                {document.reviewed ? ` · ${text.documentReviewed}` : ""}
              </span>
            </span>
            {onRemove && document.can_delete ? (
              <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 gap-1 text-xs" onClick={() => onRemove(document.id)}>
                <Trash2 aria-hidden="true" className="size-3.5" />
                {text.removeDocument}
              </Button>
            ) : null}
          </li>
        ))
      )}
    </ul>
  );
}
