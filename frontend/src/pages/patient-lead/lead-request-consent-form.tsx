import { useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { checkboxClass } from "@/components/record-workspace/primitives/design-tokens";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import {
  CONSENT_CHOICE_BY_GUARDIAN,
  CONSENT_FORM_CHANNELS,
  CONSENT_FORM_CORE,
  CONSENT_FORM_OPTIONS,
  CONSENT_RECIPIENTS_INVALID,
  CONSENT_RECIPIENTS_REQUIRED,
  NO_CONSENT_FORM_CHOICES,
  hasCoreConsents,
  saveLeadConsentFormChoicesAndRefresh,
  type ConsentFormChoices,
  type LeadRequest,
} from "./lead-request-api";
import { consentFormText } from "./lead-request-consent-form-text";
import { CabinetSection as Section, errorBody, errorMessage, type RequestQueue } from "./lead-request-parts";

import { recipientDrafts, recipientsToSend, storedTrustedPersons, trustedPersonsPath, trustedPersonsProblem, type RecipientDraft } from "./lead-trusted-persons-model";
import { TrustedPersonsList } from "./lead-trusted-persons-editor";
import { trustedPersonsText } from "./lead-trusted-persons-text";

export function recipientsProblem(choices: ConsentFormChoices, drafts: readonly RecipientDraft[]): "required" | "invalid" | null {
  if (!choices.named_recipients) return null;
  return trustedPersonsProblem(drafts) ?? (recipientsToSend(drafts).length === 0 ? "required" : null);
}

/** Whether the draft differs from what is saved (nothing saved counts as "all unticked"). */
export function consentFormChanged(
  draft: ConsentFormChoices,
  saved: ConsentFormChoices | null | undefined,
): boolean {
  const base = saved ?? NO_CONSENT_FORM_CHOICES;
  return (Object.keys(NO_CONSENT_FORM_CHOICES) as (keyof ConsentFormChoices)[]).some(
    (key) => draft[key] !== base[key],
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
 * once the person saves it (an active choice), and every save is kept. The generated form ticks
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
}: {
  request: LeadRequest;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
}) {
  const form = request.consent_form;
  const text = consentFormText(lang, choosesForChild(request));
  const [draft, setDraft] = useState<ConsentFormChoices>(form?.choices ?? NO_CONSENT_FORM_CHOICES);
  const recipients = storedTrustedPersons(request);
  const personsText = trustedPersonsText(lang);
  const [baseline, setBaseline] = useState(form);
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
  const problem = recipientsProblem(draft, recipientDrafts(recipients));

  async function save() {
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      const saved = await enqueue(() =>
        saveLeadConsentFormChoicesAndRefresh(request.lead_id, draft, form.version, lang, []),
      );
      onChange(saved);
      setDraft(saved.consent_form?.choices ?? draft);
      setBaseline(saved.consent_form);
    } catch (cause) {
      const code = errorBody(cause)?.code;
      setError(
        code === "consent_core_required"
          ? text.coreRequired
          : code === CONSENT_CHOICE_BY_GUARDIAN
            ? text.byGuardianOnly
            : code === CONSENT_RECIPIENTS_REQUIRED
              ? text.recipientsRequired
              : code === CONSENT_RECIPIENTS_INVALID
                ? text.recipientsInvalid
                : errorMessage(cause),
      );
    } finally {
      setBusy(false);
    }
  }

  const recipientsBlock = draft.named_recipients ? (
    <fieldset className="space-y-3 rounded-lg border border-border/60 p-3 sm:ml-7" data-testid="lead-request-consent-recipients">
      <legend className="px-1 text-sm font-medium">{personsText.title}</legend>
      {recipients.length > 0 ? <TrustedPersonsList persons={recipients} lang={lang} /> : null}
      {problem ? <p className="text-xs text-amber-800 dark:text-amber-300" role="status" data-testid="lead-request-consent-recipients-problem">
        {problem === "required" ? personsText.required : personsText.invalid}
      </p> : null}
      <a className="text-sm font-medium text-[var(--brand)] underline underline-offset-4" href={trustedPersonsPath(request.lead_id)}>{personsText.edit}</a>
    </fieldset>
  ) : null;

  const option = (key: keyof ConsentFormChoices) => (
    <label key={key} className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        className={cn(checkboxClass, "mt-0.5")}
        checked={draft[key]}
        disabled={busy}
        data-consent-option={key}
        onChange={(event) => {
          const checked = event.currentTarget.checked;
          setDraft((current) => ({ ...current, [key]: checked }));
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
          <div className="space-y-2">{CONSENT_FORM_OPTIONS.map(option)}</div>
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
            <Button
              type="button"
              variant="outline"
              disabled={busy || !coreTicked || problem !== null || (!changed && Boolean(form.choices) && form.chosen_by_me !== false)}
              onClick={() => void save()}
              data-testid="lead-request-consent-form-save"
            >
              {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
              {busy ? text.saving : text.save}
            </Button>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {changed && form.choices
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
