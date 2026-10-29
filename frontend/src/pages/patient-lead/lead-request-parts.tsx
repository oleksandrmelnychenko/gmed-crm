import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, CalendarDays, Check, CircleAlert, FileText, Info, LoaderCircle, Lock, Trash2, Upload } from "lucide-react";
import { useCabinetStaffMode } from "./lead-request-staff-mode";
import { StaffConsentRecordFields } from "./lead-request-staff-consent";
import type { StaffConsentRecord } from "./lead-request-api";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { checkboxClass, selectClass } from "@/components/record-workspace/primitives/design-tokens";
import { ApiRequestError } from "@/lib/api";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { useUnsavedGuard } from "@/lib/use-unsaved-guard";
import { cn } from "@/lib/utils";

import {
  giveLeadConsent,
  revokeLeadConsent,
  type LeadRequest,
  type LeadRequestDocument,
} from "./lead-request-api";
import {
  LEAD_UPLOAD_ACCEPT,
  consentGiven,
  type PersonalField,
  type RefusedIdentityCopy,
  type SaveState,
} from "./lead-request-model";
import type { CabinetTarget } from "./lead-request-field-target";
import { SECTION_ANCHORS, type SectionAnchor, type StepId } from "./lead-request-steps";
import type { LeadRequestText } from "./lead-request-text";
import { useServerConflictDismiss, useServerConflictNotice } from "./lead-request-server-sync";

// Building blocks the steps and sections of the lead cabinet share.

/** The steps of the cabinet; "follow_up" ("Ergänzende Angaben") only while the server opened blocks. */
export type Step = StepId;

export { SECTION_ANCHORS, type SectionAnchor };

/**
 * Opens a step (after the open one has saved) and shows a section or a field
 * of it; a link into the step on screen only shows the field.
 */
export type CabinetGoTo = (step: StepId, target?: CabinetTarget) => void;

/** The page's step navigation for sections deep in a step; `null` outside the cabinet page. */
export const CabinetGoToContext = createContext<CabinetGoTo | null>(null);

/**
 * The way from a box that names another section to that section. Nothing
 * where the cabinet page does not navigate (a section rendered on its own).
 */
export function GoToSectionButton({
  step,
  anchor,
  field,
  label,
  testId,
}: {
  step: StepId;
  anchor: SectionAnchor;
  /** The first missing field of the section: the cursor is put there. */
  field?: string;
  label: string;
  testId?: string;
}) {
  const goTo = useContext(CabinetGoToContext);
  if (!goTo) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="mt-2 h-auto min-h-8 max-w-full gap-1.5 whitespace-normal border-amber-300 bg-white py-1.5 text-left text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-transparent dark:text-amber-200 dark:hover:bg-amber-900/30"
      data-testid={testId}
      data-target-step={step}
      data-target-anchor={anchor}
      onClick={() => goTo(step, { anchor, field })}
    >
      {label}
      <ArrowRight aria-hidden="true" className="size-3.5 shrink-0" />
    </Button>
  );
}

/**
 * Whether "Next" (or "send") of the step on screen was pressed: only then do
 * the yellow lists and the "required" messages of empty fields show (owner
 * 2026-10-09, QA 2026-10-10).
 */
export const MissingShownContext = createContext(false);

/**
 * The step says "consent first" once above its uploads (labels audit 2026-10-26, A6): an upload
 * inside it stays disabled without repeating the note.
 */
export const ConsentNoteAboveContext = createContext(false);

/**
 * The keys the step on screen still misses, once its "Next" was pressed, and
 * the word for an empty required field: every field whose id is
 * `lead-request-<key>` then says so below itself, not only the yellow list at
 * the top (QA 2026-10-22: a parent on a phone did not see which field was meant).
 */
export const StepMissingContext = createContext<{ keys: ReadonlySet<string>; message: string } | null>(null);

const FIELD_ID_PREFIX = "lead-request-";

/** The "required" message of a field the step still misses after "Next"; undefined otherwise. */
export function useStepMissingError(id: string): string | undefined {
  const missing = useContext(StepMissingContext);
  if (!missing || !id.startsWith(FIELD_ID_PREFIX)) return undefined;
  return missing.keys.has(id.slice(FIELD_ID_PREFIX.length)) ? missing.message : undefined;
}

