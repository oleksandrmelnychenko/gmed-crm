import { useState } from "react";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { checkboxClass, inputClass, selectClass } from "@/components/record-workspace/primitives/design-tokens";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import {
  CONSENT_CHOICE_BY_GUARDIAN,
  CONSENT_FORM_CHANNELS,
  CONSENT_FORM_CORE,
  CONSENT_FORM_OPTIONS,
  CONSENT_RECIPIENTS_INVALID,
  CONSENT_RECIPIENTS_REQUIRED,
  CONSENT_RECIPIENT_RELATIONS,
  MAX_CONSENT_RECIPIENTS,
  NO_CONSENT_FORM_CHOICES,
  hasCoreConsents,
  saveLeadConsentFormChoices,
  type ConsentFormChoices,
  type ConsentRecipient,
  type ConsentRecipientRelation,
  type LeadRequest,
} from "./lead-request-api";
import { consentFormText } from "./lead-request-consent-form-text";
import { CabinetSection as Section, errorBody, errorMessage, type RequestQueue } from "./lead-request-parts";

/** A recipient as it is typed; `relation` is "" until chosen. */
export type RecipientDraft = { name: string; relation: ConsentRecipientRelation | ""; contact: string };

export function recipientDrafts(saved: readonly ConsentRecipient[] | undefined): RecipientDraft[] {
  return (saved ?? []).map((recipient) => ({
    name: recipient.name,
    relation: recipient.relation,
    contact: recipient.contact ?? "",
  }));
}

/** The recipients as they are sent: trimmed, rows left fully empty dropped. */
export function recipientsToSend(drafts: readonly RecipientDraft[]): ConsentRecipient[] {
  return drafts
    .map((draft) => ({ name: draft.name.trim().replace(/\s+/g, " "), relation: draft.relation, contact: draft.contact.trim() }))
    .filter((draft) => draft.name || draft.relation || draft.contact)
    .map((draft) => ({
      name: draft.name,
      relation: (draft.relation || "other") as ConsentRecipientRelation,
      contact: draft.contact || null,
    }));
}

/**
 * Whether the named recipients can be saved: with "named recipients" ticked at least one, and
 * every row typed has a name and says who it is (the server checks the same, owner 2026-10-12).
 * Without that option nobody is sent (no third party's data without the consent to pass it on).
 */
export function recipientsProblem(
  choices: ConsentFormChoices,
  drafts: readonly RecipientDraft[],
): "required" | "invalid" | null {
  if (!choices.named_recipients) return null;
  const typed = drafts.filter((draft) => draft.name.trim() || draft.relation || draft.contact.trim());
  if (typed.length > MAX_CONSENT_RECIPIENTS) return "invalid";
  if (typed.some((draft) => !draft.name.trim() || !draft.relation || draft.name.trim().length > 120 || draft.contact.trim().length > 120)) {
    return "invalid";
  }
  if (choices.named_recipients && typed.length === 0) return "required";
  return null;
}

function sameRecipients(left: readonly ConsentRecipient[], right: readonly ConsentRecipient[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (recipient, index) =>
        recipient.name === right[index].name &&
        recipient.relation === right[index].relation &&
        (recipient.contact ?? null) === (right[index].contact ?? null),
    )
  );
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
  const [recipients, setRecipients] = useState<RecipientDraft[]>(() => recipientDrafts(form?.recipients));
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
  const toSend = draft.named_recipients ? recipientsToSend(recipients) : [];
  const changed = consentFormChanged(draft, form.choices) || !sameRecipients(toSend, form.recipients ?? []);
  const coreTicked = hasCoreConsents(draft);
  const problem = recipientsProblem(draft, recipients);

  async function save() {
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      const saved = await enqueue(() =>
        saveLeadConsentFormChoices(request.lead_id, draft, form.version, lang, toSend),
      );
      onChange({ ...request, consent_form: saved });
      setDraft(saved.choices ?? draft);
      setRecipients(recipientDrafts(saved.recipients ?? toSend));
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

  const setRecipient = (index: number, patch: Partial<RecipientDraft>) =>
    setRecipients((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)));

  const recipientsBlock = draft.named_recipients ? (
    <fieldset className="space-y-3 rounded-lg border border-border/60 p-3 sm:ml-7" data-testid="lead-request-consent-recipients">
      <legend className="px-1 text-sm font-medium">{text.recipientsTitle}</legend>
      <p className="text-xs text-muted-foreground">{text.recipientsHint}</p>
      {recipients.map((row, index) => (
        <div
          key={index}
          className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
          data-testid="lead-request-consent-recipient"
        >
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">{text.recipientName}</span>
            <Input
              className={inputClass}
              value={row.name}
              maxLength={120}
              disabled={busy}
              autoComplete="off"
              onChange={(event) => setRecipient(index, { name: event.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">{text.recipientRelation}</span>
            <NativeComboboxSelect
              className={selectClass}
              value={row.relation}
              disabled={busy}
              onChange={(event) => setRecipient(index, { relation: event.target.value as ConsentRecipientRelation | "" })}
            >
              <option value="">—</option>
              {CONSENT_RECIPIENT_RELATIONS.map((relation) => (
                <option key={relation} value={relation}>
                  {text.recipientRelations[relation]}
                </option>
              ))}
            </NativeComboboxSelect>
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">{text.recipientContact}</span>
            <Input
              className={inputClass}
              value={row.contact}
              maxLength={120}
              disabled={busy}
              autoComplete="off"
              onChange={(event) => setRecipient(index, { contact: event.target.value })}
            />
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={text.removeRecipient}
            title={text.removeRecipient}
            onClick={() => setRecipients((current) => current.filter((_, at) => at !== index))}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        </div>
      ))}
      {recipients.length < MAX_CONSENT_RECIPIENTS ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          data-testid="lead-request-consent-recipient-add"
          onClick={() => setRecipients((current) => [...current, { name: "", relation: "", contact: "" }])}
        >
          <Plus aria-hidden="true" className="size-4" />
          {text.addRecipient}
        </Button>
      ) : null}
      {problem ? (
        <p className="text-xs text-amber-800 dark:text-amber-300" role="status" data-testid="lead-request-consent-recipients-problem">
          {problem === "required" ? text.recipientsRequired : text.recipientsInvalid}
        </p>
      ) : null}
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
          // Ticking "named recipients" opens the first row to fill in.
          if (key === "named_recipients" && checked) {
            setRecipients((current) => (current.length > 0 ? current : [{ name: "", relation: "", contact: "" }]));
          }
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
              disabled={busy || !coreTicked || problem !== null || (!changed && Boolean(form.choices))}
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
