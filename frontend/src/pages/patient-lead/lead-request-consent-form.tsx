import { useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

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
import { CabinetGoToContext, CabinetSection as Section, errorBody, errorMessage, useAutosave, type RequestQueue } from "./lead-request-parts";
import type { SaveState } from "./lead-request-model";

import { storedTrustedPersons, trustedPersonsPath } from "./lead-trusted-persons-model";
import { TrustedPersonsList } from "./lead-trusted-persons-editor";
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
          : errorMessage(cause));
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

  const recipientsBlock = (
    <fieldset className="space-y-3 rounded-lg border border-border/60 p-3" data-testid="lead-request-consent-recipients">
      <legend className="px-1 text-sm font-medium">{personsText.title}</legend>
      <span className={cn("inline-flex rounded-full border px-3 py-1 text-xs", request.disclosure?.allow_disclosure && request.disclosure.consent_given ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        // "No" is a valid, optional answer: neutral, never a warning.
        : request.disclosure?.allow_disclosure === false ? "border-border bg-muted/40 text-muted-foreground" : "border-amber-200 bg-amber-50 text-amber-800")} data-testid="disclosure-saved-status">
        {!request.disclosure ? personsText.unanswered : savedDisclosureAllowed(request) ? personsText.allowed : personsText.denied}
      </span>
      {recipients.length > 0 ? <TrustedPersonsList persons={recipients} lang={lang} /> : null}
      {!request.disclosure && form.choices?.named_recipients ? <p className="text-xs text-muted-foreground">{personsText.legacy}</p> : null}
      {/* Inside the cabinet the step opens in place (the choices here are saved first), not by a page load. */}
      <a
        className="block w-fit text-sm font-medium text-[var(--brand)] underline underline-offset-4"
        href={trustedPersonsPath(request.lead_id)}
        data-testid="lead-request-consent-recipients-edit"
        onClick={(event) => {
          if (!goTo || event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          goTo("disclosure");
        }}
      >
        {personsText.edit}
      </a>
    </fieldset>
  );

  const option = (key: keyof ConsentFormChoices) => (
    <label key={key} className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        className={cn(checkboxClass, "mt-0.5")}
        checked={draft[key]}
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
        {CONSENT_FORM_CORE.includes(key) ? (
          <span className="ml-1 text-xs text-muted-foreground" data-consent-required="">
            ({text.required})
          </span>
        ) : null}
      </span>
    </label>
  );

  return (
    <div data-testid="lead-request-consent-form">
      <Section title={text.title}>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{text.intro}</p>
          <div className="space-y-2">{CONSENT_FORM_CORE.map(option)}</div>
          {recipientsBlock}
          <fieldset className="space-y-2">
            <legend className="text-sm">{text.channelsTitle}</legend>
            <div className="grid gap-2 pl-7 sm:grid-cols-2">{CONSENT_FORM_CHANNELS.map(option)}</div>
            <p className="pl-7 text-xs text-muted-foreground">{text.channelsRisk}</p>
          </fieldset>
          {!coreTicked ? (
            <p className="text-xs text-muted-foreground" data-testid="lead-request-consent-form-core-hint">
              {text.coreHint}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
            <p className="text-xs text-muted-foreground" aria-live="polite" data-testid="lead-request-consent-form-state">
              {busy ? text.saving : changed
                ? text.unsaved
                : form.chosen_at
                  ? form.chosen_by_me === false
                    ? text.savedByOtherAt(formatAppDateTime(form.chosen_at))
                    : text.savedAt(formatAppDateTime(form.chosen_at))
                  : text.notSaved}
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
