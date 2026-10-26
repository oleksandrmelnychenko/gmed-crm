import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, CheckCheck, Clock3, LoaderCircle, RefreshCw, UserRound, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import {
  reviewLeadPortalUpload,
  type LeadPortalIntake,
  type LeadPortalConsent,
  type LeadPortalUpload,
  type PatientFieldMarker,
  type Step1FillMode,
} from "../data/lead-portal-intake-api";
import { portalProgressText } from "../model/lead-portal-intake";
import { latestPortalConsent } from "../model/lead-portal-consents";

type Tx = (ru: string, de: string) => string;

/**
 * What wizard step 1 knows about the portal: which fields the patient fills
 * in (by the field's error id or portal column) and which values came from
 * the patient. Read by the wizard's `Field`.
 */
type Step1PortalState = {
  mode: Step1FillMode;
  patientFilledErrorIds: ReadonlySet<string>;
  markerByErrorId: ReadonlyMap<string, PatientFieldMarker>;
  markerByPortalField: ReadonlyMap<string, PatientFieldMarker>;
  /** Fields with a value already (by error id and portal column): no "the patient fills it in" hint. */
  filledErrorIds: ReadonlySet<string>;
  filledPortalFields: ReadonlySet<string>;
  tx: Tx;
};

const Step1PortalContext = createContext<Step1PortalState | null>(null);

export function Step1PortalProvider({
  mode,
  intake,
  errorIdByDraftKey,
  patientFilledKeys,
  portalFieldByDraftKey,
  filledDraftKeys = [],
  tx,
  children,
}: {
  mode: Step1FillMode;
  intake: LeadPortalIntake | null;
  errorIdByDraftKey: Readonly<Record<string, string>>;
  patientFilledKeys: readonly string[];
  portalFieldByDraftKey: Readonly<Record<string, string>>;
  /**
   * The draft keys that hold a value (entered by staff or the patient): the
   * hint "заполнит пациент в портале" stays off them (QA 2026-10-10).
   */
  filledDraftKeys?: readonly string[];
  tx: Tx;
  children: ReactNode;
}) {
  const filledKey = filledDraftKeys.join("|");
  const value = useMemo<Step1PortalState>(() => {
    const markerByErrorId = new Map<string, PatientFieldMarker>();
    const markerByPortalField = new Map<string, PatientFieldMarker>();
    for (const [column, marker] of Object.entries(intake?.patient_fields ?? {})) {
      markerByPortalField.set(column, marker);
    }
    for (const [draftKey, errorId] of Object.entries(errorIdByDraftKey)) {
      const marker = markerByPortalField.get(portalFieldByDraftKey[draftKey] ?? "");
      if (marker) markerByErrorId.set(errorId, marker);
    }
    const filled = filledKey ? filledKey.split("|") : [];
    return {
      mode,
      patientFilledErrorIds: new Set(
        patientFilledKeys.map((key) => errorIdByDraftKey[key]).filter((id): id is string => Boolean(id)),
      ),
      markerByErrorId,
      markerByPortalField,
      filledErrorIds: new Set(filled.map((key) => errorIdByDraftKey[key]).filter((id): id is string => Boolean(id))),
      filledPortalFields: new Set(filled.map((key) => portalFieldByDraftKey[key]).filter((id): id is string => Boolean(id))),
      tx,
    };
  }, [errorIdByDraftKey, filledKey, intake, mode, patientFilledKeys, portalFieldByDraftKey, tx]);
  return <Step1PortalContext.Provider value={value}>{children}</Step1PortalContext.Provider>;
}

/**
 * For a wizard field: whether the patient fills it in (optional, with a hint)
 * and the "from the patient" marker. Outside step 1 both are empty.
 */
export function useStep1PortalField(errorId?: string, portalField?: string) {
  const state = useContext(Step1PortalContext);
  if (!state) return { patientFills: false, filled: false, marker: null as PatientFieldMarker | null, tx: null };
  const patientFills =
    state.mode === "patient"
    && ((errorId ? state.patientFilledErrorIds.has(errorId) : false) || Boolean(portalField && portalField !== "first_name" && portalField !== "last_name"));
  const filled =
    (errorId ? state.filledErrorIds.has(errorId) : false) || Boolean(portalField && state.filledPortalFields.has(portalField));
  const marker =
    (errorId ? state.markerByErrorId.get(errorId) : undefined)
    ?? (portalField ? state.markerByPortalField.get(portalField) : undefined)
    ?? null;
  return { patientFills, filled, marker, tx: state.tx };
}

