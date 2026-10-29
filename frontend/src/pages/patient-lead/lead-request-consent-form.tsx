import { useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useCabinetStaffMode } from "./lead-request-staff-mode";

import { checkboxClass } from "@/components/record-workspace/primitives/design-tokens";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import {
  CONSENT_CHOICE_BY_GUARDIAN,
  CONSENT_FORM_CHANNELS,
  CONSENT_FORM_CORE,
  CONSENT_RECIPIENTS_INVALID,
  CONSENT_RECIPIENTS_REQUIRED,
  NO_CONSENT_FORM_CHOICES,
  hasCoreConsents,
  saveLeadConsentFormChoicesAndRefresh,
  type ConsentFormChoices,
  type LeadRequest,
} from "./lead-request-api";
import { consentFormText } from "./lead-request-consent-form-text";
import { leadRequestText } from "./lead-request-text";
import { CabinetGoToContext, CabinetSection as Section, InfoNote, RequiredMark, errorBody, errorMessage, useAutosave, type RequestQueue } from "./lead-request-parts";
import type { SaveState } from "./lead-request-model";

import { disclosureDefaultsToNo, storedTrustedPersons, trustedPersonsPath } from "./lead-trusted-persons-model";
import { trustedPersonsText } from "./lead-trusted-persons-text";

export function savedDisclosureAllowed(request: Pick<LeadRequest, "disclosure" | "consent_form">): boolean {
  // Unrelated consent edits preserve a historical choice; only the disclosure step grants a new one.
  return request.disclosure ? request.disclosure.allow_disclosure && request.disclosure.consent_given : request.consent_form?.choices?.named_recipients === true;
}

/** Whether the draft differs from what is saved (nothing saved counts as "all unticked"). */
export function consentFormChanged(
  draft: ConsentFormChoices,
  saved: ConsentFormChoices | null | undefined,
): boolean {
  const base = saved ?? NO_CONSENT_FORM_CHOICES;
  return (Object.keys(NO_CONSENT_FORM_CHOICES) as (keyof ConsentFormChoices)[]).some(
    (key) => key !== "named_recipients" && draft[key] !== base[key],
  );
}

/** A parent or guardian chooses for a minor: the texts speak of the child's data (QA 2026-10-12, A2-06). */
export function choosesForChild(request: Pick<LeadRequest, "access_kind" | "minor">): boolean {
  return request.access_kind === "guardian" && request.minor === true;
}

/**
 * The lead's own login of a minor chooses nothing: only a parent's or the guardian's choice counts
 * for the child's form (QA 2026-10-12, A3-01; the server answers 409 `consent_choice_by_guardian`).
 */
export function choiceOnlyByGuardian(request: Pick<LeadRequest, "access_kind" | "minor">): boolean {
  return request.access_kind === "self" && request.minor === true;
}

/**
 * The person's own choice of the options of the consent form «Einverständniserklärung zur
 * Datenübermittlung» (Anlage 1), 2026-10-12. Nothing is ticked in advance; the choice counts only
 * after the person's checkbox changes are saved automatically, and every save is kept. The generated form ticks
 * only what was chosen here; without a saved choice GMED sends the form for a paper signature.
 *
 * The three consents the service runs on are part of every saved choice (QA 2026-10-12, A2-02):
 * an empty or partial "choice" is no consent, so "save" waits for them. A parent of a minor
 * chooses for the child; the child's form names the parent who chose.
 */
/** The sent state of the options (owner 2026-10-26). */
export function sentConsentText(lang: string): string {
  switch (lang) {
    case "de": return "Ihre Anfrage ist gesendet. Ändern oder widerrufen können Sie Ihre Einwilligung jederzeit über Ihren Kontakt bei GMED.";
    case "uk": return "Заявку надіслано. Змінити або відкликати згоду можна будь-коли через ваш контакт у GMED.";
    case "en": return "Your request has been sent. You can change or withdraw your consent at any time through your contact at GMED.";
    default: return "Заявка отправлена. Изменить или отозвать согласие можно в любое время через вашего контакта в GMED.";
  }
}