export function errorBody(error: unknown): Record<string, unknown> | null {
  return error instanceof ApiRequestError && error.body ? (error.body as Record<string, unknown>) : null;
}

export function errorMessage(error: unknown, text?: LeadRequestText): string {
  if (text) {
    const body = errorBody(error);
    const code = typeof body?.code === "string" ? body.code : error instanceof ApiRequestError ? error.code : undefined;
    if (code === "health_consent_required") return text.healthConsentRequired;
    if (code === "dob_staff_only") return text.dobStaffOnly;
    if (code === "lead_request_guardian_only") return text.guardianOnly;
    if (error instanceof ApiRequestError && error.status === 413) return text.errors.file_too_large;
    // The limit as the server states it (`max_documents`), not a number of the cabinet's own.
    if (code === "too_many_documents" && typeof body?.max_documents === "number") return text.tooManyDocuments(body.max_documents);
    // An iPhone photo (HEIC): how to send it as JPG.
    if (code === "unsupported_file_type" && body?.format === "heic") return text.errors.heic_not_supported;
    return (code && text.errors[code]) || text.errors.request_failed;
  }
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
export function createRequestQueue(): RequestQueue {
  let tail: Promise<unknown> = Promise.resolve();
  // Settles once every write queued so far that is not an upload batch has answered.
  let writesTail: Promise<unknown> = Promise.resolve();
  let uploadBatches = 0;
  const run = <Result,>(task: () => Promise<Result>, upload: boolean) => {
    const result = tail.then(task);
    // A failed write is the caller's to report; the next one still runs.
    tail = result.catch(() => undefined);
    if (upload) {
      uploadBatches += 1;
      void tail.then(() => { uploadBatches -= 1; });
    } else {
      writesTail = tail;
    }
    return result;
  };
  const enqueue: RequestQueue = (task) => run(task, false);
  queueLanes.set(enqueue, {
    upload: (task) => run(task, true),
    read: (task) => writesTail.then(task),
    uploading: () => uploadBatches > 0,
  });
  return enqueue;
}

type QueueLanes = { upload: RequestQueue; read: RequestQueue; uploading: () => boolean };
const queueLanes = new WeakMap<RequestQueue, QueueLanes>();

/**
 * An upload batch in the queue: like any write, but a read through
 * `readAfterWrites` does not wait for it (a long batch must not keep a part
 * that is opened again from showing its form).
 */
export function enqueueUploadBatch<Result>(enqueue: RequestQueue, task: () => Promise<Result>): Promise<Result> {
  const lanes = queueLanes.get(enqueue);
  return lanes ? lanes.upload(task) : enqueue(task);
}

/**
 * A read that never overtakes a save still in flight, but passes upload batches.
 * `uploadsPending` says whether a batch was still running when the read was queued.
 */
export async function readAfterWrites<Result>(
  enqueue: RequestQueue,
  task: () => Promise<Result>,
): Promise<{ result: Result; uploadsPending: boolean }> {
  const lanes = queueLanes.get(enqueue);
  if (!lanes) return { result: await enqueue(task), uploadsPending: false };
  const uploadsPending = lanes.uploading();
  return { result: await lanes.read(task), uploadsPending };
}

export function useRequestQueue(): RequestQueue {
  return useState(createRequestQueue)[0];
}

export type AutosaveFlush = { save: () => Promise<boolean>; version: () => string | undefined };
export const AutosaveFlushContext = createContext<Set<AutosaveFlush> | null>(null);

/**
 * Changes the newest request: `update` gets the request as it is by then, so a
 * part that stores one field (a consent, a summary) never writes a copy of the
 * render its answer started from over the saves of the other parts.
 */
export type RequestPatch = (update: (current: LeadRequest) => LeadRequest) => void;
export const RequestPatchContext = createContext<RequestPatch | null>(null);

/**
 * The way a part changes one field of the request: through the page's patch when
 * it offers one, else through `onChange` with the request as the part saw it last.
 */
export function useRequestPatch(onChange: (request: LeadRequest) => void, request: LeadRequest): RequestPatch {
  const patch = useContext(RequestPatchContext);
  const latest = useRef(request);
  latest.current = request;
  return useCallback<RequestPatch>((update) => {
    if (patch) patch(update);
    else onChange(update(latest.current));
  }, [patch, onChange]);
}
/** Told after an autosave went through: a "could not be saved" notice may be over. */
export const AutosaveSavedContext = createContext<(() => void) | null>(null);

/** An unchanged form can be left while uploads continue in its request queue. */
export function runDraftSave<Result>(enqueue: RequestQueue, fields: ReadonlySet<string>, task: () => Promise<Result>) {
  return fields.size === 0 ? task() : enqueue(task);
}

const AUTOSAVE_DELAY_MS = 700;

/**
 * Autosave of a part of the form: `save` runs once the draft has rested for
 * 700 ms, and at once when the step is left, so the last entry before "next"
 * is not lost. `save` itself sends only what changed.
 */
export function useAutosave<Draft>(draft: Draft, save: (snapshot: Draft) => Promise<boolean> | boolean) {
  const flushers = useContext(AutosaveFlushContext);
  const onSaved = useContext(AutosaveSavedContext);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const latest = useRef({ draft, save });
  const flushed = useRef<{ draft: Draft } | null>(null);
  latest.current = { draft, save };
  // The entry is lost when the tab is closed or the phone drops the page
  // before the delay ran out, a save answered or a refused one was corrected.
  const track = useUnsavedGuard(draft, save);

  useEffect(() => {
    const saveLatest = async () => {
      // Include typing that happened while an earlier save was in flight.
      for (;;) {
        const current = latest.current;
        try {
          if (!(await track(current.draft, current.save(current.draft)))) return false;
          flushed.current = { draft: current.draft };
        } catch {
          return false;
        }
        if (JSON.stringify(current.draft) === JSON.stringify(latest.current.draft)) return true;
      }
    };
    const flush: AutosaveFlush = { save: saveLatest, version: () => JSON.stringify(latest.current.draft) };
    flushers?.add(flush);
    return () => { flushers?.delete(flush); };
  }, [flushers, track]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      flushed.current = null;
      void Promise.resolve(track(draft, save(draft)))
        .then((saved) => {
          if (saved) onSavedRef.current?.();
        })
        .catch(() => undefined);
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draft, save, track]);

  useEffect(() => () => {
    // Navigation already saved this snapshot. React may batch the server's
    // normalized draft with unmounting; sending the old snapshot again would
    // overwrite that correction before the new step mounts.
    if (flushed.current && JSON.stringify(flushed.current.draft) === JSON.stringify(latest.current.draft)) return;
    void Promise.resolve(latest.current.save(latest.current.draft)).catch(() => undefined);
  }, []);
}