/** Hint and badge under a wizard field label; the hint only over an empty field. */
export function Step1PortalFieldNote({ errorId, portalField }: { errorId?: string; portalField?: string }) {
  const { patientFills, filled, marker, tx } = useStep1PortalField(errorId, portalField);
  const hint = patientFills && !marker && !filled;
  if (!tx || (!hint && !marker)) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {marker ? <PatientFieldBadge marker={marker} tx={tx} /> : null}
      {hint ? (
        <span className="text-[11px] text-muted-foreground" data-testid="patient-fills-hint">
          {tx("заполнит пациент в портале", "füllt der Patient im Portal aus")}
        </span>
      ) : null}
    </span>
  );
}

export function PatientFieldBadge({ marker, tx }: { marker: PatientFieldMarker; tx: Tx }) {
  return (
    <Badge
      variant="outline"
      data-testid="patient-field-badge"
      className="h-5 gap-1 rounded-full border-sky-200 bg-sky-50 px-1.5 text-[10.5px] font-medium text-sky-800"
      title={marker.access_kind === "guardian" ? tx("Внёс родитель в портале", "Von einem Elternteil im Portal eingetragen") : undefined}
    >
      <UserRound aria-hidden="true" className="size-3" />
      {tx("от пациента", "vom Patienten")}
      {marker.at ? ` · ${formatAppDateTime(marker.at)}` : ""}
    </Badge>
  );
}

/** "I fill it in" / "the patient fills it in" for wizard step 1. */
export function Step1FillModeSwitch({
  mode,
  onChange,
  disabled = false,
  tx,
}: {
  mode: Step1FillMode;
  onChange: (mode: Step1FillMode) => void;
  disabled?: boolean;
  tx: Tx;
}) {
  const options: Array<{ value: Step1FillMode; label: string }> = [
    { value: "staff", label: tx("Заполняю сам", "Ich fülle aus") },
    { value: "patient", label: tx("Заполнит пациент", "Patient füllt aus") },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={tx("Кто заполняет данные клиента", "Wer füllt die Personendaten aus")}
      className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
      data-testid="step1-fill-mode"
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={mode === option.value}
          tabIndex={mode === option.value ? 0 : -1}
          disabled={disabled}
          className={cn(
            "min-h-7 cursor-pointer rounded-md border px-2.5 py-1 text-xs leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-default disabled:opacity-60",
            mode === option.value
              ? "border-[var(--brand)] bg-[var(--brand)] font-semibold text-white shadow-sm"
              : "border-transparent bg-card text-muted-foreground hover:border-border hover:bg-muted/70 hover:text-foreground",
          )}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (disabled) return;
            let nextIndex: number;
            if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % options.length;
            else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index + options.length - 1) % options.length;
            else if (event.key === "Home") nextIndex = 0;
            else if (event.key === "End") nextIndex = options.length - 1;
            else return;
            event.preventDefault();
            if (options[nextIndex].value !== mode) onChange(options[nextIndex].value);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus();
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Progress of the patient in the portal, shown in step 1. */
export function Step1PortalSummary({ intake, mode, tx }: { intake: LeadPortalIntake | null; mode: Step1FillMode; tx: Tx }) {
  if (!intake) {
    return mode === "patient" ? (
      <p className="text-xs text-muted-foreground">
        {tx(
          "Обязательны только имя, фамилия и e-mail. Остальное пациент заполнит в портале; заполнить самому можно в любой момент.",
          "Pflicht sind nur Vorname, Nachname und E-Mail. Den Rest füllt der Patient im Portal aus; selbst ausfüllen geht jederzeit.",
        )}
      </p>
    ) : null;
  }
  const parts = portalProgressText(intake.progress, tx, formatAppDateTime);
  const allFieldsFilled = intake.progress.total > 0 && intake.progress.filled >= intake.progress.total;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs text-muted-foreground" data-testid="step1-portal-summary">
      {intake.submitted_at ? <CheckCheck aria-hidden="true" className="size-3.5 text-emerald-600" /> : <Clock3 aria-hidden="true" className="size-3.5" />}
      <span className="mr-0.5">{tx("Портал пациента:", "Patientenportal:")}</span>
      {parts.map((part, index) => {
        // portalProgressText returns fields, medical documents, then submission.
        const tone = index === 0
          ? allFieldsFilled ? "success" : "warning"
          : index === 1 ? intake.progress.documents > 0 ? "success" : "info" : "success";
        return <StatusChip key={part} tone={tone}>{part}</StatusChip>;
      })}
    </div>
  );
}

