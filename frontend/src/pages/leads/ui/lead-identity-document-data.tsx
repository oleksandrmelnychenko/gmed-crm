import { useCallback, useEffect, useId, useMemo, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { Check, LoaderCircle } from "lucide-react";

import { checkboxClass, inputClass, selectClass, tokens } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { StatusChip, type StatusChipTone } from "@/components/ui/status-chip";
import { appDateKey, formatAppDate } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import {
  saveLeadIdentityDocumentData,
  saveRepresentativeIdentityDocumentData,
  type IdentityDocumentDataInput,
  type IdentityDocumentSaveOptions,
  type RepresentativeUploadKind,
} from "../data/lead-risk-api";
import type { LeadCustody, LeadPortalIntake, LeadRepresentative } from "../data/lead-portal-intake-api";
import {
  ID_DOCUMENT_TYPES,
  identityDocumentDraft,
  identityDocumentDraftChanged,
  identityDocumentEnteredLine,
  identityDocumentFieldErrors,
  identityDocumentInput,
  identityDocumentSavableDraft,
  identityDocumentServerError,
  identityDocumentSourceIsStale,
  identityDocumentStatus,
  identityDocumentStatusText,
  identityFieldErrorText,
  type IdentityDocumentDraft,
  type IdentityDocumentErrors,
  type IdentityDocumentField,
  type IdentityDocumentSource,
  type IdentityDocumentStatus,
} from "../model/lead-identity-document-data";
import { idDocumentTypeLabel, representativeName, representativeRoleLabel } from "../model/lead-gwg-statements";
import type { Tx } from "../model/lead-payer";
import type { LeadStaffIdDataMarks } from "../model/lead-risk-intake";
import { LeadRepresentativeUploads } from "./lead-representative-uploads";
import { PARENT_ROLE_CHIP_CLASS } from "./trusted-contact-role";

const WARNING_TEXT = "text-amber-700 dark:text-amber-300";

/**
 * Where focus goes when staff open a list or a calendar of the form: the
 * popups live in a portal, outside the form, but staff have not left it
 * (DEV 2026-10-22: opening the country list saved a half-filled form).
 */
const POPUP_SELECTOR = '[data-overlay-interaction-root], .MuiPopper-root, .MuiPickersPopper-root, .MuiDialog-root, [role="listbox"]';

type SaveState = "idle" | "saving" | "saved" | "error";

/** How long after the last edit the form stores by itself. */
export const IDENTITY_AUTOSAVE_DELAY_MS = 800;

const STATUS_TONE: Record<IdentityDocumentStatus["kind"], StatusChipTone> = {
  no_scan: "warning",
  unreadable: "warning",
  incomplete: "warning",
  invalid: "error",
  expired: "error",
  complete: "success",
};

function isSource(value: unknown): value is IdentityDocumentSource {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && "id_document_type" in (value as object);
}

function draftOfInput(input: IdentityDocumentDataInput): IdentityDocumentDraft {
  return identityDocumentDraft({ ...input });
}

/** The status chip of one person's document: one line that says what is next. */
export function IdentityDocumentStatusChip({
  status,
  tx,
  testId,
}: {
  status: IdentityDocumentStatus;
  tx: Tx;
  testId?: string;
}) {
  return (
    <StatusChip tone={STATUS_TONE[status.kind]} className="whitespace-normal" data-testid={testId} data-status={status.kind}>
      {identityDocumentStatusText(status, tx)}
    </StatusChip>
  );
}

function FormField({
  label,
  error,
  errorId,
  children,
  className,
  onBlur,
}: {
  label: string;
  error?: string;
  errorId: string;
  children: ReactNode;
  className?: string;
  onBlur?: () => void;
}) {
  return (
    <label className={cn("min-w-0 space-y-1.5", className)} onBlur={onBlur}>
      <span className={cn(tokens.text.label, "block")}>{label}</span>
      {children}
      {error ? (
        <span id={errorId} role="alert" className="block text-xs font-medium text-destructive">
          {error}
        </span>
      ) : null}
    </label>
  );
}

/**
 * The identity document data of one person, entered by staff from the scan:
 * type, number, authority, country, issued, valid until and "Ausweis
 * unleserlich". One status line says where the document stands and what is
 * next; each field says what breaks a rule.
 *
 * Every edit is stored by itself shortly after the last keystroke, list
 * choice or calendar pick, and at once when staff leave the form, fold the
 * card, switch the step, close the wizard or leave the page (DEV 2026-10-22:
 * only the type reached the server, every later edit was lost while staff
 * stayed in the form or left it through a list, a calendar or the wizard).
 * Saves run one at a time, always with the latest typed values; a field that
 * breaks a rule keeps its error and its stored value while the other fields
 * are sent; a save never locks the fields; and neither a save's answer nor a
 * late reload of an older state replaces what staff typed since.
 */
export function LeadIdentityDocumentDataForm({
  source,
  fallbackValidUntil = "",
  save,
  tx,
  lang,
  disabled = false,
  testId,
  today = appDateKey(),
  birthDate = null,
  scanCount = null,
}: {
  source: IdentityDocumentSource | null | undefined;
  /** The wizard's old "passport valid until", read only while nothing is stored in the new place. */
  fallbackValidUntil?: string;
  /** Stores the data; resolves with the stored document (the server's answer). */
  save: (input: IdentityDocumentDataInput, options?: IdentityDocumentSaveOptions) => Promise<unknown>;
  tx: Tx;
  lang: string;
  disabled?: boolean;
  testId: string;
  today?: string;
  /** The holder's date of birth: the document cannot be issued before it. */
  birthDate?: string | null;
  /** The scans of this person's document; `null` when unknown here. */
  scanCount?: number | null;
}) {
  const fieldId = useId();
  const savedKey = JSON.stringify(identityDocumentDraft(source, fallbackValidUntil));
  const saved = useMemo(() => JSON.parse(savedKey) as IdentityDocumentDraft, [savedKey]);
  const sourceAt = source?.id_data_entered_at ?? null;
  const [draft, setDraftState] = useState<IdentityDocumentDraft>(saved);
  const [baseline, setBaseline] = useState<IdentityDocumentDraft>(saved);
  const [marks, setMarks] = useState<LeadStaffIdDataMarks | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const [serverErrors, setServerErrorsState] = useState<IdentityDocumentErrors>({});
  const [touched, setTouched] = useState<ReadonlySet<IdentityDocumentField>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  // The refs are what a save reads: a timer, an unmount or a page leave may
  // run after the render that scheduled it.
  const draftRef = useRef(draft);
  const baselineRef = useRef(saved);
  const baselineAtRef = useRef<string | null>(sourceAt);
  const serverErrorsRef = useRef<IdentityDocumentErrors>({});
  const rulesRef = useRef({ today, birthDate });
  rulesRef.current = { today, birthDate };
  const saveRef = useRef(save);
  saveRef.current = save;
  const txRef = useRef(tx);
  txRef.current = tx;
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const flushRef = useRef<(options?: IdentityDocumentSaveOptions) => void>(() => undefined);

  const setDraft = (next: IdentityDocumentDraft) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const setServerErrors = (next: IdentityDocumentErrors) => {
    serverErrorsRef.current = next;
    setServerErrorsState(next);
  };

  // A newer server state replaces the form unless staff typed over the last
  // known one; an older one (a reload that overtook a later save) is ignored.
  useEffect(() => {
    if (identityDocumentSourceIsStale(sourceAt, baselineAtRef.current)) return;
    const previous = baselineRef.current;
    baselineRef.current = saved;
    baselineAtRef.current = sourceAt ?? baselineAtRef.current;
    setBaseline(saved);
    setMarks(null);
    const current = draftRef.current;
    const next = identityDocumentDraftChanged(current, previous) ? current : saved;
    draftRef.current = next;
    setDraftState(next);
  }, [saved, sourceAt]);

  const clearTimer = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  /**
   * Stores what is unsaved now, one save at a time: a call during a save
   * runs once that save is answered, with the values typed by then. Runs
   * after the form is gone too (unmount, page leave).
   */
  const flush = useCallback((options: IdentityDocumentSaveOptions & { reveal?: boolean } = {}) => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }
    const current = draftRef.current;
    const stored = baselineRef.current;
    if (!identityDocumentDraftChanged(current, stored)) return;
    // A field the server refused keeps its stored value until it is edited.
    const refused = Object.keys(serverErrorsRef.current) as IdentityDocumentField[];
    const typed = refused.reduce<IdentityDocumentDraft>((next, field) => ({ ...next, [field]: stored[field] }), current);
    const sendable = identityDocumentSavableDraft(typed, stored, rulesRef.current);
    if (options.reveal && sendable !== current && mountedRef.current) setShowAll(true);
    if (!sendable || !identityDocumentDraftChanged(sendable, stored)) return;
    const input = identityDocumentInput(sendable);
    const sent = draftOfInput(input);
    inFlightRef.current = true;
    if (mountedRef.current) {
      setSaveState("saving");
      setError("");
    }
    const keepalive = options.keepalive ? { keepalive: true } : undefined;
    void saveRef.current(input, keepalive)
      .then((response) => {
        const answer = isSource(response) ? identityDocumentDraft(response) : sent;
        baselineRef.current = answer;
        if (isSource(response) && response.id_data_entered_at) baselineAtRef.current = response.id_data_entered_at;
        // What was sent is shown as stored ("fa 12" → "FA 12"); later typing stays.
        if (!identityDocumentDraftChanged(draftRef.current, sent)) draftRef.current = answer;
        if (!mountedRef.current) return;
        setBaseline(answer);
        if (isSource(response)) setMarks(response);
        setDraftState(draftRef.current);
        // A field the server refused before stays marked: it was not sent.
        setSaveState("saved");
      })
      .catch((saveError: unknown) => {
        const field = identityDocumentServerError(saveError);
        if (field?.field) {
          serverErrorsRef.current = { ...serverErrorsRef.current, [field.field]: field.code } as IdentityDocumentErrors;
        }
        if (!mountedRef.current) return;
        if (field?.field) {
          setServerErrorsState(serverErrorsRef.current);
          setError("");
        } else {
          setError(saveError instanceof Error && saveError.message ? saveError.message : txRef.current("Не удалось сохранить", "Speichern fehlgeschlagen"));
        }
        setSaveState("error");
      })
      .finally(() => {
        inFlightRef.current = false;
        if (pendingRef.current) {
          pendingRef.current = false;
          flushRef.current({ keepalive: options.keepalive });
        }
      });
  }, []);
  flushRef.current = flush;

  /** Stores the edits a moment after the last one (typing, a list choice, a calendar pick). */
  const schedule = () => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flush();
    }, IDENTITY_AUTOSAVE_DELAY_MS);
  };

  // Folding the card keeps the form; leaving the step, closing the wizard or
  // the page stores what is still unsaved, without waiting for the timer.
  useEffect(() => {
    mountedRef.current = true;
    const leavePage = () => flush({ keepalive: true });
    const hidePage = () => {
      if (document.visibilityState === "hidden") flush({ keepalive: true });
    };
    window.addEventListener("pagehide", leavePage);
    window.addEventListener("beforeunload", leavePage);
    document.addEventListener("visibilitychange", hidePage);
    return () => {
      window.removeEventListener("pagehide", leavePage);
      window.removeEventListener("beforeunload", leavePage);
      document.removeEventListener("visibilitychange", hidePage);
      mountedRef.current = false;
      flush();
    };
  }, [flush]);

  const clientErrors = identityDocumentFieldErrors(draft, { today, birthDate });
  const changed = identityDocumentDraftChanged(draft, baseline);
  const blocked = Object.keys(clientErrors).length > 0 || Object.keys(serverErrors).length > 0;
  const fieldError = (field: IdentityDocumentField) => {
    const server = serverErrors[field];
    if (server) return identityFieldErrorText(server, tx);
    const client = clientErrors[field];
    return client && (showAll || touched.has(field)) ? identityFieldErrorText(client, tx) : "";
  };
  const touch = (field: IdentityDocumentField) => () =>
    setTouched((current) => (current.has(field) ? current : new Set(current).add(field)));
  const patch = (next: Partial<IdentityDocumentDraft>) => {
    setSaveState((state) => (state === "saved" ? "idle" : state));
    const keys = Object.keys(next) as IdentityDocumentField[];
    if (keys.some((key) => key in serverErrorsRef.current)) {
      const rest = { ...serverErrorsRef.current };
      for (const key of keys) delete rest[key];
      setServerErrors(rest);
    }
    setDraft({ ...draftRef.current, ...next });
    schedule();
  };

  const saveOnLeave = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Element && (event.currentTarget.contains(next) || next.closest(POPUP_SELECTOR))) return;
    flush({ reveal: true });
  };

  const status = identityDocumentStatus(draft, { today, scans: scanCount, errors: { ...clientErrors, ...serverErrors } });
  const entered = identityDocumentEnteredLine(marks ?? source, tx);
  const errorId = (field: IdentityDocumentField) => `${fieldId}-${field}-error`;
  const described = (field: IdentityDocumentField) => (fieldError(field) ? errorId(field) : undefined);

  return (
    <div className="space-y-2.5" data-testid={testId} onBlur={saveOnLeave}>
      <IdentityDocumentStatusChip status={status} tx={tx} testId={`${testId}-status`} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label={tx("Вид документа", "Art des Dokuments")} error={fieldError("type")} errorId={errorId("type")} onBlur={touch("type")}>
          <NativeComboboxSelect
            className={cn(selectClass, fieldError("type") && "border-destructive")}
            name="id_document_type"
            value={draft.type}
            disabled={disabled}
            aria-label={tx("Вид документа", "Art des Dokuments")}
            aria-invalid={Boolean(fieldError("type"))}
            onChange={(event) => patch({ type: event.target.value })}
          >
            <option value="">{tx("Не указано", "Nicht angegeben")}</option>
            {ID_DOCUMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {idDocumentTypeLabel(value, tx)}
              </option>
            ))}
          </NativeComboboxSelect>
        </FormField>
        <FormField label={tx("Номер документа", "Dokumentnummer")} error={fieldError("number")} errorId={errorId("number")} onBlur={touch("number")}>
          <Input
            className={cn(inputClass, "uppercase")}
            name="id_document_number"
            autoComplete="off"
            maxLength={60}
            value={draft.number}
            disabled={disabled}
            aria-invalid={Boolean(fieldError("number"))}
            aria-describedby={described("number")}
            onChange={(event) => patch({ number: event.target.value })}
          />
        </FormField>
        <FormField label={tx("Кем выдан", "Ausstellende Behörde")} error={fieldError("authority")} errorId={errorId("authority")} onBlur={touch("authority")}>
          <Input
            className={inputClass}
            name="id_issuing_authority"
            maxLength={200}
            value={draft.authority}
            disabled={disabled}
            aria-invalid={Boolean(fieldError("authority"))}
            aria-describedby={described("authority")}
            onChange={(event) => patch({ authority: event.target.value })}
          />
        </FormField>
        <FormField label={tx("Страна выдачи", "Ausstellungsland")} error={fieldError("country")} errorId={errorId("country")} onBlur={touch("country")}>
          <CountrySelect
            value={draft.country}
            lang={lang}
            className={cn(selectClass, fieldError("country") && "border-destructive")}
            aria-label={tx("Страна выдачи", "Ausstellungsland")}
            disabled={disabled}
            onChange={(code) => patch({ country: code ?? "" })}
          />
        </FormField>
        <FormField label={tx("Дата выдачи", "Ausgestellt am")} error={fieldError("issuedOn")} errorId={errorId("issuedOn")} onBlur={touch("issuedOn")}>
          <Input
            className={inputClass}
            type="date"
            name="id_issued_on"
            max={today}
            value={draft.issuedOn}
            disabled={disabled}
            aria-invalid={Boolean(fieldError("issuedOn"))}
            aria-describedby={described("issuedOn")}
            onChange={(event) => patch({ issuedOn: event.target.value })}
          />
        </FormField>
        <FormField label={tx("Действителен до", "Gültig bis")} error={fieldError("validUntil")} errorId={errorId("validUntil")} onBlur={touch("validUntil")}>
          <Input
            className={inputClass}
            type="date"
            name="id_valid_until"
            value={draft.validUntil}
            disabled={disabled}
            aria-invalid={Boolean(fieldError("validUntil")) || status.kind === "expired"}
            aria-describedby={described("validUntil")}
            onChange={(event) => patch({ validUntil: event.target.value })}
          />
        </FormField>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          name="id_document_unreadable"
          className={checkboxClass}
          checked={draft.unreadable}
          disabled={disabled}
          onChange={(event) => patch({ unreadable: event.target.checked })}
        />
        {tx("Документ нечитаем (запросить новый скан)", "Ausweis unleserlich (neuen Scan anfordern)")}
      </label>
      {status.kind === "expired" ? (
        <p className="text-xs font-medium text-destructive" data-testid={`${testId}-expired`}>
          {tx(
            "Срок действия истёк: данные сохраняются, но подтвердить идентификацию (лист GwG) с этим документом нельзя.",
            "Abgelaufen: Die Daten werden gespeichert, aber die Identifizierung (GwG-Bogen) kann mit diesem Dokument nicht bestätigt werden.",
          )}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground" data-testid={`${testId}-entered`}>
          {entered}
        </span>
        <div className="flex min-h-8 items-center gap-2" aria-live="polite">
          {saveState === "saving" ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" role="status" data-testid={`${testId}-saving`}>
              <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
              {tx("Сохранение…", "Wird gespeichert…")}
            </span>
          ) : changed ? (
            <>
              <span className={cn("text-xs font-medium", WARNING_TEXT)} role="status" data-testid={`${testId}-unsaved`}>
                {blocked
                  ? tx("Не сохранено · исправьте поля, отмеченные красным", "Nicht gespeichert · rot markierte Felder korrigieren")
                  : tx("Не сохранено · сохранится автоматически", "Nicht gespeichert · wird automatisch gespeichert")}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg"
                disabled={disabled}
                onClick={() => {
                  setShowAll(true);
                  flush({ reveal: true });
                }}
                data-testid={`${testId}-save`}
              >
                {tx("Сохранить", "Speichern")}
              </Button>
            </>
          ) : saveState === "saved" ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300" role="status" data-testid={`${testId}-saved`}>
              <Check aria-hidden className="size-3.5" />
              {tx("Сохранено", "Gespeichert")}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The status of a person's stored document, for the collapsed card. */
function storedStatus(person: LeadRepresentative, today: string) {
  const draft = identityDocumentDraft(person);
  return identityDocumentStatus(draft, {
    today,
    scans: person.identity_documents.length,
    errors: identityDocumentFieldErrors(draft, { today, birthDate: person.date_of_birth }),
  });
}

function RepresentativeForm({
  leadId,
  person,
  custody,
  renderFiles,
  tx,
  lang,
  disabled,
  today,
  onSaved,
  onUploaded,
}: {
  leadId: string;
  person: LeadRepresentative;
  custody: LeadCustody | null | undefined;
  /** The person's own uploads of a kind (identity scan, power of attorney), under the person's card. */
  renderFiles?: (person: LeadRepresentative, kind: RepresentativeUploadKind) => ReactNode;
  tx: Tx;
  lang: string;
  disabled: boolean;
  today: string;
  onSaved: () => void;
  onUploaded: () => void;
}) {
  const status = storedStatus(person, today);
  // A card that needs something stays open; a complete one is folded.
  const [open, setOpen] = useState(status.kind !== "complete");
  const fileCount = person.identity_documents.length + person.authority_documents.length;
  return (
    <details
      className="rounded-md border border-border/60 bg-background/50 p-2.5"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      data-testid={`lead-representative-id-card-${person.id}`}
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-semibold text-foreground">{representativeName(person) || "—"}</span>
        <StatusChip className={cn(PARENT_ROLE_CHIP_CLASS, "whitespace-normal")}>{representativeRoleLabel(person, tx)}</StatusChip>
        {fileCount > 0 ? (
          <span className="text-xs text-muted-foreground">
            · {tx("файлов", "Dateien")}: {fileCount}
          </span>
        ) : null}
        {!open ? (
          <IdentityDocumentStatusChip
            status={status}
            tx={tx}
            testId={status.kind === "expired" ? `lead-representative-id-expired-${person.id}` : `lead-representative-id-summary-${person.id}`}
          />
        ) : null}
      </summary>
      <div className="space-y-3 pt-2.5">
        {/* First the scan, then the data read from it. */}
        <LeadRepresentativeUploads
          leadId={leadId}
          person={person}
          custody={custody}
          tx={tx}
          disabled={disabled}
          renderFiles={renderFiles}
          onUploaded={onUploaded}
        />
        <LeadIdentityDocumentDataForm
          source={person}
          tx={tx}
          lang={lang}
          disabled={disabled}
          today={today}
          birthDate={person.date_of_birth}
          scanCount={person.identity_documents.length}
          testId={`lead-representative-id-data-${person.id}`}
          save={async (input, options) => {
            const stored = await saveRepresentativeIdentityDocumentData(leadId, person.id, input, options);
            onSaved();
            return stored;
          }}
        />
      </div>
    </details>
  );
}

/**
 * Staff's identity document data next to the scan list of the documents
 * step: the patient's document (replaces the old "valid until" field) and one
 * card per representative the cabinet or staff named. Each card goes scan →
 * data → done, with one status line.
 */
export function LeadIdentityDocumentData({
  leadId,
  intake,
  fallbackValidUntil = "",
  tx,
  lang,
  disabled = false,
  patientScans,
  patientScanIds = null,
  patientBirthDate = null,
  representativeFiles,
  today = appDateKey(),
  onSaved,
  onUploaded,
}: {
  leadId: string;
  intake: LeadPortalIntake | null;
  fallbackValidUntil?: string;
  tx: Tx;
  lang: string;
  disabled?: boolean;
  /**
   * The patient's own scans, right above the patient's form — never under a
   * representative's card (QA 2026-10-10: the patient's pass.pdf looked like
   * the representative's).
   */
  patientScans?: ReactNode;
  /**
   * The ids of the scans `patientScans` lists; `null` when unknown. The
   * lead's own cabinet uploads not among them are listed here too and count
   * as the scan (QA 2026-10-22: «Файл не загружен» next to the lead's
   * pass-front.pdf).
   */
  patientScanIds?: readonly string[] | null;
  patientBirthDate?: string | null;
  /** A representative's own uploads of a kind, under that person's card. */
  representativeFiles?: (person: LeadRepresentative, kind: RepresentativeUploadKind) => ReactNode;
  today?: string;
  /** After a save: reload the portal state and the risk assessment. */
  onSaved: () => void;
  /** After staff uploaded a representative's file; `onSaved` when not given. */
  onUploaded?: () => void;
}) {
  // The role may not read the GwG data: only the scans.
  if (intake?.identification_hidden) return patientScans ? <>{patientScans}</> : null;
  const representatives = intake?.representation?.representatives ?? [];
  const listed = new Set(patientScanIds ?? []);
  const cabinetScans = (intake?.identity_documents ?? []).filter((file) => !listed.has(file.id));
  const patientScanCount = patientScanIds ? patientScanIds.length + cabinetScans.length : null;
  return (
    <div className="space-y-3" data-testid="lead-identity-document-data">
      {representatives.length > 0 ? (
        <h4 className="text-xs font-semibold text-foreground">{tx("Документ пациента", "Ausweis des Patienten")}</h4>
      ) : null}
      {patientScans ? <div data-testid="lead-id-patient-scans">{patientScans}</div> : null}
      {cabinetScans.length > 0 ? (
        <ul className="space-y-1 text-xs" data-testid="lead-id-cabinet-scans">
          {cabinetScans.map((file) => (
            <li key={file.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-foreground [overflow-wrap:anywhere]">{file.file_name || "—"}</span>
              {file.uploaded_at ? <span className="text-muted-foreground">{formatAppDate(file.uploaded_at)}</span> : null}
              <span className="text-muted-foreground">{tx("Из кабинета", "Aus dem Kundenkabinett")}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <LeadIdentityDocumentDataForm
        source={intake?.identification ?? null}
        fallbackValidUntil={fallbackValidUntil}
        tx={tx}
        lang={lang}
        disabled={disabled}
        today={today}
        birthDate={patientBirthDate}
        scanCount={patientScanCount}
        testId="lead-id-data"
        save={async (input, options) => {
          const stored = await saveLeadIdentityDocumentData(leadId, input, options);
          onSaved();
          return stored;
        }}
      />
      {representatives.length > 0 ? (
        <div className="space-y-2" data-testid="lead-representatives-id-data">
          <h4 className="text-xs font-semibold text-foreground">
            {tx("Документы представителей", "Ausweise der Vertreter")}
          </h4>
          {representatives.map((person) => (
            <RepresentativeForm
              key={person.id}
              leadId={leadId}
              person={person}
              custody={intake?.representation?.custody}
              renderFiles={representativeFiles}
              tx={tx}
              lang={lang}
              disabled={disabled}
              today={today}
              onSaved={onSaved}
              onUploaded={onUploaded ?? onSaved}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