export function ConsentFormChoicesSection({
  request,
  lang,
  enqueue,
  onChange,
  onSaveState,
}: {
  request: LeadRequest;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onSaveState?: (state: SaveState) => void;
}) {
  const form = request.consent_form;
  const forChild = choosesForChild(request);
  const text = useMemo(() => consentFormText(lang, forChild), [lang, forChild]);
  const [draft, setDraft] = useState<ConsentFormChoices>(form?.choices ?? NO_CONSENT_FORM_CHOICES);
  const recipients = storedTrustedPersons(request);
  const personsText = trustedPersonsText(lang);
  const goTo = useContext(CabinetGoToContext);
  const [baseline, setBaseline] = useState(form);
  const savedRef = useRef(form);
  useLayoutEffect(() => { savedRef.current = form; }, [form]);
  // A server refresh may carry the other parent's choice. Adopt it only when
  // this tab has no local edits, comparing against the previous server value.
  if (form?.chosen_at !== baseline?.chosen_at) {
    const locallyChanged = consentFormChanged(draft, baseline?.choices ?? null);
    setBaseline(form);
    if (!locallyChanged) {
      setDraft(form?.choices ?? NO_CONSENT_FORM_CHOICES);
    }
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A sent request is read-only (owner 2026-10-26: «якщо вже відправили то вже
  // відправили»): changes and withdrawals go through the contact at GMED.
  // Staff filling in the form read the client's options only (owner 2026-10-29).
  const staffMode = useCabinetStaffMode();
  const sent = Boolean(request.submitted_at) || staffMode;
  const ownMinor = choiceOnlyByGuardian(request);
  const namedRecipients = savedDisclosureAllowed(request);
  const version = form?.version;
  const save = useCallback(async (snapshot: ConsentFormChoices): Promise<boolean> => {
    if (!version || ownMinor) return true;
    return enqueue(async () => {
      // Recheck inside the shared queue: a timer and Next can flush the same choice.
      if (!consentFormChanged(snapshot, savedRef.current?.choices)) return true;
      if (!hasCoreConsents(snapshot)) {
        onSaveState?.("idle");
        return false;
      }
      setBusy(true);
      setError("");
      onSaveState?.("saving");
      try {
        const saved = await saveLeadConsentFormChoicesAndRefresh(
          request.lead_id, { ...snapshot, named_recipients: namedRecipients }, version, lang, [],
        );
        savedRef.current = saved.consent_form;
        setBaseline(saved.consent_form);
        // Keep any choices made while this request was being saved.
        setDraft((current) => consentFormChanged(current, snapshot) ? current : saved.consent_form?.choices ?? snapshot);
        onChange(saved);
        onSaveState?.("saved");
        return true;
      } catch (cause) {
        const code = errorBody(cause)?.code;
        setError(code === "disclosure_choice_changed" ? personsText.outdated
          : code === "consent_core_required" ? text.coreRequired
          : code === CONSENT_CHOICE_BY_GUARDIAN ? text.byGuardianOnly
          : code === CONSENT_RECIPIENTS_REQUIRED ? text.recipientsRequired
          : code === CONSENT_RECIPIENTS_INVALID ? text.recipientsInvalid
          : errorMessage(cause, leadRequestText(lang)));
        onSaveState?.("error");
        return false;
      } finally {
        setBusy(false);
      }
    });
  }, [version, ownMinor, enqueue, request.lead_id, namedRecipients, lang, onChange, onSaveState, personsText.outdated, text]);
  useAutosave(draft, save);
  if (!form) return null;
  if (choiceOnlyByGuardian(request)) {
    return (
      <div data-testid="lead-request-consent-form">
        <Section title={text.title}>
          <p className="text-sm text-muted-foreground" data-testid="lead-request-consent-form-by-guardian">
            {text.byGuardianOnly}
          </p>
        </Section>
      </div>
    );
  }
  const changed = consentFormChanged(draft, form.choices);
  const coreTicked = hasCoreConsents(draft);

  // The step-4 answer as one line with a jump back, not repeated as a block (owner 2026-10-26, C3).
  // Not answered counts as "no" (owner decision 2026-10-22). The printed form is unchanged.
  const disclosureAnswer = !request.disclosure && !disclosureDefaultsToNo(request) ? text.disclosureUnanswered
    : savedDisclosureAllowed(request) ? text.disclosureYes(recipients.length) : text.disclosureNo;
  const recipientsBlock = (
    <div className="space-y-1" data-testid="lead-request-consent-recipients">
      <p className="text-sm">
        <span data-testid="disclosure-saved-status">{text.disclosureLabel}: {disclosureAnswer}</span>
        {sent ? null : <span aria-hidden="true" className="text-muted-foreground"> · </span>}
        {/* Inside the cabinet the step opens in place (the choices here are saved first), not by a page load. */}
        {sent ? null : <a
          className="font-medium text-[var(--brand)] underline underline-offset-4"
          href={trustedPersonsPath(request.lead_id)}
          aria-label={personsText.edit}
          data-testid="lead-request-consent-recipients-edit"
          onClick={(event) => {
            if (!goTo || event.metaKey || event.ctrlKey || event.shiftKey) return;
            event.preventDefault();
            goTo("disclosure");
          }}
        >
          {text.disclosureChange}
        </a>}
      </p>
      {!request.disclosure && form.choices?.named_recipients ? <p className="text-xs text-muted-foreground">{personsText.legacy}</p> : null}
    </div>
  );

  const option = (key: keyof ConsentFormChoices) => (
    <label key={key} className="flex cursor-pointer items-start gap-3 rounded-lg bg-card py-2 text-sm transition-colors hover:bg-muted/30 focus-within:ring-2 focus-within:ring-ring">
      <input
        type="checkbox"
        // Named by the visible text, never by the raw value «on» (labels audit 2026-10-26, S1).
        aria-label={text.options[key]}
        aria-required={CONSENT_FORM_CORE.includes(key) || undefined}
        className={cn(checkboxClass, "mt-0.5")}
        checked={draft[key]}
        disabled={sent}
        data-consent-option={key}
        onChange={(event) => {
          const checked = event.currentTarget.checked;
          setDraft((current) => ({ ...current, [key]: checked }));
          setError("");
          onSaveState?.("idle");
        }}
      />
      <span className="leading-relaxed">
        {text.options[key]}
        {/* The same `*` as every other required field, not a word chip (labels audit 2026-10-26, B8). */}
        {CONSENT_FORM_CORE.includes(key) ? (
          <span data-consent-required="">
            <RequiredMark />
            <span className="sr-only"> ({text.required})</span>
          </span>
        ) : null}
      </span>
    </label>
  );

  return (
    <div data-testid="lead-request-consent-form">
      <Section title={text.title}>
        <div className="space-y-3">
          <InfoNote>{text.intro}</InfoNote>
          <div className="space-y-2">{CONSENT_FORM_CORE.map(option)}</div>
          {recipientsBlock}
          <fieldset className="space-y-2">
            <legend className="mb-2 font-mono text-xs font-medium text-foreground/75">{text.channelsTitle}</legend>
            <div className="grid gap-2 sm:grid-cols-2">{CONSENT_FORM_CHANNELS.filter((key) => key !== "channel_threema").map(option)}</div>
            <p className="text-xs leading-5 text-foreground/75">{text.channelsRisk}</p>
          </fieldset>
          {sent ? (
            <div className="flex flex-wrap items-center gap-3" data-testid="lead-request-consent-form-sent">
              <p className="text-xs text-muted-foreground">{sentConsentText(lang)}</p>
            </div>
          ) : null}
          {!coreTicked ? (
            <p className="text-xs text-muted-foreground" data-testid="lead-request-consent-form-core-hint">
              {text.coreHint}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
            {/* The step's save indicator covers the own choice; only the other parent's choice is named (B8). */}
            <p className="text-xs text-muted-foreground" aria-live="polite" data-testid="lead-request-consent-form-state">
              {busy ? text.saving : changed
                ? text.unsaved
                : form.chosen_at && form.chosen_by_me === false
                  ? text.savedByOtherAt(formatAppDateTime(form.chosen_at))
                  : ""}
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
