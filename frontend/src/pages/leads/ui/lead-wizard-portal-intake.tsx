import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCheck, Clock3, LoaderCircle, RefreshCw, UserRound, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import {
  reviewLeadPortalUpload,
  type LeadPortalIntake,
  type LeadPortalUpload,
  type PatientFieldMarker,
  type Step1FillMode,
} from "../data/lead-portal-intake-api";
import { portalProgressText } from "../model/lead-portal-intake";

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
  tx: Tx;
};

const Step1PortalContext = createContext<Step1PortalState | null>(null);

export function Step1PortalProvider({
  mode,
  intake,
  errorIdByDraftKey,
  patientFilledKeys,
  portalFieldByDraftKey,
  tx,
  children,
}: {
  mode: Step1FillMode;
  intake: LeadPortalIntake | null;
  errorIdByDraftKey: Readonly<Record<string, string>>;
  patientFilledKeys: readonly string[];
  portalFieldByDraftKey: Readonly<Record<string, string>>;
  tx: Tx;
  children: ReactNode;
}) {
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
    return {
      mode,
      patientFilledErrorIds: new Set(
        patientFilledKeys.map((key) => errorIdByDraftKey[key]).filter((id): id is string => Boolean(id)),
      ),
      markerByErrorId,
      markerByPortalField,
      tx,
    };
  }, [errorIdByDraftKey, intake, mode, patientFilledKeys, portalFieldByDraftKey, tx]);
  return <Step1PortalContext.Provider value={value}>{children}</Step1PortalContext.Provider>;
}

/**
 * For a wizard field: whether the patient fills it in (optional, with a hint)
 * and the "from the patient" marker. Outside step 1 both are empty.
 */
export function useStep1PortalField(errorId?: string, portalField?: string) {
  const state = useContext(Step1PortalContext);
  if (!state) return { patientFills: false, marker: null as PatientFieldMarker | null, tx: null };
  const patientFills =
    state.mode === "patient"
    && ((errorId ? state.patientFilledErrorIds.has(errorId) : false) || Boolean(portalField && portalField !== "first_name" && portalField !== "last_name"));
  const marker =
    (errorId ? state.markerByErrorId.get(errorId) : undefined)
    ?? (portalField ? state.markerByPortalField.get(portalField) : undefined)
    ?? null;
  return { patientFills, marker, tx: state.tx };
}

/** Hint and badge under a wizard field label. */
export function Step1PortalFieldNote({ errorId, portalField }: { errorId?: string; portalField?: string }) {
  const { patientFills, marker, tx } = useStep1PortalField(errorId, portalField);
  if (!tx || (!patientFills && !marker)) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {marker ? <PatientFieldBadge marker={marker} tx={tx} /> : null}
      {patientFills && !marker ? (
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
      className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5"
      data-testid="step1-fill-mode"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={mode === option.value}
          disabled={disabled}
          className={cn(
            "rounded-md px-3 py-1 text-xs transition-colors",
            mode === option.value ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onChange(option.value)}
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
  return (
    <p className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right text-xs text-muted-foreground" data-testid="step1-portal-summary">
      {intake.submitted_at ? <CheckCheck aria-hidden="true" className="size-3.5 text-emerald-600" /> : <Clock3 aria-hidden="true" className="size-3.5" />}
      <span>{tx("Портал пациента:", "Patientenportal:")}</span>
      {parts.map((part) => (
        <span key={part}>{part}</span>
      ))}
    </p>
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
    ? tx("дату рождения и пол по документам", "Geburtsdatum und Geschlecht")
    : birthDate
      ? tx("дату рождения", "das Geburtsdatum")
      : tx("пол по документам", "das Geschlecht laut Dokument");
  const fields = birthDate && legalSex
    ? tx("эти поля", "diese Felder")
    : tx("это поле", "dieses Feld");
  return (
    <div
      role="status"
      data-testid="patient-data-pending"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900"
    >
      <Clock3 aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {tx(
          `Ждём данные пациента: ${what} пациент заполнит в портале. Медицинская часть станет доступна после этого — или заполните ${fields} сами на шаге «Данные клиента».`,
          `Warten auf die Daten des Patienten: ${what} trägt der Patient im Portal ein. Danach ist der medizinische Teil verfügbar – oder Sie füllen ${fields} selbst unter „Personendaten“ aus.`,
        )}
      </span>
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onOpenStep1}>
        {tx("К данным клиента", "Zu den Personendaten")}
      </Button>
    </div>
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
          variant="outline"
          size="sm"
          className="h-5 rounded-full px-2 text-[10.5px]"
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
  const consent = intake?.consents.find((item) => item.type === "lead_inquiry_processing" && !item.revoked_at);
  if (!consent?.given_at) return null;
  return (
    <p className="text-xs text-emerald-700" data-testid="portal-inquiry-consent">
      {tx("Согласие на обработку данных обращения (портал)", "Einwilligung zur Bearbeitung der Anfrage (Portal)")} ✓{" "}
      {formatAppDateTime(consent.given_at)}
      <span className="block text-muted-foreground">
        {tx(
          "Не заменяет подписанный документ DSGVO: удаление через 14 дней останавливает только он.",
          "Ersetzt nicht das unterschriebene DSGVO-Dokument: nur dieses stoppt die Löschung nach 14 Tagen.",
        )}
      </span>
    </p>
  );
}
