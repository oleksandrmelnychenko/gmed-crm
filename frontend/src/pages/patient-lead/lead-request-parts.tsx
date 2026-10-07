import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, FileText, LoaderCircle, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { checkboxClass, selectClass, tokens } from "@/components/record-workspace/primitives/design-tokens";
import { ApiRequestError } from "@/lib/api";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import {
  giveLeadConsent,
  revokeLeadConsent,
  type LeadRequest,
  type LeadRequestDocument,
} from "./lead-request-api";
import { consentGiven, formatFileSize, type PersonalField, type SaveState } from "./lead-request-model";
import type { StepId } from "./lead-request-steps";
import type { LeadRequestText } from "./lead-request-text";

// Building blocks the steps and sections of the lead cabinet share.

/** The steps of the cabinet; "follow_up" ("Ergänzende Angaben") only while the server opened blocks. */
export type Step = StepId;

export function errorBody(error: unknown): Record<string, unknown> | null {
  return error instanceof ApiRequestError && error.body ? (error.body as Record<string, unknown>) : null;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs the requests of one lead request one after another; see `useRequestQueue`. */
export type RequestQueue = <Result>(task: () => Promise<Result>) => Promise<Result>;

/**
 * The cabinet's writes answer with the whole request, and the page shows the
 * last answer. The parts of the form save on their own, so two answers could
 * arrive in the wrong order and leave an older state on screen. Through this
 * queue one write starts when the one before has answered.
 */
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
 * Autosave of a part of the form: `save` runs once the draft has rested for
 * 700 ms, and at once when the step is left, so the last entry before "next"
 * is not lost. `save` itself sends only what changed.
 */
export function useAutosave<Draft>(draft: Draft, save: (snapshot: Draft) => void) {
  const latest = useRef({ draft, save });
  latest.current = { draft, save };

  useEffect(() => {
    const timer = window.setTimeout(() => save(draft), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draft, save]);

  useEffect(() => () => latest.current.save(latest.current.draft), []);
}

const STEP_COUNT = 8;

/** The bottom bar of a step, as in the staff lead wizard: progress and save state above the buttons. */
export function StepFooter({
  index,
  total = STEP_COUNT,
  text,
  status,
  children,
}: {
  index: number;
  /** Nine with the follow-up step. */
  total?: number;
  text: LeadRequestText;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    // The page scrolls with a bottom padding; the `after` strip covers the form that would show through it.
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-border bg-card px-4 py-3 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-5 after:bg-card sm:-mx-5 sm:px-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>{text.stepOf(index, total)}</span>
        {status}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">{children}</div>
    </div>
  );
}

export function FormField({
  field,
  text,
  error,
  required = false,
  className,
  children,
}: {
  field: PersonalField;
  text: LeadRequestText;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <LabeledField
      id={`lead-request-${field}`}
      label={text.fields[field]}
      error={error}
      required={required}
      className={className}
    >
      {children}
    </LabeledField>
  );
}

/**
 * The asterisk of a required field. The word joiner keeps it on the line of
 * the last word: a long question must not end with an asterisk of its own line.
 */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-destructive">
      {"⁠*"}
    </span>
  );
}

/**
 * A label, its control and the error below it. `question` shows the label as
 * a sentence to read (the legal questions) instead of a short field name.
 */
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

