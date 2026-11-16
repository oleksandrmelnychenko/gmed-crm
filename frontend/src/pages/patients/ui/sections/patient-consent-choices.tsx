import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, FilePlus2, LoaderCircle, MessageSquare, PencilLine, ShieldCheck, Users } from "lucide-react";

import { AdminDialogScaffold } from "@/components/admin-dialog-scaffold";
import { checkboxClass } from "@/components/record-workspace/primitives/design-tokens";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { StatusChip } from "@/components/ui/status-chip";
import { toast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { formatPortalTimestamp } from "@/lib/portal-datetime";
import { cn } from "@/lib/utils";
import { useOutdatedDocumentRenewal } from "@/pages/documents/ui/outdated-document-renewal";
import { CONSENT_FORM_CHANNELS, type ConsentFormChoices, type StaffConsentChannel, type StaffConsentRecord } from "@/pages/patient-lead/lead-request-api";
import { consentFormText } from "@/pages/patient-lead/lead-request-consent-form-text";
import { cabinetStaffText } from "@/pages/patient-lead/lead-request-staff-mode";
import { TrustedPersonsEditor, TrustedPersonsList } from "@/pages/patient-lead/lead-trusted-persons-editor";
import {
  draftIndexOfSent,
  recipientFieldOfServer,
  trustedPersonsProblem,
  type RecipientField,
} from "@/pages/patient-lead/lead-trusted-persons-model";
import {
  fetchPatientConsentState,
  savePatientConsentChange,
  type PatientConsentState,
} from "../../data/patient-consent-choices-api";
import {
  changeToSend,
  consentDraftOf,
  documentsToRenew,
  draftChanged,
  listedPersons,
  onlyWithdraws,
  type PatientConsentDraft,
} from "../../model/patient-consent-choices";
import { ConsentCard, ConsentRecordFields, focusConsentRecordHow } from "./patient-consent-parts";

type Lang = "ru" | "de" | "uk" | "en";

const TEXT: Record<Lang, {
  title: string; change: string; channels: string; persons: string; none: string; waiting: string;
  history: string; signed: string; save: string; consent: string; newVersion: string;
  sources: Record<string, string>; staff: string; nothingChanged: string; failed: string;
  coreRequired: string; consentRequired: string; byGuardian: string; outdated: string; howLabel: string; saved: string;
}> = {
  ru: {
    title: "Согласия и доверенные лица", change: "Изменить согласия", channels: "Каналы связи", persons: "Доверенные лица",
    none: "Никого", waiting: "ожидает подписи", history: "История", signed: "подписано", save: "Сохранить",
    consent: "Я подтверждаю согласие", newVersion: "Создать новую версию",
    sources: { lead_portal: "Заявка", staff_recorded: "Заявка, сотрудник", staff_correction: "Исправление", patient_staff: "Сотрудник", patient_portal: "Портал" },
    staff: "GMED", nothingChanged: "Нет изменений", failed: "Не удалось сохранить.",
    coreRequired: "Согласия на обработку данных GMED здесь не отзываются: запрос «Отзыв согласия».",
    consentRequired: "Подтвердите согласие на передачу данных названным лицам.",
    byGuardian: "Для несовершеннолетнего выбирает родитель или опекун.",
    outdated: "Текст согласия изменился. Обновите страницу.", howLabel: "Как клиент сообщил", saved: "Сохранено",
  },
  de: {
    title: "Einwilligungen und Vertrauenspersonen", change: "Einwilligungen ändern", channels: "Kommunikationswege", persons: "Vertrauenspersonen",
    none: "Niemand", waiting: "wartet auf Unterschrift", history: "Verlauf", signed: "unterschrieben", save: "Speichern",
    consent: "Ich bestätige die Einwilligung", newVersion: "Neue Version erstellen",
    sources: { lead_portal: "Anfrage", staff_recorded: "Anfrage, Mitarbeiter", staff_correction: "Korrektur", patient_staff: "Mitarbeiter", patient_portal: "Portal" },
    staff: "GMED", nothingChanged: "Keine Änderungen", failed: "Speichern fehlgeschlagen.",
    coreRequired: "Die Einwilligungen in die Verarbeitung durch GMED werden hier nicht widerrufen: Antrag «Widerruf der Einwilligung».",
    consentRequired: "Bestätigen Sie die Einwilligung zur Weitergabe an die genannten Personen.",
    byGuardian: "Für Minderjährige wählt ein Elternteil oder der Vormund.",
    outdated: "Der Einwilligungstext hat sich geändert. Laden Sie die Seite neu.", howLabel: "Wie der Kunde es mitgeteilt hat", saved: "Gespeichert",
  },
  uk: {
    title: "Згоди та довірені особи", change: "Змінити згоди", channels: "Канали зв’язку", persons: "Довірені особи",
    none: "Нікого", waiting: "очікує підпису", history: "Історія", signed: "підписано", save: "Зберегти",
    consent: "Я підтверджую згоду", newVersion: "Створити нову версію",
    sources: { lead_portal: "Заявка", staff_recorded: "Заявка, співробітник", staff_correction: "Виправлення", patient_staff: "Співробітник", patient_portal: "Портал" },
    staff: "GMED", nothingChanged: "Немає змін", failed: "Не вдалося зберегти.",
    coreRequired: "Згоди на обробку даних GMED тут не відкликаються: запит «Відкликання згоди».",
    consentRequired: "Підтвердьте згоду на передачу даних названим особам.",
    byGuardian: "За неповнолітнього обирає батько, мати або опікун.",
    outdated: "Текст згоди змінився. Оновіть сторінку.", howLabel: "Як клієнт повідомив", saved: "Збережено",
  },
  en: {
    title: "Consents and trusted persons", change: "Change consents", channels: "Communication channels", persons: "Trusted persons",
    none: "Nobody", waiting: "awaiting signature", history: "History", signed: "signed", save: "Save",
    consent: "I confirm the consent", newVersion: "Create new version",
    sources: { lead_portal: "Request", staff_recorded: "Request, staff", staff_correction: "Correction", patient_staff: "Staff", patient_portal: "Portal" },
    staff: "GMED", nothingChanged: "No changes", failed: "Could not save.",
    coreRequired: "The consents to processing by GMED are not withdrawn here: use the request «Withdraw consent».",
    consentRequired: "Confirm the consent to share data with the named persons.",
    byGuardian: "For a minor, a parent or the guardian chooses.",
    outdated: "The consent text has changed. Reload the page.", howLabel: "How the client told us", saved: "Saved",
  },
};

export function consentText(lang: string) {
  return TEXT[(["ru", "de", "uk", "en"] as const).find((code) => code === lang) ?? "ru"];
}

function errorCode(error: unknown): { code?: string; field?: unknown; index?: unknown } {
  if (!(error instanceof ApiRequestError)) return {};
  const body = (error.body ?? {}) as { code?: string; error?: string; field?: unknown; index?: unknown };
  return { code: body.code ?? body.error ?? error.code, field: body.field, index: body.index };
}

/** The channels a person may still choose: Threema only while it is ticked (no longer offered). */
function shownChannels(state: PatientConsentState): (keyof ConsentFormChoices)[] {
  return CONSENT_FORM_CHANNELS.filter((key) => key !== "channel_threema" || state.requested?.choices.channel_threema);
}

/**
 * «Изменить согласия» (owner request 2026-11-16): the channels and the trusted persons of the
 * Einverständniserklärung. Staff (`patientId`) record how the client told them; the patient
 * (`patientId = null`, portal) saves directly. A removal applies at once, an addition once the new
 * version of the form is signed.
 */
export function PatientConsentChoicesDialog({
  state,
  patientId,
  open,
  onOpenChange,
  onSaved,
}: {
  state: PatientConsentState;
  patientId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (state: PatientConsentState) => void;
}) {
  const { lang } = useLang();
  const text = consentText(lang);
  const formText = useMemo(() => consentFormText(lang, state.minor && patientId === null), [lang, state.minor, patientId]);
  const [draft, setDraft] = useState<PatientConsentDraft>(() => consentDraftOf(state));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [serverProblem, setServerProblem] = useState<{ index: number; field: RecipientField } | null>(null);
  const [how, setHow] = useState<StaffConsentChannel | "">("");
  const [note, setNote] = useState("");
  const [howMissing, setHowMissing] = useState(false);
  const staff = patientId !== null;
  useEffect(() => {
    if (open) {
      setDraft(consentDraftOf(state));
      setError("");
      setShowErrors(false);
      setServerProblem(null);
      setHow("");
      setNote("");
      setHowMissing(false);
    }
  }, [open, state]);
  const changed = draftChanged(draft, state);
  const sent = changeToSend(draft, state, lang);
  const withdrawal = onlyWithdraws(sent.choices, sent.recipients, state);
  const needsConsent = sent.recipients.length > 0 && !withdrawal;

  const save = async () => {
    setShowErrors(true);
    // Staff: «Как клиент сообщил» is required; it is marked with the other missing answers.
    if (staff && !how) setHowMissing(true);
    if (trustedPersonsProblem(draft.persons)) return;
    if (needsConsent && !draft.consentGiven) {
      setError(text.consentRequired);
      return;
    }
    if (staff && !how) {
      setError("");
      focusConsentRecordHow("patient-consent");
      return;
    }
    const recorded: StaffConsentRecord | null = staff && how ? { how, note } : null;
    setBusy(true);
    setError("");
    setServerProblem(null);
    try {
      const saved = await savePatientConsentChange(patientId, changeToSend(draft, state, lang, recorded));
      onSaved(saved);
      onOpenChange(false);
    } catch (cause) {
      const { code, field, index } = errorCode(cause);
      const at = draftIndexOfSent(draft.persons, index);
      const problemField = recipientFieldOfServer(field);
      if (at !== null && problemField) setServerProblem({ index: at, field: problemField });
      setError(code === "nothing_changed" ? text.nothingChanged
        : code === "consent_core_required" ? text.coreRequired
        : code === "disclosure_consent_required" ? text.consentRequired
        : code === "consent_choice_by_guardian" ? text.byGuardian
        : code === "consent_version_outdated" ? text.outdated
        : text.failed);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: keyof ConsentFormChoices) => setDraft((current) => ({ ...current, choices: { ...current.choices, [key]: !current.choices[key] } }));

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }} dirty={changed}>
      <AdminDialogScaffold
        icon={ShieldCheck}
        title={text.change}
        maxWidthClassName="sm:max-w-3xl"
        testId="patient-consent-dialog"
        footer={(
          <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3" data-testid="patient-consent-footer">
            {error ? <p role="alert" className="mr-auto min-w-0 text-sm text-destructive" data-testid="patient-consent-error">{error}</p> : null}
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)} data-testid="patient-consent-cancel">
              {cabinetStaffText(lang).cancel}
            </Button>
            <Button type="button" disabled={busy || !changed} onClick={() => void save()} data-testid={staff ? "patient-consent-record-save" : "patient-consent-save"}>
              {busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}{text.save}
            </Button>
          </div>
        )}
      >
        <ConsentCard icon={MessageSquare} title={text.channels} fieldset testId="patient-consent-channels">
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {shownChannels(state).map((key) => (
              <label key={key} className="flex min-w-0 items-center gap-2">
                <input type="checkbox" className={checkboxClass} checked={draft.choices[key]} disabled={busy}
                  onChange={() => toggle(key)} data-testid={`patient-consent-${key}`} />
                <span>{formText.options[key]}</span>
              </label>
            ))}
          </div>
        </ConsentCard>
        <ConsentCard icon={Users} title={text.persons} testId="patient-consent-persons">
          <TrustedPersonsEditor persons={draft.persons} lang={lang} disabled={busy} showErrors={showErrors} serverProblem={serverProblem}
            variant={staff ? "staff" : "cabinet"} onChange={(persons) => setDraft((current) => ({ ...current, persons }))} />
          {needsConsent ? (
            <label className="flex items-start gap-2 border-t border-border/60 pt-3" data-testid="patient-consent-disclosure">
              <input type="checkbox" className={cn(checkboxClass, "mt-0.5 shrink-0")} checked={draft.consentGiven} disabled={busy}
                onChange={() => setDraft((current) => ({ ...current, consentGiven: !current.consentGiven }))} data-testid="patient-consent-given" />
              <span><span className="font-medium">{text.consent}:</span> {state.disclosure_text}</span>
            </label>
          ) : null}
        </ConsentCard>
        {staff ? (
          <ConsentCard testId="patient-consent-record-card">
            <ConsentRecordFields lang={lang} testId="patient-consent" howLabel={text.howLabel} how={how} note={note} disabled={busy}
              missing={howMissing} onHow={(value) => { setHow(value); if (value) setHowMissing(false); }} onNote={setNote} />
          </ConsentCard>
        ) : null}
      </AdminDialogScaffold>
    </Dialog>
  );
}

