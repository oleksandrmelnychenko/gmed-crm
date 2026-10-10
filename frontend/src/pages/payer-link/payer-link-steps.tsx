import { useState } from "react";

import { CitizenshipMultiSelect } from "@/components/ui/citizenship-multi-select";
import { checkboxClass, tokens } from "@/components/record-workspace/primitives/design-tokens";
import { appDateKey, formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";
import { LEAD_CABINET_LANGS } from "@/pages/patient-lead/lead-request-text";

import type { PayerQuestionnaire } from "./payer-link-api";
import {
  ChoiceInput,
  CountryInput,
  DateInput,
  Field,
  SubHeading,
  TextArea,
  TextInput,
  fieldId,
  type StepContext,
  type UploadControl,
} from "./payer-link-fields";
import {
  CONTACT_CHANNELS,
  ID_DOCUMENT_TYPES,
  LEGAL_DETAILS,
  LEGAL_QUESTIONS,
  SALUTATIONS,
  isOrganisation,
  withContactChannel,
  withLegalAnswer,
} from "./payer-link-model";
import { RequiredMark, UploadBlock, YesNoSelect } from "./payer-link-parts";
import type { PayerLinkText } from "./payer-link-text";

// Steps 1–3 and 7 of the payer page (contract phase 3a, 5.1); steps 4–6 are
// in `payer-link-steps-funds.tsx`. Each step reads and changes one draft; the
// form saves what changed.

export type { AnswersForm, StepContext, UploadControl } from "./payer-link-fields";
export { FundsStep, OwnersStep, PaymentStep } from "./payer-link-steps-funds";

const LANGUAGE_NAMES = Object.fromEntries(LEAD_CABINET_LANGS.map((option) => [option.value, option.name])) as Record<string, string>;
const LANGUAGE_VALUES = LEAD_CABINET_LANGS.map((option) => option.value);

// ---------------------------------------------------------------------------
// 1 Privacy
// ---------------------------------------------------------------------------

/**
 * The notice for a person whose data came from somebody else (Art. 14
 * DSGVO), the acknowledgement and the contact channels. Nothing else can be
 * written before the acknowledgement.
 */
export function PrivacyStep({
  questionnaire,
  text,
  busy,
  error,
  onConsent,
}: {
  questionnaire: PayerQuestionnaire;
  text: PayerLinkText;
  busy: boolean;
  error: string | null;
  /** Records the acknowledgement with the channels; false when the server refused it. */
  onConsent: (channels: string[]) => Promise<boolean>;
}) {
  const acknowledgedAt = questionnaire.privacy?.acknowledged_at ?? null;
  const [channels, setChannels] = useState<string[]>(() => [...(questionnaire.privacy?.contact_channels ?? [])]);
  const [checked, setChecked] = useState(false);
  const acknowledged = Boolean(acknowledgedAt);

  return (
    <div className="space-y-5" data-testid="payer-link-step-privacy">
      <div className="space-y-2 text-sm leading-6 text-foreground" data-testid="payer-link-privacy-notice">
        {text.privacyNotice(questionnaire.patient_name).map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <a href="/legal#privacy" target="_blank" rel="noreferrer" className="inline-block text-sm text-[var(--brand)] underline">
          {text.privacyLink}
        </a>
      </div>

      <div role="group" aria-labelledby="payer-link-contact-label" data-testid="payer-link-contact-channels">
        <p id="payer-link-contact-label" className={tokens.text.label}>
          {text.contactQuestion}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
          {CONTACT_CHANNELS.map((channel) => (
            <label key={channel} className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className={checkboxClass}
                checked={channels.includes(channel)}
                disabled={busy}
                onChange={(event) => {
                  const next = withContactChannel(channels, channel, event.target.checked);
                  setChannels(next);
                  // After the acknowledgement the channels are saved with it again.
                  if (acknowledged) void onConsent(next);
                }}
              />
              {text.contactChannels[channel]}
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/10 px-3 py-3" data-testid="payer-link-privacy-ack">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className={cn(checkboxClass, "mt-0.5")}
            checked={acknowledged || checked}
            disabled={acknowledged || busy}
            onChange={(event) => {
              const next = event.target.checked;
              setChecked(next);
              if (next) {
                void onConsent(channels).then((recorded) => {
                  if (!recorded) setChecked(false);
                });
              }
            }}
          />
          <span className="space-y-1">
            <span className="block leading-snug">
              {text.privacyAck}
              <RequiredMark />
            </span>
            {acknowledgedAt ? (
              <span className="block text-xs text-muted-foreground">{text.privacyAckedAt(formatAppDateTime(acknowledgedAt))}</span>
            ) : null}
          </span>
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2 Details
// ---------------------------------------------------------------------------

export function DetailsStep({ context, email }: { context: StepContext; email: string | null }) {
  const { form, text, lang } = context;
  const organisation = isOrganisation(context.payerType);
  const emailRow = (
    <div className="min-w-0 space-y-1.5">
      <p className={tokens.text.label}>{text.fields.email}</p>
      <p className="flex min-h-9 flex-wrap items-center gap-2 text-sm" data-testid="payer-link-email">
        <span className="min-w-0 break-all">{email ?? "—"}</span>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          {text.emailConfirmed}
        </span>
      </p>
    </div>
  );
  const languageSelect = (
    <Field context={context} field="language">
      <ChoiceInput context={context} field="language" options={LANGUAGE_VALUES} labels={LANGUAGE_NAMES} />
    </Field>
  );

  if (organisation) {
    return (
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="payer-link-step-details">
        <Field context={context} field="organisation_name" className={context.organisationExtras ? "sm:col-span-2" : "sm:col-span-2 lg:col-span-3"}>
          <TextInput context={context} field="organisation_name" maxLength={200} autoComplete="organization" />
        </Field>
        {/* Block E (trigger flow): the legal form, asked of a server that knows it. */}
        {context.organisationExtras ? (
          <Field context={context} field="legal_form">
            <TextInput context={context} field="legal_form" maxLength={100} />
          </Field>
        ) : null}
        <SubHeading>{text.seat}</SubHeading>
        <Field context={context} field="street" className="sm:col-span-2 lg:col-span-3">
          <TextInput context={context} field="street" maxLength={200} />
        </Field>
        <Field context={context} field="zip">
          <TextInput context={context} field="zip" maxLength={20} />
        </Field>
        <Field context={context} field="city">
          <TextInput context={context} field="city" maxLength={200} />
        </Field>
        <Field context={context} field="country">
          <CountryInput context={context} field="country" />
        </Field>
        <div className="hidden sm:block" />
        <Field context={context} field="register_court">
          <TextInput context={context} field="register_court" maxLength={200} />
        </Field>
        <Field context={context} field="register_number">
          <TextInput context={context} field="register_number" maxLength={60} />
        </Field>
        {context.organisationExtras ? (
          <Field context={context} field="vat_id">
            <TextInput context={context} field="vat_id" maxLength={20} />
          </Field>
        ) : null}
        <SubHeading>{text.representative}</SubHeading>
        <Field context={context} field="representative_first_name">
          <TextInput context={context} field="representative_first_name" maxLength={100} />
        </Field>
        <Field context={context} field="representative_last_name">
          <TextInput context={context} field="representative_last_name" maxLength={100} />
        </Field>
        <Field context={context} field="representative_role">
          <TextInput context={context} field="representative_role" maxLength={100} />
        </Field>
        <div className="hidden sm:block" />
        <Field context={context} field="phone">
          <TextInput context={context} field="phone" maxLength={200} type="tel" autoComplete="tel" />
        </Field>
        {languageSelect}
      </div>
    );
  }

  return (
    <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="payer-link-step-details">
      <Field context={context} field="salutation">
        <ChoiceInput context={context} field="salutation" options={SALUTATIONS} labels={text.salutations} />
      </Field>
      <div className="hidden sm:block" />
      <Field context={context} field="first_name">
        <TextInput context={context} field="first_name" maxLength={100} autoComplete="given-name" />
      </Field>
      <Field context={context} field="last_name">
        <TextInput context={context} field="last_name" maxLength={100} autoComplete="family-name" />
      </Field>
      <Field context={context} field="former_names" className="sm:col-span-2 lg:col-span-3">
        <TextInput context={context} field="former_names" maxLength={200} />
      </Field>
      <Field context={context} field="date_of_birth">
        <DateInput context={context} field="date_of_birth" max={appDateKey()} />
      </Field>
      <Field context={context} field="birth_place">
        <TextInput context={context} field="birth_place" maxLength={200} />
      </Field>
      <Field context={context} field="birth_country">
        <CountryInput context={context} field="birth_country" />
      </Field>
      <Field context={context} field="citizenships">
        <CitizenshipMultiSelect
          id={fieldId("citizenships")}
          value={form.draft.citizenships}
          lang={lang}
          placeholder={text.citizenshipsPlaceholder}
          invalid={Boolean(form.errorFor("citizenships"))}
          onChange={(next) => form.set("citizenships", next)}
        />
      </Field>
      <Field context={context} field="street" className="sm:col-span-2 lg:col-span-3">
        <TextInput context={context} field="street" maxLength={200} autoComplete="street-address" />
      </Field>
      <Field context={context} field="zip">
        <TextInput context={context} field="zip" maxLength={20} autoComplete="postal-code" />
      </Field>
      <Field context={context} field="city">
        <TextInput context={context} field="city" maxLength={200} autoComplete="address-level2" />
      </Field>
      <Field context={context} field="country">
        <CountryInput context={context} field="country" />
      </Field>
      <Field context={context} field="habitual_residence_country">
        <CountryInput context={context} field="habitual_residence_country" />
      </Field>
      {emailRow}
      <Field context={context} field="phone">
        <TextInput context={context} field="phone" maxLength={200} type="tel" autoComplete="tel" />
      </Field>
      {languageSelect}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3 Identity document
// ---------------------------------------------------------------------------

export function IdentityStep({ context, uploads }: { context: StepContext; uploads: UploadControl }) {
  const { text, lang } = context;
  const organisation = isOrganisation(context.payerType);
  return (
    <div className="space-y-5" data-testid="payer-link-step-identity">
      <p className="text-sm leading-6 text-muted-foreground">{organisation ? text.identityIntroOrganisation : text.identityIntro}</p>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field context={context} field="id_document_type">
          <ChoiceInput context={context} field="id_document_type" options={ID_DOCUMENT_TYPES} labels={text.idDocumentTypes} />
        </Field>
        <Field context={context} field="id_document_number">
          <TextInput context={context} field="id_document_number" maxLength={60} />
        </Field>
        <Field context={context} field="id_issuing_authority">
          <TextInput context={context} field="id_issuing_authority" maxLength={200} />
        </Field>
        <Field context={context} field="id_issuing_country">
          <CountryInput context={context} field="id_issuing_country" />
        </Field>
        <Field context={context} field="id_issued_on">
          <DateInput context={context} field="id_issued_on" max={appDateKey()} />
        </Field>
        {/* No lower bound: the server says when a document has expired, and the message says what to do. */}
        <Field context={context} field="id_valid_until">
          <DateInput context={context} field="id_valid_until" />
        </Field>
      </div>
      <UploadBlock
        id="payer-link-identity-files"
        label={text.identityFiles}
        required
        hint={text.uploadHint}
        buttonLabel={text.identityUploadButton}
        emptyText={text.noIdentityDocuments}
        documents={uploads.documents}
        busy={uploads.busy}
        errors={uploads.errors}
        disabled={false}
        text={text}
        lang={lang}
        testId="payer-link-identity-upload"
        onFiles={uploads.upload}
        onRemove={uploads.remove}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7 Declarations
// ---------------------------------------------------------------------------

export function DeclarationsStep({ context }: { context: StepContext }) {
  const { form, text } = context;
  // An organisation answers for the persons who represent or own it: that is said; a
  // private person's questions speak for themselves (no filler, QA 2026-10-10).
  return (
    <div className="space-y-5" data-testid="payer-link-step-declarations">
      {isOrganisation(context.payerType) ? (
        <p className="text-sm leading-6 text-muted-foreground">{text.declarationsIntroOrganisation}</p>
      ) : null}
      {LEGAL_QUESTIONS.map((question) => {
        const details = LEGAL_DETAILS[question];
        return (
          <div key={question} className="space-y-3" data-testid={`payer-link-legal-${question}`}>
            <Field context={context} field={question} question>
              <YesNoSelect
                id={fieldId(question)}
                className="sm:max-w-[calc(50%-0.5rem)]"
                value={form.draft[question]}
                text={text}
                invalid={Boolean(form.errorFor(question))}
                onChange={(answer) => form.update((draft) => withLegalAnswer(draft, question, answer))}
              />
            </Field>
            {/* The details exist only for a "yes". */}
            {form.draft[question] === "yes" ? (
              <Field context={context} field={details}>
                {details === "high_risk_country_code" ? (
                  <div className="sm:max-w-[calc(50%-0.5rem)]">
                    <CountryInput context={context} field={details} />
                  </div>
                ) : (
                  <TextArea context={context} field={details} />
                )}
              </Field>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