/** A yes/no answer: the same select as the insurance question, empty until answered. */
export function YesNoSelect({
  id,
  value,
  text,
  onChange,
  keepAnswer = false,
  className,
  invalid = false,
}: {
  id: string;
  value: string;
  text: LeadRequestText;
  onChange: (answer: string) => void;
  /** An answer that cannot be taken back: the list then offers only yes and no. */
  keepAnswer?: boolean;
  className?: string;
  invalid?: boolean;
}) {
  return (
    <NativeComboboxSelect
      id={id}
      className={cn(selectClass, className)}
      value={value}
      hidePlaceholderOption={keepAnswer}
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

export function SaveIndicator({ state, text }: { state: SaveState; text: LeadRequestText }) {
  if (state === "idle") return null;
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="lead-request-save-state"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        state === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {state === "saving" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
      {state === "saved" ? <Check aria-hidden="true" className="size-3.5 text-emerald-600" /> : null}
      {state === "error" ? <CircleAlert aria-hidden="true" className="size-3.5" /> : null}
      {state === "saving" ? text.saving : state === "saved" ? text.saved : text.notSaved}
    </span>
  );
}

/** A consent checkbox: checking gives the consent with the shown text, unchecking withdraws it. */
export function ConsentCheckbox({
  request,
  purpose,
  text,
  lang,
  label,
  enqueue,
  onChange,
  testId,
  privacyLink = false,
}: {
  request: LeadRequest;
  purpose: string;
  text: LeadRequestText;
  lang: string;
  label: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  testId: string;
  privacyLink?: boolean;
}) {
  const consent = request.consents[purpose];
  const given = consentGiven(request, purpose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The answer carries only the consent: it goes into the request as it is by then.
  const latest = useRef(request);
  latest.current = request;

  async function toggle(checked: boolean) {
    if (!consent) return;
    if (!checked && !window.confirm(text.consentWithdrawConfirm)) return;
    setBusy(true);
    setError("");
    const withConsent = (givenAt: string | null): LeadRequest => ({
      ...latest.current,
      consents: { ...latest.current.consents, [purpose]: { ...consent, given_at: givenAt } },
    });
    try {
      if (checked) {
        const result = await enqueue(() => giveLeadConsent(request.lead_id, purpose, consent.version, lang));
        onChange(withConsent(result.given_at));
      } else {
        await enqueue(() => revokeLeadConsent(request.lead_id, purpose));
        onChange(withConsent(null));
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-muted/10 px-3 py-3" data-testid={testId}>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className={cn(checkboxClass, "mt-0.5")}
          checked={given}
          disabled={busy || !consent}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <span className="space-y-1">
          <span className="block leading-snug">{label}</span>
          {privacyLink ? (
            <a href="/legal#privacy" target="_blank" rel="noreferrer" className="text-xs text-[var(--brand)] underline">
              {text.privacyLink}
            </a>
          ) : null}
          {given && consent?.given_at ? (
            <span className="block text-xs text-muted-foreground">{text.consentGivenAt(formatAppDateTime(consent.given_at))}</span>
          ) : null}
        </span>
      </label>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * What a step (or a follow-up block) still misses, in words: shown at its
 * top, so the person sees it without going to the summary. Nothing while
 * nothing is missing.
 */
export function MissingList({
  title,
  labels,
  testId,
}: {
  title: string;
  labels: readonly string[];
  testId: string;
}) {
  if (labels.length === 0) return null;
  return (
    <div
      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
      data-testid={testId}
    >
      <p className="font-medium">{title}</p>
      <ul className="mt-1 list-inside list-disc space-y-0.5 text-[13px] leading-5">
        {Array.from(new Set(labels)).map((label) => (
          <li key={label} className="break-words">
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Uploads of one kind with a button and the list (identity copy, proofs):
 * files above 25 MB are refused here, the rest goes one after another through
 * `upload`. The uploads need the request consent first.
 */
export function FileUploadField({
  id,
  label,
  required = false,
  hint,
  emptyText,
  buttonLabel,
  documents,
  consentReady,
  text,
  lang,
  upload,
  remove,
  testId,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint: string;
  emptyText: string;
  buttonLabel: string;
  documents: readonly LeadRequestDocument[];
  consentReady: boolean;
  text: LeadRequestText;
  lang: string;
  upload: (file: File) => Promise<void>;
  remove: (documentId: string) => Promise<void>;
  testId: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    const nextErrors: string[] = [];
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) {
        nextErrors.push(text.fileTooLarge(file.name));
        continue;
      }
      try {
        await upload(file);
      } catch (cause) {
        nextErrors.push(
          errorBody(cause)?.code === "inquiry_consent_required"
            ? text.identityUploadNeedsConsent
            : `${file.name}: ${errorMessage(cause)}`,
        );
      }
    }
    setErrors(Array.from(new Set(nextErrors)));
    setUploading(false);
  }

  return (
    <div className="space-y-2" data-testid={testId}>
      <p id={`${id}-label`} className={tokens.text.label}>
        {label}
        {required ? <RequiredMark /> : null}
      </p>
      <input
        ref={fileInput}
        id={`${id}-files`}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png"
        className="sr-only"
        aria-labelledby={`${id}-label`}
        disabled={!consentReady || uploading}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void uploadFiles(files);
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-8 w-full gap-2 whitespace-normal py-1.5 text-left sm:w-auto"
        disabled={!consentReady || uploading}
        onClick={() => fileInput.current?.click()}
      >
        {uploading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Upload aria-hidden="true" className="size-4" />}
        {uploading ? text.uploading : buttonLabel}
      </Button>
      <p className="text-xs leading-5 text-muted-foreground">{consentReady ? hint : text.identityUploadNeedsConsent}</p>
      {errors.map((message) => (
        <p key={message} role="alert" className="text-xs text-destructive">
          {message}
        </p>
      ))}
      <UploadedFileList
        documents={documents}
        text={text}
        lang={lang}
        emptyText={emptyText}
        testId={`${testId}-list`}
        onRemove={(documentId) => {
          setErrors([]);
          void remove(documentId).catch((cause: unknown) => setErrors([errorMessage(cause)]));
        }}
      />
    </div>
  );
}

/** The uploaded files of a kind (medical documents, copies of the identity document) with "remove". */
export function UploadedFileList({
  documents,
  text,
  lang,
  emptyText,
  testId,
  onRemove,
}: {
  documents: readonly LeadRequestDocument[];
  text: LeadRequestText;
  lang: string;
  emptyText: string;
  testId: string;
  onRemove: (documentId: string) => void;
}) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border" data-testid={testId}>
      {documents.length === 0 ? (
        <li className="px-3 py-3 text-sm text-muted-foreground">{emptyText}</li>
      ) : (
        documents.map((document) => (
          <li key={document.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
            <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{document.file_name ?? "—"}</span>
              <span className="block text-xs text-muted-foreground">
                {[formatAppDateTime(document.uploaded_at), formatFileSize(document.size_bytes, lang)].filter(Boolean).join(" · ")}
                {document.reviewed ? ` · ${text.documentTakenOver}` : ""}
              </span>
            </span>
            {document.can_delete ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={() => onRemove(document.id)}
              >
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