/**
 * A section of the cabinet as a card (owner 2026-10-09): a header line with the
 * marker and the title, the fields below, on the grey background of the step.
 */
export function CabinetSection({
  title,
  accessory,
  children,
  className,
  compact = false,
}: {
  title: ReactNode;
  accessory?: ReactNode;
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <section className={cn("min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card", className)}>
      <div className={cn("flex flex-wrap items-center justify-between gap-2", compact ? "px-3 pt-3" : "px-4 pt-4")}>
        <div className="flex min-w-0 items-center gap-2">
          <div aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="min-w-0 max-w-full break-words text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {accessory ? <div className="min-w-0 max-w-full">{accessory}</div> : null}
      </div>
      <div className={cn("space-y-3", compact ? "p-3" : "p-4")}>{children}</div>
    </section>
  );
}

/** Shared explanatory note for the cabinet, including its conditional steps. */
export function CabinetHint({ children, testId, className }: { children: ReactNode; testId?: string; className?: string }) {
  return (
    <div role="note" data-testid={testId} className={cn("flex min-w-0 items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200", className)}>
      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Consent metadata uses the same amber chip as the staff wizard. */
export function ConsentGivenChip({ children }: { children: ReactNode }) {
  return (
    <StatusChip tone="warning">
      <Check aria-hidden="true" className="size-3 shrink-0" />
      {children}
    </StatusChip>
  );
}

/**
 * "Give the consent first" next to an uploader: an amber note with a sign, so
 * the reason why the button is disabled is seen at once (owner 2026-10-09).
 */
export function ConsentNeededNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="note"
      className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium leading-5 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
      data-testid="lead-request-consent-needed"
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** The bottom bar of a step, as in the staff lead wizard: progress and save state above the buttons. */
/**
 * The buttons of a step and its save state. No "step n of m" here: the step list
 * (desktop) or the line under the dots (phone) says it once (labels audit 2026-10-26, A5).
 */
export function StepFooter({
  status,
  children,
}: {
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    // The step's flex gap separates content from the sticky bar without a scrolling colour strip.
    <div className="sticky bottom-0 z-10 -mx-4 mt-auto shrink-0 bg-card sm:-mx-5">
      <div className="border-t border-border/60 bg-card px-4 py-2.5 sm:px-5">
        {status ? (
          <div className="mb-1.5 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {status}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">{children}</div>
      </div>
    </div>
  );
}

export function FormField({
  field,
  text,
  error,
  required = false,
  className,
  label,
  children,
}: {
  field: PersonalField;
  text: LeadRequestText;
  error?: string;
  required?: boolean;
  className?: string;
  /** Another label than the field's own (the child's phone in a parent's login). */
  label?: string;
  children: ReactNode;
}) {
  return (
    <LabeledField
      id={`lead-request-${field}`}
      label={label ?? text.fields[field]}
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
  aside,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  question?: boolean;
  className?: string;
  /** A small control on the label's line, at its right end (e.g. "same as phone"); the field keeps its height. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const stepMissing = useStepMissingError(id);
  // Another parent (or GMED) changed this field while it was being typed in (owner 2026-10-23).
  const serverChanged = useServerConflictNotice(id);
  // Seen: the notice goes as soon as the person is in the field (QA 2026-10-24, B-7).
  const dismissServerChanged = useServerConflictDismiss(id);
  const shownError = error ?? (required ? stepMissing : undefined);
  const labelElement = (
    <label htmlFor={id} data-cabinet-field-label className={cn("block font-mono text-xs font-medium leading-5 text-foreground/75", question && "leading-relaxed")}>
      {label}
      {required ? <RequiredMark /> : null}
    </label>
  );
  return (
    <div className={cn("min-w-0 space-y-1.5", className)} onFocusCapture={serverChanged ? dismissServerChanged : undefined}>
      {aside ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
          {labelElement}
          {aside}
        </div>
      ) : (
        labelElement
      )}
      {children}
      {shownError ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {shownError}
        </p>
      ) : null}
      {serverChanged ? (
        <p className="text-xs text-muted-foreground" data-testid={`${id}-server-changed`} role="status">
          {serverChanged}
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
    <StatusChip
      role="status"
      aria-live="polite"
      data-testid="lead-request-save-state"
      tone={state === "error" ? "error" : state === "saved" ? "success" : "info"}
    >
      {state === "saving" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
      {state === "saved" ? <Check aria-hidden="true" className="size-3.5 text-emerald-600" /> : null}
      {state === "error" ? <CircleAlert aria-hidden="true" className="size-3.5" /> : null}
      {state === "saving" ? text.saving : state === "saved" ? text.saved : text.notSaved}
    </StatusChip>
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
  invalidText = null,
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
  /** The required consent was not given when Next was pressed: said at the box itself. */
  invalidText?: string | null;
}) {
  const consent = request.consents[purpose];
  const given = consentGiven(request, purpose);
  // Staff record a consent the client gave them, saying how (owner 2026-10-29).
  const staffMode = useCabinetStaffMode();
  const [recordOpen, setRecordOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The answer carries only the consent: only that field changes, in the newest request.
  const patch = useRequestPatch(onChange, request);

  async function toggle(checked: boolean, recorded: StaffConsentRecord | null = null) {
    if (!consent) return;
    if (staffMode && checked && !recorded) {
      setRecordOpen(true);
      return;
    }
    if (!checked && !window.confirm(text.consentWithdrawConfirm)) return;
    setBusy(true);
    setError("");
    const withConsent = (givenAt: string | null) =>
      patch((current) => ({
        ...current,
        consents: { ...current.consents, [purpose]: { ...(current.consents[purpose] ?? consent), given_at: givenAt } },
      }));
    try {
      if (checked) {
        const result = await enqueue(() => giveLeadConsent(request.lead_id, purpose, consent.version, lang, recorded));
        withConsent(result.given_at);
        setRecordOpen(false);
      } else {
        await enqueue(() => revokeLeadConsent(request.lead_id, purpose));
        withConsent(null);
      }
    } catch (cause) {
      setError(errorMessage(cause, text));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid={testId}>
      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          aria-label={label}
          aria-invalid={invalidText && !given ? true : undefined}
          aria-describedby={invalidText && !given ? `${testId}-error` : undefined}
          className={cn(checkboxClass, "mt-0.5")}
          checked={given}
          // Sent is sent (owner 2026-10-26): a given consent is withdrawn through GMED.
          disabled={busy || !consent || (Boolean(request.submitted_at) && given && !staffMode)}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <span className={cn("min-w-0", privacyLink ? "space-y-1.5" : "flex flex-wrap items-center gap-x-3 gap-y-1")}>
          <span className={cn("leading-snug", privacyLink && "block")}>{label}</span>
          {privacyLink || (given && consent?.given_at) ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {privacyLink ? (
                <a href={`/legal?notice=form&lang=${lang}#privacy`} target="_blank" rel="noreferrer" className="text-xs text-[var(--brand)] underline underline-offset-2">
                  {text.privacyLink}
                </a>
              ) : null}
              {given && consent?.given_at ? (
                <ConsentGivenChip>{text.consentGivenAt(formatAppDateTime(consent.given_at))}</ConsentGivenChip>
              ) : null}
            </span>
          ) : null}
        </span>
      </label>
      {staffMode && recordOpen && !given ? (
        <StaffConsentRecordFields lang={lang} testId={testId} busy={busy}
          onRecord={(recorded) => void toggle(true, recorded)} onCancel={() => setRecordOpen(false)} />
      ) : null}
      {invalidText && !given && !staffMode ? <p id={`${testId}-error`} role="alert" className="mt-1.5 text-xs font-medium text-destructive">{invalidText}</p> : null}
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
  step,
  fields,
}: {
  title: string;
  labels: readonly string[];
  testId: string;
  /** The step the items are answered in; with `fields`, every item leads to its field. */
  step?: StepId;
  /** The key of each label (same order); `null` for a label without a field of its own. */
  fields?: readonly (string | null)[];
}) {
  const goTo = useContext(CabinetGoToContext);
  if (labels.length === 0) return null;
  const seen = new Set<string>();
  const items = labels.flatMap((label, index) => {
    if (seen.has(label)) return [];
    seen.add(label);
    return [{ label, field: fields?.[index] ?? null }];
  });
  return (
    <div
      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
      data-testid={testId}
    >
      <p className="font-medium">{title}</p>
      <ul className="mt-1 list-outside list-disc space-y-0.5 pl-5 text-[13px] leading-5">
        {items.map(({ label, field }) => (
          <li key={label} className="break-words">
            {goTo && step && field ? (
              <MissingItemLink onClick={() => goTo(step, { field })} field={field}>
                {label}
              </MissingItemLink>
            ) : (
              label
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One missing item as a link to its field (owner report 2026-10-21): a click
 * opens the step that answers it, whichever step is on screen, and puts the
 * cursor into the field.
 */
export function MissingItemLink({
  field,
  onClick,
  children,
}: {
  field: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      // `align-top`: a wrapped item keeps the list bullet beside its first line.
      className="text-left align-top underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="lead-request-missing-item"
      data-field={field}
      onClick={onClick}
    >
      {children}
    </button>
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
  enqueue,
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
  enqueue: RequestQueue;
  /** Direct upload: the field queues the complete selection as one operation. */
  upload: (file: File) => Promise<void>;
  remove: (documentId: string) => Promise<void>;
  testId: string;
}) {
  const [uploading, setUploading] = useState(false);
  const consentNoteAbove = useContext(ConsentNoteAboveContext);
  const [errors, setErrors] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    const nextErrors: string[] = [];
    // Reserve all files together so a follow-up submit cannot split the batch.
    await enqueueUploadBatch(enqueue, async () => {
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
              : `${file.name}: ${errorMessage(cause, text)}`,
          );
        }
      }
    });
    setErrors(Array.from(new Set(nextErrors)));
    setUploading(false);
  }

  return (
    <div className="space-y-2" data-testid={testId}>
      <p id={`${id}-label`} className="font-mono text-xs font-medium leading-5 text-foreground/75">
        {label}
        {required ? <RequiredMark /> : null}
      </p>
      <input
        ref={fileInput}
        id={`${id}-files`}
        type="file"
        multiple
        accept={LEAD_UPLOAD_ACCEPT}
        className="sr-only"
        aria-labelledby={`${id}-label`}
        disabled={!consentReady || uploading}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void uploadFiles(files);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        {consentReady ? <StatusChip tone="warning">{hint}</StatusChip> : null}
        <Button
          type="button"
          className="cabinet-upload-action h-auto min-h-8 w-full gap-2 whitespace-normal py-1.5 text-left sm:w-auto"
          disabled={!consentReady || uploading}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Upload aria-hidden="true" className="size-4" />}
          {uploading ? text.uploading : buttonLabel}
        </Button>
      </div>
      {!consentReady && !consentNoteAbove ? (
        <ConsentNeededNote>{text.identityUploadNeedsConsent}</ConsentNeededNote>
      ) : null}
      {errors.map((message) => (
        <p key={message} role="alert" className="text-xs text-destructive">
          {message}
        </p>
      ))}
      <UploadedFileList
        documents={documents}
        text={text}
        emptyText={emptyText}
        testId={`${testId}-list`}
        onRemove={(documentId) => {
          setErrors([]);
          void remove(documentId).catch((cause: unknown) => setErrors([errorMessage(cause, text)]));
        }}
      />
    </div>
  );
}

/** The uploaded files of a kind (medical documents, copies of the identity document) with "remove". */
/**
 * The sent request is read-only (owner 2026-10-26): one hint where the form
 * would be edited — changes go through the person's contact at GMED.
 */
export function SentLockHint({ text, className }: { text: LeadRequestText; className?: string }) {
  return (
    <StatusChip
      tone="success"
      role="note"
      className={cn(
        "items-start gap-2 px-3 py-1.5",
        className,
      )}
      data-testid="lead-request-sent-locked"
    >
      <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{text.sentLockedHint}</span>
    </StatusChip>
  );
}

/** The wizard's compact information panel. */
export function InfoNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200" data-testid={testId}>
      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function UploadedFileList({
  documents,
  text,
  emptyText,
  testId,
  onRemove,
  refused = [],
}: {
  documents: readonly LeadRequestDocument[];
  text: LeadRequestText;
  emptyText: string;
  testId: string;
  onRemove: (documentId: string) => void;
  /** Copies GMED could not use: greyed, marked and each with its reason, never removable here. */
  refused?: readonly RefusedIdentityCopy[];
}) {
  if (refused.length > 0 && documents.length === 0) {
    return (
      <div className="space-y-1.5" data-testid={`${testId}-refused`}>
        <ul className="divide-y divide-border rounded-lg border border-dashed border-border bg-muted/30" data-testid={testId} aria-label={emptyText}>
          {refused.map((document) => (
            <li key={document.id} className="flex items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground">
              <FileText aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate line-through">{document.file_name ?? "—"}</span>
                <span className="mt-0.5 inline-flex w-fit items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                  {[document.uploaded_at ? formatAppDateTime(document.uploaded_at) : null, text.documentRefused].filter(Boolean).join(" · ")}
                </span>
                <span
                  className="mt-1 block text-xs leading-5 text-red-800 dark:text-red-200"
                  data-testid={`${testId}-refused-reason`}
                  data-reason={document.reason}
                >
                  {text.documentRefusedReasons[document.reason] ?? text.documentRefusedReasons.unreadable}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  // Nothing uploaded yet: no empty frame (owner 2026-10-09); the list stays for its test id.
  if (documents.length === 0) return <ul hidden data-testid={testId} aria-label={emptyText} />;
  return (
    <ul className="divide-y divide-border/60 rounded-lg border border-border/60 bg-card" data-testid={testId}>
      {documents.length === 0 ? null : (
        documents.map((document) => (
          <li key={document.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
            <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="min-w-0 break-words leading-5 [overflow-wrap:anywhere]">{document.file_name ?? "—"}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                <StatusChip tone="info"><CalendarDays aria-hidden="true" />{formatAppDateTime(document.uploaded_at)}</StatusChip>
                {document.added_after_submit ? <StatusChip tone="warning">{text.addedAfterSend}</StatusChip> : null}
                {document.reviewed ? <StatusChip tone="success"><Check aria-hidden="true" />{text.documentTakenOver}</StatusChip> : null}
              </span>
            </span>
            {document.can_delete ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 gap-1 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
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
