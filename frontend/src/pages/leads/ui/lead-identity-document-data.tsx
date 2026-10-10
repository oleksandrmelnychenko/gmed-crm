import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, LoaderCircle } from "lucide-react";

import { checkboxClass, inputClass, selectClass, tokens } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { appDateKey } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import {
  saveLeadIdentityDocumentData,
  saveRepresentativeIdentityDocumentData,
  type IdentityDocumentDataInput,
} from "../data/lead-risk-api";
import type { LeadPortalIntake, LeadRepresentative } from "../data/lead-portal-intake-api";
import {
  ID_DOCUMENT_TYPES,
  identityDocumentDatesInvalid,
  identityDocumentDraft,
  identityDocumentDraftChanged,
  identityDocumentEnteredLine,
  identityDocumentExpired,
  identityDocumentInput,
  type IdentityDocumentDraft,
  type IdentityDocumentSource,
} from "../model/lead-identity-document-data";
import { idDocumentTypeLabel, representativeName, representativeRoleLabel } from "../model/lead-gwg-statements";
import type { Tx } from "../model/lead-payer";

const WARNING_TEXT = "text-amber-700 dark:text-amber-300";

function FormField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("min-w-0 space-y-1.5", className)}>
      <span className={cn(tokens.text.label, "block")}>{label}</span>
      {children}
    </label>
  );
}

