import { useEffect, useImperativeHandle, useState, type Ref } from "react";
import { ShieldCheck } from "lucide-react";

import { checkboxClass } from "@/components/record-workspace/primitives/design-tokens";
import { ApiRequestError } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { CONSENT_FORM_CHANNELS, type ConsentFormChoices, type StaffConsentChannel } from "@/pages/patient-lead/lead-request-api";
import { consentFormText } from "@/pages/patient-lead/lead-request-consent-form-text";
import { TrustedPersonsEditor } from "@/pages/patient-lead/lead-trusted-persons-editor";
import { trustedPersonsProblem } from "@/pages/patient-lead/lead-trusted-persons-model";
import { fetchPatientConsentState, savePatientConsentChange, type PatientConsentState } from "../../data/patient-consent-choices-api";
import { changeToSend, consentDraftOf, draftChanged, onlyWithdraws, type PatientConsentDraft } from "../../model/patient-consent-choices";
import { consentText } from "./patient-consent-choices";
import { ConsentCard, ConsentRecordFields, focusConsentRecordHow } from "./patient-consent-parts";

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
  const [state, setState] = useState<PatientConsentState | null>(null);
  const [draft, setDraft] = useState<PatientConsentDraft | null>(null);
  const [how, setHow] = useState<StaffConsentChannel | "">("");
  const [note, setNote] = useState("");
  const [howMissing, setHowMissing] = useState(false);
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
      if (!how) setHowMissing(true);
      if (trustedPersonsProblem(draft.persons)) return false;
      if (needsConsent && !draft.consentGiven) {
        setError(text.consentRequired);
        return false;
      }
      if (!how) {
        setError("");
        focusConsentRecordHow("generate-consent");
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
  }), [state, draft, changed, needsConsent, how, note, patientId, lang, text]);

  if (!state || !draft || !state.can_edit) return null;
  const toggle = (key: keyof ConsentFormChoices) => setDraft((current) => current && ({ ...current, choices: { ...current.choices, [key]: !current.choices[key] } }));
  const channels = CONSENT_FORM_CHANNELS.filter((key) => key !== "channel_threema" || state.requested?.choices.channel_threema);
  return (
    <ConsentCard icon={ShieldCheck} title={text.title} testId="generate-consent-editor">
      <fieldset className="min-w-0 space-y-1.5">
        <legend className="mb-1.5 font-mono text-xs font-medium text-foreground/75">{text.channels}</legend>
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {channels.map((key) => (
            <label key={key} className="flex min-w-0 items-center gap-2">
              <input type="checkbox" className={checkboxClass} checked={draft.choices[key]} onChange={() => toggle(key)} data-testid={`generate-consent-${key}`} />
              <span>{formText.options[key]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1.5 border-t border-border/60 pt-3">
        <span className="block font-mono text-xs font-medium text-foreground/75">{text.persons}</span>
        <TrustedPersonsEditor persons={draft.persons} lang={lang} showErrors={showErrors} variant="staff"
          onChange={(persons) => setDraft((current) => current && ({ ...current, persons }))} />
      </div>
      {needsConsent ? (
        <label className="flex items-start gap-2 border-t border-border/60 pt-3">
          <input type="checkbox" className={cn(checkboxClass, "mt-0.5 shrink-0")} checked={draft.consentGiven}
            onChange={() => setDraft((current) => current && ({ ...current, consentGiven: !current.consentGiven }))} data-testid="generate-consent-given" />
          <span><span className="font-medium">{text.consent}:</span> {state.disclosure_text}</span>
        </label>
      ) : null}
      {changed ? (
        <div className="border-t border-border/60 pt-3">
          <ConsentRecordFields lang={lang} testId="generate-consent" howLabel={text.howLabel} how={how} note={note} missing={howMissing}
            onHow={(value) => { setHow(value); if (value) setHowMissing(false); }} onNote={setNote} />
        </div>
      ) : null}
      {error ? <p role="alert" className="text-destructive" data-testid="generate-consent-error">{error}</p> : null}
    </ConsentCard>
  );
}