/** The state block: channels and persons that apply, additions waiting for the signature, history. */
export function PatientConsentChoicesView({
  state,
  onEdit,
  renewing,
  onRenew,
}: {
  state: PatientConsentState;
  onEdit?: () => void;
  renewing?: string | null;
  onRenew?: (documentId: string) => void;
}) {
  const { lang } = useLang();
  const text = consentText(lang);
  const formText = consentFormText(lang);
  const { applies, waiting } = listedPersons(state);
  const channels = CONSENT_FORM_CHANNELS.filter((key) => state.effective.choices[key]);
  const waitingChannels = state.pending.options.filter((key) => (CONSENT_FORM_CHANNELS as readonly string[]).includes(key));
  const how = cabinetStaffText(lang === "de" ? "de" : "ru").channels;
  return (
    <div className="space-y-3 text-sm" data-testid="patient-consent-choices">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5" data-testid="patient-consent-channels-applied">
          <span className="font-mono text-xs text-muted-foreground">{text.channels}:</span>
          {channels.length === 0 && waitingChannels.length === 0 ? <span className="text-muted-foreground">—</span> : null}
          {channels.map((key) => <StatusChip key={key} tone="info">{formText.options[key]}</StatusChip>)}
          {waitingChannels.map((key) => (
            <StatusChip key={key} tone="warning" data-testid="patient-consent-channel-waiting"><Clock3 aria-hidden="true" />{formText.options[key]} · {text.waiting}</StatusChip>
          ))}
        </div>
        {onEdit ? (
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onEdit} data-testid="patient-consent-edit">
            <PencilLine aria-hidden="true" className="size-3.5" />{text.change}
          </Button>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <span className="font-mono text-xs text-muted-foreground">{text.persons}</span>
        {applies.length === 0 && waiting.length === 0 ? <p className="text-muted-foreground">{text.none}</p> : null}
        <TrustedPersonsList persons={applies} lang={lang} />
        {waiting.length > 0 ? (
          <div className="space-y-1" data-testid="patient-consent-persons-waiting">
            <StatusChip tone="warning"><Clock3 aria-hidden="true" />{text.waiting}</StatusChip>
            <TrustedPersonsList persons={waiting} lang={lang} />
          </div>
        ) : null}
      </div>
      {onRenew ? state.documents.filter((document) => document.needs_new_version).map((document) => (
        <div key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/60 bg-amber-50/60 px-3 py-2 dark:bg-amber-950/20">
          <span className="min-w-0 [overflow-wrap:anywhere]">{document.title}</span>
          <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={renewing !== null && renewing !== undefined}
            onClick={() => onRenew(document.id)} data-testid={`patient-consent-renew-${document.id}`}>
            {renewing === document.id ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <FilePlus2 aria-hidden="true" className="size-3.5" />}
            {text.newVersion}
          </Button>
        </div>
      )) : null}
      {state.history.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer font-mono text-muted-foreground">{text.history}</summary>
          <ul className="mt-1.5 space-y-1" data-testid="patient-consent-history">
            {state.history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="tabular-nums">{formatPortalTimestamp(entry.chosen_at)}</span>
                <span>{text.sources[entry.source] ?? entry.source}</span>
                {entry.recorded_how ? <span className="text-muted-foreground">{how[entry.recorded_how] ?? entry.recorded_how}</span> : null}
                {entry.chosen_by_name ? <span className="text-muted-foreground">{entry.chosen_by_name}</span> : entry.access_kind === "staff" ? <span className="text-muted-foreground">{text.staff}</span> : null}
                {entry.recorded_note ? <span className="text-muted-foreground [overflow-wrap:anywhere]">«{entry.recorded_note}»</span> : null}
                {entry.signed ? <StatusChip tone="success">{text.signed}</StatusChip> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Loads and edits the consent choices: the patient card (`patientId`) or the portal (`null`).
 * After a staff change the consent form gets its new version at once and the signature dialog
 * offers «Отправить на подпись» and «Передать клиенту» (fix-65 flow).
 */
export function usePatientConsentChoices(patientId: string | null) {
  const { lang } = useLang();
  const [state, setState] = useState<PatientConsentState | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    fetchPatientConsentState(patientId, lang)
      .then((loaded) => { if (active) { setState(loaded); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [patientId, lang, reload]);
  const refresh = useCallback(() => setReload((value) => value + 1), []);
  const renewal = useOutdatedDocumentRenewal({ onRenewed: refresh });
  const { renew } = renewal;
  const onSaved = useCallback((saved: PatientConsentState) => {
    setState(saved);
    toast.success(consentText(lang).saved);
    // Staff: the consent form that prints the choice gets its new version at once.
    const [first] = patientId ? documentsToRenew(saved) : [];
    if (first) void renew(first, "consent_changed");
  }, [lang, patientId, renew]);
  return { state, failed, editing, setEditing, onSaved, renewal, refresh };
}

/** Roles that read the consent choices of a patient (CEO Assistant only reads). */
const READING_ROLES = ["ceo", "ceo_assistant", "patient_manager"];

export function canReadPatientConsentChoices(role: string | null | undefined): boolean {
  return READING_ROLES.includes(role ?? "");
}

/** The block in the patient card (CEO, CEO Assistant, Patient Manager with the patient). */
export function PatientConsentChoicesCard({ patientId }: { patientId: string }) {
  const { lang } = useLang();
  const text = consentText(lang);
  const { state, failed, editing, setEditing, onSaved, renewal } = usePatientConsentChoices(patientId);
  if (failed || !state) return null;
  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-card" data-testid="patient-consent-card">
      <div className="flex min-w-0 items-center gap-2 border-b border-border/70 bg-muted/20 px-3.5 py-2.5">
        <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="min-w-0 break-words text-[13px] font-semibold tracking-tight text-foreground">{text.title}</h3>
      </div>
      <div className="px-3.5 py-3">
        <PatientConsentChoicesView
          state={state}
          onEdit={state.can_edit ? () => setEditing(true) : undefined}
          renewing={renewal.busyId}
          onRenew={state.can_edit ? (id) => void renewal.renew(id, "consent_changed") : undefined}
        />
      </div>
      {state.can_edit ? (
        <PatientConsentChoicesDialog state={state} patientId={patientId} open={editing} onOpenChange={setEditing} onSaved={onSaved} />
      ) : null}
      {renewal.dialog}
    </section>
  );
}

/** The block on the portal's privacy page: the patient (or the parent) changes it directly. */
export function PortalConsentChoicesSection() {
  const { lang } = useLang();
  const text = consentText(lang);
  const { state, failed, editing, setEditing, onSaved } = usePatientConsentChoices(null);
  if (failed || !state || !state.requested) return null;
  return (
    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-4" data-testid="portal-consent-card">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck aria-hidden="true" className="size-4" />{text.title}</h2>
      <PatientConsentChoicesView state={state} onEdit={state.can_edit ? () => setEditing(true) : undefined} />
      {state.can_edit ? (
        <PatientConsentChoicesDialog state={state} patientId={null} open={editing} onOpenChange={setEditing} onSaved={onSaved} />
      ) : null}
    </section>
  );
}