/**
 * The identity document data of one person, entered by staff from the scan:
 * type, number, authority, country, issued, valid until and "Ausweis
 * unleserlich". A past "valid until" is accepted (the risk assessment counts
 * it); the line under the form says who entered the data and when.
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
}: {
  source: IdentityDocumentSource | null | undefined;
  /** The wizard's old "passport valid until" while nothing is stored in the new place. */
  fallbackValidUntil?: string;
  save: (input: IdentityDocumentDataInput) => Promise<void>;
  tx: Tx;
  lang: string;
  disabled?: boolean;
  testId: string;
  today?: string;
}) {
  const fieldId = useId();
  const savedKey = JSON.stringify(identityDocumentDraft(source, fallbackValidUntil));
  const saved = useMemo(() => JSON.parse(savedKey) as IdentityDocumentDraft, [savedKey]);
  const [draft, setDraft] = useState<IdentityDocumentDraft>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const lastSavedRef = useRef(saved);

  // A fresh server state replaces the form, unless staff are typing over the previous one.
  useEffect(() => {
    const previous = lastSavedRef.current;
    lastSavedRef.current = saved;
    setDraft((current) => (identityDocumentDraftChanged(current, previous) ? current : saved));
  }, [saved]);

  const patch = (next: Partial<IdentityDocumentDraft>) => {
    setDone(false);
    setDraft((current) => ({ ...current, ...next }));
  };
  const changed = identityDocumentDraftChanged(draft, saved);
  const datesInvalid = identityDocumentDatesInvalid(draft);
  const expired = identityDocumentExpired(draft, today);
  const entered = identityDocumentEnteredLine(source, tx);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await save(identityDocumentInput(draft));
      setDone(true);
    } catch (saveError) {
      setError(saveError instanceof Error && saveError.message ? saveError.message : tx("Не удалось сохранить", "Speichern fehlgeschlagen"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2.5" data-testid={testId}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label={tx("Вид документа", "Art des Dokuments")}>
          <NativeComboboxSelect
            className={selectClass}
            name="id_document_type"
            value={draft.type}
            disabled={disabled || busy}
            aria-label={tx("Вид документа", "Art des Dokuments")}
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
        <FormField label={tx("Номер документа", "Dokumentnummer")}>
          <Input
            className={inputClass}
            name="id_document_number"
            autoComplete="off"
            value={draft.number}
            disabled={disabled || busy}
            onChange={(event) => patch({ number: event.target.value })}
          />
        </FormField>
        <FormField label={tx("Кем выдан", "Ausstellende Behörde")}>
          <Input
            className={inputClass}
            name="id_issuing_authority"
            value={draft.authority}
            disabled={disabled || busy}
            onChange={(event) => patch({ authority: event.target.value })}
          />
        </FormField>
        <FormField label={tx("Страна выдачи", "Ausstellungsland")}>
          <CountrySelect
            value={draft.country}
            lang={lang}
            className={selectClass}
            aria-label={tx("Страна выдачи", "Ausstellungsland")}
            disabled={disabled || busy}
            onChange={(code) => patch({ country: code ?? "" })}
          />
        </FormField>
        <FormField label={tx("Дата выдачи", "Ausgestellt am")}>
          <Input
            className={inputClass}
            type="date"
            name="id_issued_on"
            max={today}
            value={draft.issuedOn}
            disabled={disabled || busy}
            onChange={(event) => patch({ issuedOn: event.target.value })}
          />
        </FormField>
        <FormField label={tx("Действителен до", "Gültig bis")}>
          <Input
            className={cn(inputClass, expired && "border-amber-400")}
            type="date"
            name="id_valid_until"
            value={draft.validUntil}
            disabled={disabled || busy}
            aria-describedby={expired ? `${fieldId}-expired` : undefined}
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
          disabled={disabled || busy}
          onChange={(event) => patch({ unreadable: event.target.checked })}
        />
        {tx("Документ нечитаем (запросить новый скан)", "Ausweis unleserlich (neuen Scan anfordern)")}
      </label>
      {expired ? (
        <p id={`${fieldId}-expired`} className={cn("text-xs font-medium", WARNING_TEXT)} data-testid={`${testId}-expired`}>
          {tx("Срок действия документа истёк", "Das Ausweisdokument ist abgelaufen")}
        </p>
      ) : null}
      {datesInvalid ? (
        <p className="text-xs font-medium text-destructive" role="alert">
          {tx("Дата выдачи позже срока действия", "Ausstellungsdatum liegt nach dem Ablaufdatum")}
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
        <div className="flex items-center gap-2">
          {done && !changed ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700" role="status">
              <Check aria-hidden className="size-3.5" />
              {tx("Сохранено", "Gespeichert")}
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-lg"
            disabled={disabled || busy || !changed || datesInvalid}
            onClick={() => void submit()}
            data-testid={`${testId}-save`}
          >
            {busy ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : null}
            {tx("Сохранить данные документа", "Ausweisdaten speichern")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RepresentativeForm({
  leadId,
  person,
  files,
  tx,
  lang,
  disabled,
  today,
  onSaved,
}: {
  leadId: string;
  person: LeadRepresentative;
  /** The person's own uploads (identity scan, power of attorney), under the person's card. */
  files?: ReactNode;
  tx: Tx;
  lang: string;
  disabled: boolean;
  today: string;
  onSaved: () => void;
}) {
  const filled = Boolean(person.id_document_number || person.id_valid_until || person.id_document_unreadable);
  // A saved expired date stays in sight (QA 2026-10-10: no warning after the save).
  const expired = Boolean(person.id_valid_until) && (person.id_valid_until ?? "") < today;
  const fileCount = person.identity_documents.length + person.authority_documents.length;
  return (
    <details className="rounded-md border border-border/60 bg-background/50 p-2.5" open={!filled || expired}>
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-semibold text-foreground">{representativeName(person) || "—"}</span>
        <span className="text-xs text-muted-foreground">{representativeRoleLabel(person, tx)}</span>
        {fileCount > 0 ? (
          <span className="text-xs text-muted-foreground">
            · {tx("файлов", "Dateien")}: {fileCount}
          </span>
        ) : null}
        {expired ? (
          <span className={cn("text-xs font-medium", WARNING_TEXT)} data-testid={`lead-representative-id-expired-${person.id}`}>
            · {tx("срок действия документа истёк", "Ausweis abgelaufen")}
          </span>
        ) : null}
      </summary>
      <div className="space-y-2.5 pt-2.5">
        <LeadIdentityDocumentDataForm
          source={person}
          tx={tx}
          lang={lang}
          disabled={disabled}
          today={today}
          testId={`lead-representative-id-data-${person.id}`}
          save={async (input) => {
            await saveRepresentativeIdentityDocumentData(leadId, person.id, input);
            onSaved();
          }}
        />
        {files}
      </div>
    </details>
  );
}

/**
 * Staff's identity document data next to the scan list of the documents
 * step: the patient's document (replaces the old "valid until" field) and one
 * form per representative the cabinet or staff named.
 */
export function LeadIdentityDocumentData({
  leadId,
  intake,
  fallbackValidUntil = "",
  tx,
  lang,
  disabled = false,
  patientScans,
  representativeFiles,
  today = appDateKey(),
  onSaved,
}: {
  leadId: string;
  intake: LeadPortalIntake | null;
  fallbackValidUntil?: string;
  tx: Tx;
  lang: string;
  disabled?: boolean;
  /**
   * The patient's own scans, right under the patient's form — never under a
   * representative's card (QA 2026-10-10: the patient's pass.pdf looked like
   * the representative's).
   */
  patientScans?: ReactNode;
  /** A representative's own uploads, under that person's card. */
  representativeFiles?: (person: LeadRepresentative) => ReactNode;
  today?: string;
  /** After a save: reload the portal state and the risk assessment. */
  onSaved: () => void;
}) {
  // The role may not read the GwG data: only the scans.
  if (intake?.identification_hidden) return patientScans ? <>{patientScans}</> : null;
  const representatives = intake?.representation?.representatives ?? [];
  return (
    <div className="space-y-3" data-testid="lead-identity-document-data">
      {representatives.length > 0 ? (
        <h4 className="text-xs font-semibold text-foreground">{tx("Документ пациента", "Ausweis des Patienten")}</h4>
      ) : null}
      <LeadIdentityDocumentDataForm
        source={intake?.identification ?? null}
        fallbackValidUntil={fallbackValidUntil}
        tx={tx}
        lang={lang}
        disabled={disabled}
        today={today}
        testId="lead-id-data"
        save={async (input) => {
          await saveLeadIdentityDocumentData(leadId, input);
          onSaved();
        }}
      />
      {patientScans ? <div data-testid="lead-id-patient-scans">{patientScans}</div> : null}
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
              files={representativeFiles?.(person)}
              tx={tx}
              lang={lang}
              disabled={disabled}
              today={today}
              onSaved={onSaved}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