/** Shown after the patient changed data while the wizard is open. */
export function PatientUpdatedBanner({ at, onClose, tx }: { at: string; onClose: () => void; tx: Tx }) {
  return (
    <div
      role="status"
      data-testid="patient-updated-banner"
      className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900"
    >
      <RefreshCw aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {tx("Пациент обновил данные", "Der Patient hat Daten aktualisiert")} · {formatAppDateTime(at)}.{" "}
        {tx(
          "Поля, которые вы не меняли, обновлены.",
          "Felder, die Sie nicht geändert haben, sind übernommen.",
        )}
      </span>
      <button type="button" className="rounded p-0.5 hover:bg-sky-100" aria-label={tx("Закрыть", "Schließen")} onClick={onClose}>
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

/**
 * Later steps that need the prospect patient wait for date of birth and legal
 * sex; the notice names only what is still empty (`missing`, both when absent).
 */
export function PatientDataPendingNotice({
  onOpenStep1,
  tx,
  missing = ["birthDate", "legalSex"],
}: {
  onOpenStep1: () => void;
  tx: Tx;
  missing?: ReadonlyArray<"birthDate" | "legalSex">;
}) {
  const birthDate = missing.includes("birthDate");
  const legalSex = missing.includes("legalSex");
  const what = birthDate && legalSex
    ? tx("дату рождения и пол согласно документам", "Geburtsdatum und Geschlecht")
    : birthDate
      ? tx("дату рождения", "das Geburtsdatum")
      : tx("пол согласно документам", "das Geschlecht laut Dokument");
  const fields = birthDate && legalSex
    ? tx("эти поля", "diese Felder")
    : tx("это поле", "dieses Feld");
  return (
    <StatusChip
      tone="warning"
      role="status"
      data-testid="patient-data-pending"
      className="w-full items-start rounded-xl px-3 py-2"
    >
      <Clock3 aria-hidden="true" className="mt-[3px] size-3.5 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col items-start gap-2 sm:flex-row sm:gap-3">
        <span className="min-w-0 flex-1 leading-5">
          {tx(
            `Ждём данные пациента: ${what} пациент заполнит в портале. Медицинская часть станет доступна после этого — или заполните ${fields} сами на шаге «Данные клиента».`,
            `Warten auf die Daten des Patienten: ${what} trägt der Patient im Portal ein. Danach ist der medizinische Teil verfügbar – oder Sie füllen ${fields} selbst unter „Personendaten“ aus.`,
          )}
        </span>
        <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 text-xs" onClick={onOpenStep1}>
          {tx("К данным клиента", "Zu den Personendaten")}
        </Button>
      </span>
    </StatusChip>
  );
}

/** Patient uploads of the open lead, for the document rows of the wizard. */
type PortalUploadsState = {
  uploads: ReadonlyMap<string, LeadPortalUpload>;
  leadId: string;
  canReview: boolean;
  onReviewed: () => void;
};

const PortalUploadsContext = createContext<PortalUploadsState | null>(null);

export function PortalUploadsProvider({
  intake,
  canReview,
  onReviewed,
  children,
}: {
  intake: LeadPortalIntake | null;
  canReview: boolean;
  onReviewed: () => void;
  children: ReactNode;
}) {
  const value = useMemo<PortalUploadsState | null>(
    () =>
      intake
        ? {
            uploads: new Map(intake.uploads.map((upload) => [upload.document_id, upload])),
            leadId: intake.lead_id,
            canReview,
            onReviewed,
          }
        : null,
    [canReview, intake, onReviewed],
  );
  return <PortalUploadsContext.Provider value={value}>{children}</PortalUploadsContext.Provider>;
}

/** Ids of the documents the patient uploaded through the portal. */
export function usePortalUploadIds(): ReadonlySet<string> {
  const state = useContext(PortalUploadsContext);
  return useMemo(() => new Set(state?.uploads.keys() ?? []), [state]);
}

/** "Uploaded by the patient" with the consent mark, in a document row. */
export function PatientUploadMark({ documentId, lang }: { documentId: string; lang: string }) {
  const state = useContext(PortalUploadsContext);
  const upload = state?.uploads.get(documentId);
  const [busy, setBusy] = useState(false);
  if (!state || !upload) return null;
  const de = lang === "de";
  const consentOk = Boolean(upload.consent_given_at) && !upload.consent_revoked_at;
  return (
    <>
      <Badge
        variant="outline"
        data-testid="patient-upload-mark"
        className="h-5 gap-1 rounded-full border-sky-200 bg-sky-50 px-1.5 text-[10.5px] font-medium text-sky-800"
      >
        <UserRound aria-hidden="true" className="size-3" />
        {de ? "Vom Patienten hochgeladen" : "Загружено пациентом"}
        {upload.uploaded_at ? ` · ${formatAppDateTime(upload.uploaded_at)}` : ""}
      </Badge>
      <Badge
        variant="outline"
        title={upload.consent_given_at ? formatAppDateTime(upload.consent_given_at) : undefined}
        className={cn(
          "h-5 rounded-full px-1.5 text-[10.5px] font-medium",
          consentOk ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800",
        )}
      >
        {consentOk
          ? de ? "Einwilligung Art. 9 ✓" : "Согласие ст. 9 ✓"
          : de ? "Einwilligung widerrufen" : "Согласие отозвано"}
      </Badge>
      {upload.reviewed_at ? (
        <span className="text-[10.5px] text-muted-foreground">
          {de ? "Übernommen" : "Принято"} {formatAppDateTime(upload.reviewed_at)}
        </span>
      ) : state.canReview ? (
        <Button
          type="button"
          variant="default"
          size="xs"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void reviewLeadPortalUpload(state.leadId, documentId)
              .then(() => state.onReviewed())
              .catch(() => undefined)
              .finally(() => setBusy(false));
          }}
        >
          {busy ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin" /> : null}
          {de ? "Als geprüft markieren" : "Отметить просмотренным"}
        </Button>
      ) : null}
    </>
  );
}

/** Portal consent to process the request data, for the compliance (documents) step. */
export function PortalInquiryConsentLine({ intake, tx }: { intake: LeadPortalIntake | null; tx: Tx }) {
  if (!intake) return null;
  return (
    <div className="space-y-1" data-testid="portal-inquiry-consent">
      <PortalConsentRecord
        label={tx("Согласие на обработку запроса (кабинет)", "Einwilligung zur Bearbeitung der Anfrage (Kundenkabinett)")}
        consent={latestPortalConsent(intake.consents, "lead_inquiry_processing")}
        tx={tx}
      />
    </div>
  );
}

/** Art. 9 consent is a separate fact, even before the first medical upload. */
export function PortalHealthConsentLine({ intake, tx }: { intake: LeadPortalIntake | null; tx: Tx }) {
  if (!intake || intake.uploads_hidden) return null;
  return (
    <div data-testid="portal-health-consent">
      <PortalConsentRecord
        label={tx("Согласие на обработку медицинских данных (ст. 9 DSGVO, портал)", "Einwilligung zur Verarbeitung von Gesundheitsdaten (Art. 9 DSGVO, Portal)")}
        consent={latestPortalConsent(intake.consents, "health_data_processing")}
        tx={tx}
      />
    </div>
  );
}

function PortalConsentRecord({ label, consent, tx }: { label: string; consent: LeadPortalConsent | null; tx: Tx }) {
  const revoked = Boolean(consent?.revoked_at);
  const given = Boolean(consent?.given_at);
  const who = consent?.access_kind === "guardian" ? tx("родитель / представитель", "Elternteil / Vertretung")
    : consent?.access_kind === "self" ? tx("пациент", "Patient/in") : null;
  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium leading-5">{label}</span>
        <StatusChip tone={!revoked && given ? "success" : "warning"}>
          {revoked ? tx("Отозвано", "Widerrufen") : given ? tx("Дано", "Erteilt") : tx("Не дано", "Nicht erteilt")}
        </StatusChip>
        {given || revoked ? (
          <StatusChip tone="warning" className="whitespace-normal">
            <CalendarDays aria-hidden="true" />
            <span>
              {consent?.given_at ? `${tx("Дано:", "Erteilt:")} ${formatAppDateTime(consent.given_at)}` : ""}
              {consent?.revoked_at ? `${given ? " · " : ""}${tx("Отозвано:", "Widerrufen:")} ${formatAppDateTime(consent.revoked_at)}` : ""}
              {who ? ` · ${who}` : ""}{consent?.version ? ` · ${tx("версия", "Version")} ${consent.version}` : ""}
            </span>
          </StatusChip>
        ) : null}
      </div>
    </div>
  );
}
