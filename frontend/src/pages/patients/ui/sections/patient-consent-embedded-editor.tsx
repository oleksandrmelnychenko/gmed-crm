import { useEffect, useImperativeHandle, useState, type Ref } from "react";

import { checkboxClass } from "@/components/record-workspace/primitives/design-tokens";
import { ApiRequestError } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { CONSENT_FORM_CHANNELS, STAFF_CONSENT_CHANNELS, STAFF_CONSENT_NOTE_MAX, type ConsentFormChoices, type StaffConsentChannel } from "@/pages/patient-lead/lead-request-api";
import { consentFormText } from "@/pages/patient-lead/lead-request-consent-form-text";
import { cabinetStaffText } from "@/pages/patient-lead/lead-request-staff-mode";
import { TrustedPersonsEditor } from "@/pages/patient-lead/lead-trusted-persons-editor";
import { trustedPersonsProblem } from "@/pages/patient-lead/lead-trusted-persons-model";
import { fetchPatientConsentState, savePatientConsentChange, type PatientConsentState } from "../../data/patient-consent-choices-api";
import { changeToSend, consentDraftOf, draftChanged, onlyWithdraws, type PatientConsentDraft } from "../../model/patient-consent-choices";
import { consentText } from "./patient-consent-choices";

/** The templates that print the consent choice (the Einverständniserklärung, the minor's forms). */
export const CONSENT_CHOICE_TEMPLATES = ["privacy_consents", "consent_data_release_child", "consent_data_release_single"];

export function printsConsentChoice(templateId: string | null | undefined): boolean {
  return CONSENT_CHOICE_TEMPLATES.includes(templateId ?? "");
}

export type ConsentEditorHandle = {
  /** Saves a change before the document is made: `false` keeps the dialog open (the error shows). */
  commit: () => Promise<boolean>;
};

/**
 * «Согласия» inside the generate / «Новая версия» dialogs of the Einverständniserklärung (owner
 * 2026-11-16): the channels and the trusted persons, prefilled with the patient's newest choice,
 * and how the client told GMED. «Сгенерировать документ» first saves the change (removals apply at
 * once, additions once the new version is signed), then the form prints it.
 */
export function PatientConsentEmbeddedEditor({ patientId, handle }: { patientId: string; handle: Ref<ConsentEditorHandle> }) {
  const { lang } = useLang();
  const text = consentText(lang);
  const formText = consentFormText(lang);
  const staffText = cabinetStaffText(lang === "de" ? "de" : "ru");
  const [state, setState] = useState<PatientConsentState | null>(null);
  const [draft, setDraft] = useState<PatientConsentDraft | null>(null);
  const [how, setHow] = useState<StaffConsentChannel | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    let active = true;
    setState(null);
    setDraft(null);
    fetchPatientConsentState(patientId, lang)
      .then((loaded) => { if (active) { setState(loaded); setDraft(consentDraftOf(loaded)); } })
      .catch(() => { if (active) setState(null); });
    return () => { active = false; };
  }, [patientId, lang]);

  const changed = Boolean(state && draft && draftChanged(draft, state));
  const sent = state && draft ? changeToSend(draft, state, lang) : null;
  const needsConsent = Boolean(state && sent && sent.recipients.length > 0 && !onlyWithdraws(sent.choices, sent.recipients, state));

  useImperativeHandle(handle, () => ({
    commit: async () => {
      if (!state || !draft || !changed) return true;
      setShowErrors(true);
      if (trustedPersonsProblem(draft.persons)) return false;
      if (needsConsent && !draft.consentGiven) {
        setError(text.consentRequired);
        return false;
      }
      if (!how) {
        setError(staffText.recordFirst);
        return false;
      }
      try {
        const saved = await savePatientConsentChange(patientId, changeToSend(draft, state, lang, { how, note }));
        setState(saved);
        setDraft(consentDraftOf(saved));
        setError("");
        return true;
      } catch (cause) {
        const code = cause instanceof ApiRequestError
          ? ((cause.body as { code?: string } | null | undefined)?.code ?? cause.code)
          : undefined;
        setError(code === "consent_core_required" ? text.coreRequired
          : code === "disclosure_consent_required" ? text.consentRequired
          : code === "nothing_changed" ? text.nothingChanged
          : text.failed);
        return false;
      }
    },
  }), [state, draft, changed, needsConsent, how, note, patientId, lang, text, staffText.recordFirst]);

  if (!state || !draft || !state.can_edit) return null;
  const toggle = (key: keyof ConsentFormChoices) => setDraft((current) => current && ({ ...current, choices: { ...current.choices, [key]: !current.choices[key] } }));
  const channels = CONSENT_FORM_CHANNELS.filter((key) => key !== "channel_threema" || state.requested?.choices.channel_threema);
  return (
    <section className="space-y-3 rounded-lg border border-border/60 bg-card p-4 text-sm" data-testid="generate-consent-editor">
      <h3 className="text-[13px] font-semibold">{text.title}</h3>
      <fieldset className="space-y-1.5">
        <legend className="mb-1 font-mono text-xs font-medium text-foreground/80">{text.channels}</legend>
        {channels.map((key) => (
          <label key={key} className="flex items-center gap-2">
            <input type="checkbox" className={checkboxClass} checked={draft.choices[key]} onChange={() => toggle(key)} data-testid={`generate-consent-${key}`} />
            <span>{formText.options[key]}</span>
          </label>
        ))}
      </fieldset>
      <div className="space-y-2">
        <span className="font-mono text-xs font-medium text-foreground/80">{text.persons}</span>
        <TrustedPersonsEditor persons={draft.persons} lang={lang} showErrors={showErrors}
          onChange={(persons) => setDraft((current) => current && ({ ...current, persons }))} />
      </div>
      {needsConsent ? (
        <label className="flex items-start gap-2">
          <input type="checkbox" className={cn(checkboxClass, "mt-0.5 shrink-0")} checked={draft.consentGiven}
            onChange={() => setDraft((current) => current && ({ ...current, consentGiven: !current.consentGiven }))} data-testid="generate-consent-given" />
          <span><span className="font-medium">{text.consent}:</span> {state.disclosure_text}</span>
        </label>
      ) : null}
      {changed ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="font-mono font-medium text-foreground/80">{text.howLabel}</span>
            <select className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm" value={how}
              onChange={(event) => setHow(event.target.value as StaffConsentChannel | "")} data-testid="generate-consent-how">
              <option value="">—</option>
              {STAFF_CONSENT_CHANNELS.map((channel) => <option key={channel} value={channel}>{staffText.channels[channel]}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-mono font-medium text-foreground/80">{staffText.consentNote}</span>
            <input className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm" maxLength={STAFF_CONSENT_NOTE_MAX}
              value={note} onChange={(event) => setNote(event.target.value)} data-testid="generate-consent-note" />
          </label>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-destructive" data-testid="generate-consent-error">{error}</p> : null}
    </section>
  );
}
