import { useState } from "react";
import { CheckCircle2, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { countryLabel } from "@/components/ui/country-select";
import { checkboxClass } from "@/components/record-workspace/primitives/design-tokens";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";
import { LEAD_CABINET_LANGS } from "@/pages/patient-lead/lead-request-text";

import type { PayerDocument, PayerQuestionnaire, PayerType } from "./payer-link-api";
import {
  CONTACT_CHANNELS,
  FUNDS_SOURCES,
  LEGAL_DETAILS,
  LEGAL_QUESTIONS,
  draftFromQuestionnaire,
  isOrganisation,
  missingByStep,
  type PayerDraft,
  type PayerStep,
} from "./payer-link-model";
import { DocumentList, Notice } from "./payer-link-parts";
import { fieldLabel, missingLabel, stepTitle, type PayerLabelField, type PayerLinkText } from "./payer-link-text";

// Step 8 of the payer page: what is still missing, everything entered, the
// confirmation and "send"; afterwards the thanks with the same summary.

type Row = { label: string; value: string };

type Group = { step: PayerStep; rows: Row[]; documents?: { label: string; items: readonly PayerDocument[] } };

const LANGUAGE_NAMES = Object.fromEntries(LEAD_CABINET_LANGS.map((option) => [option.value, option.name])) as Record<string, string>;

function oneOf<Key extends string>(labels: Record<Key, string>, value: string): string {
  return (labels as Record<string, string>)[value] ?? value;
}

/** The entered answers grouped by step; empty answers are left out. */
function summaryGroups(questionnaire: PayerQuestionnaire, draft: PayerDraft, steps: readonly PayerStep[], text: PayerLinkText, lang: string): Group[] {
  const payerType: PayerType = questionnaire.payer_type;
  const organisation = isOrganisation(payerType);
  const label = (field: PayerLabelField) => fieldLabel(text, field, payerType);
  const country = (code: string) => countryLabel(code, lang) || code;
  const yesNo = (value: string) => (value === "yes" ? text.yesNo.yes : value === "no" ? text.yesNo.no : "");
  const row = (field: PayerLabelField, value: string, title = label(field)): Row | null => (value.trim() ? { label: title, value } : null);
  const rows = (...items: (Row | null)[]) => items.filter((item): item is Row => item !== null);

  const privacy: Row[] = rows(
    questionnaire.privacy?.acknowledged_at
      ? { label: text.privacyAck, value: text.privacyAckedAt(formatAppDateTime(questionnaire.privacy.acknowledged_at)) }
      : null,
    {
      label: text.contactQuestion,
      value:
        CONTACT_CHANNELS.filter((channel) => (questionnaire.privacy?.contact_channels ?? []).includes(channel))
          .map((channel) => text.contactChannels[channel])
          .join(", ") || text.notStated,
    },
  );

  const address = (prefix: (value: string) => string) =>
    rows(
      row("street", draft.street, prefix(label("street"))),
      row("zip", draft.zip, prefix(label("zip"))),
      row("city", draft.city, prefix(label("city"))),
      row("country", draft.country ? country(draft.country) : "", prefix(label("country"))),
    );

  const email = questionnaire.email ? { label: text.fields.email, value: `${questionnaire.email} (${text.emailConfirmed})` } : null;
  const details: Row[] = organisation
    ? rows(
        row("organisation_name", draft.organisation_name),
        ...address(text.seatLabel),
        row("register_court", draft.register_court),
        row("register_number", draft.register_number),
        row("representative_first_name", draft.representative_first_name, text.representativeLabel(label("representative_first_name"))),
        row("representative_last_name", draft.representative_last_name, text.representativeLabel(label("representative_last_name"))),
        row("representative_role", draft.representative_role, text.representativeLabel(label("representative_role"))),
        email,
        row("phone", draft.phone),
        row("language", LANGUAGE_NAMES[draft.language] ?? draft.language),
      )
    : rows(
        row("salutation", draft.salutation ? oneOf(text.salutations, draft.salutation) : ""),
        row("first_name", draft.first_name),
        row("last_name", draft.last_name),
        row("former_names", draft.former_names),
        row("date_of_birth", formatAppDate(draft.date_of_birth)),
        row("birth_place", draft.birth_place),
        row("birth_country", draft.birth_country ? country(draft.birth_country) : ""),
        row("citizenships", draft.citizenships.map(country).join(", ")),
        ...address((value) => value),
        row("habitual_residence_country", draft.habitual_residence_country ? country(draft.habitual_residence_country) : ""),
        email,
        row("phone", draft.phone),
        row("language", LANGUAGE_NAMES[draft.language] ?? draft.language),
      );

  const identity: Row[] = rows(
    row("id_document_type", draft.id_document_type ? oneOf(text.idDocumentTypes, draft.id_document_type) : ""),
    row("id_document_number", draft.id_document_number),
    row("id_issuing_authority", draft.id_issuing_authority),
    row("id_issuing_country", draft.id_issuing_country ? country(draft.id_issuing_country) : ""),
    row("id_issued_on", formatAppDate(draft.id_issued_on)),
    row("id_valid_until", formatAppDate(draft.id_valid_until)),
  );

  const owners: Row[] =
    draft.beneficial_owners_none === "yes"
      ? [{ label: text.fields.beneficial_owners, value: text.fields.beneficial_owners_none }]
      : draft.beneficial_owners.map((owner, index) => ({
          label: text.ownerHeading(index + 1),
          value: [
            [owner.first_name, owner.last_name].filter(Boolean).join(" "),
            formatAppDate(owner.date_of_birth),
            owner.birth_place,
            [owner.street, [owner.zip, owner.city].filter(Boolean).join(" "), owner.country ? country(owner.country) : ""]
              .filter(Boolean)
              .join(", "),
            owner.share_percent ? `${owner.share_percent.replace(".", lang === "en" ? "." : ",")} %` : "",
          ]
            .filter(Boolean)
            .join(" · "),
        }));

  const funds: Row[] = rows(
    row(
      "relationship_kind",
      draft.relationship_kind
        ? [oneOf(text.relationshipKinds, draft.relationship_kind), draft.relationship_kind === "other" ? draft.relationship : ""]
            .filter(Boolean)
            .join(": ")
        : "",
    ),
    organisation ? row("industry", draft.industry) : row("occupation", draft.occupation),
    row(
      "funds_sources",
      FUNDS_SOURCES.filter((source) => draft.funds_sources.includes(source))
        .map((source) => text.fundsSources[source])
        .join(", "),
    ),
    row("funds_description", draft.funds_description, text.missing.funds_description),
  );

  const payment: Row[] = rows(
    row("payment_method", draft.payment_method ? oneOf(text.paymentMethods, draft.payment_method) : "", text.missing.payment_method),
    row("payment_method_details", draft.payment_method_details, text.missing.payment_method_details),
    row("account_country", draft.account_country ? country(draft.account_country) : ""),
    row("account_holder", draft.account_holder),
    row("bank_name", draft.bank_name),
    row("via_third_party", yesNo(draft.via_third_party), text.missing.via_third_party),
    row("via_third_party_details", draft.via_third_party_details, text.missing.via_third_party_details),
  );

  const declarations: Row[] = LEGAL_QUESTIONS.flatMap((question) => {
    const details = LEGAL_DETAILS[question];
    const value = draft[details];
    return rows(
      row(question, yesNo(draft[question]), text.legalTopics[question]),
      row(details, details === "high_risk_country_code" && value ? country(value) : value, text.missing[details]),
    );
  });

  const all: Group[] = [
    { step: "privacy", rows: privacy },
    { step: "details", rows: details },
    {
      step: "identity",
      rows: identity,
      documents: { label: text.identityFiles, items: questionnaire.identity_documents ?? [] },
    },
    { step: "owners", rows: owners },
    {
      step: "funds",
      rows: funds,
      documents: { label: text.fundsProof, items: questionnaire.funds_proof_documents ?? [] },
    },
    { step: "payment", rows: payment },
    { step: "declarations", rows: declarations },
  ];
  return all.filter((group) => steps.includes(group.step));
}

/** Everything entered, grouped like the steps; with `onEdit` each group leads back to its step. */
export function AnswersSummary({
  questionnaire,
  steps,
  text,
  lang,
  onEdit,
}: {
  questionnaire: PayerQuestionnaire;
  steps: readonly PayerStep[];
  text: PayerLinkText;
  lang: string;
  onEdit?: (step: PayerStep) => void;
}) {
  const draft = draftFromQuestionnaire(questionnaire);
  const groups = summaryGroups(questionnaire, draft, steps, text, lang);
  return (
    <div className="space-y-4" data-testid="payer-link-summary">
      {groups.map((group) => (
        <section key={group.step} className="space-y-2 rounded-lg border border-border px-3 py-3" data-testid={`payer-link-summary-${group.step}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="min-w-0 text-sm font-semibold">{stepTitle(text, group.step, questionnaire.payer_type)}</h3>
            {onEdit ? (
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onEdit(group.step)}>
                {text.edit}
              </Button>
            ) : null}
          </div>
          {group.rows.length > 0 ? (
            <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              {group.rows.map((item, index) => (
                <div key={`${item.label}-${index}`} className="contents">
                  <dt className="min-w-0 break-words text-muted-foreground">{item.label}</dt>
                  <dd className="min-w-0 whitespace-pre-line break-words pb-1 sm:pb-0">{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{text.notStated}</p>
          )}
          {group.documents ? (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{group.documents.label}</p>
              <DocumentList documents={group.documents.items} text={text} lang={lang} emptyText={text.noDocuments} />
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

/** The list "please add", grouped by step, each group with a way back to its step. */
export function MissingList({
  questionnaire,
  steps,
  text,
  onGoTo,
}: {
  questionnaire: PayerQuestionnaire;
  steps: readonly PayerStep[];
  text: PayerLinkText;
  onGoTo: (step: PayerStep) => void;
}) {
  const groups = missingByStep(questionnaire.missing_for_submit ?? [], questionnaire.payer_type, steps);
  if (groups.length === 0) {
    return (
      <Notice tone="success" testId="payer-link-complete">
        {text.complete}
      </Notice>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-3 dark:border-amber-900/50 dark:bg-amber-950/20" data-testid="payer-link-missing">
      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">{text.missingTitle}</p>
      <ul className="space-y-2">
        {groups.map((group) => (
          <li key={group.step} className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 text-sm font-medium">{stepTitle(text, group.step, questionnaire.payer_type)}</span>
              {group.step !== "summary" ? (
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => onGoTo(group.step)}>
                  {text.goToStep}
                </Button>
              ) : null}
            </div>
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-950 dark:text-amber-100">
              {group.keys.map((key) => (
                <li key={key} data-missing-key={key}>
                  {missingLabel(text, key, questionnaire.payer_type)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Step 8: missing list, summary, confirmation and "send". */
export function SummaryStep({
  questionnaire,
  steps,
  text,
  lang,
  submitting,
  error,
  onGoTo,
  onSubmit,
}: {
  questionnaire: PayerQuestionnaire;
  steps: readonly PayerStep[];
  text: PayerLinkText;
  lang: string;
  submitting: boolean;
  error: string | null;
  onGoTo: (step: PayerStep) => void;
  onSubmit: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const missing = (questionnaire.missing_for_submit ?? []).length > 0;
  const blockedReason = missing ? text.submitNeedsMissing : !confirmed ? text.submitNeedsConfirm : null;
  return (
    <div className="space-y-5" data-testid="payer-link-step-summary">
      <p className="text-sm leading-6 text-muted-foreground">{text.summaryIntro}</p>
      <MissingList questionnaire={questionnaire} steps={steps} text={text} onGoTo={onGoTo} />
      <AnswersSummary questionnaire={questionnaire} steps={steps} text={text} lang={lang} onEdit={onGoTo} />
      <div className="space-y-3 rounded-lg border border-border bg-muted/10 px-3 py-3">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className={cn(checkboxClass, "mt-0.5")}
            checked={confirmed}
            disabled={submitting}
            onChange={(event) => setConfirmed(event.target.checked)}
            data-testid="payer-link-confirm"
          />
          <span className="leading-snug">{text.confirmLabel}</span>
        </label>
        <Button
          type="button"
          className="h-10 w-full gap-2 sm:w-auto"
          disabled={submitting || blockedReason !== null}
          aria-describedby={blockedReason ? "payer-link-submit-hint" : undefined}
          onClick={onSubmit}
          data-testid="payer-link-submit"
        >
          {submitting ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
          {submitting ? text.submitting : text.submit}
        </Button>
        {blockedReason ? (
          <p id="payer-link-submit-hint" className="text-xs text-muted-foreground">
            {blockedReason}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** After "send": the thanks and the read-only summary. */
export function ThankYou({
  questionnaire,
  steps,
  text,
  lang,
}: {
  questionnaire: PayerQuestionnaire;
  steps: readonly PayerStep[];
  text: PayerLinkText;
  lang: string;
}) {
  return (
    <div className="space-y-5" data-testid="payer-link-thanks">
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 dark:border-emerald-900/50 dark:bg-emerald-950/30">
        <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-emerald-600" />
        <div className="min-w-0 space-y-1">
          <p className="text-base font-semibold text-emerald-900 dark:text-emerald-100">
            {text.thanksTitle} {text.thanksBody}
          </p>
          {questionnaire.submitted_at ? (
            <p className="text-sm text-emerald-900/80 dark:text-emerald-200/80">{text.submittedAt(formatAppDateTime(questionnaire.submitted_at))}</p>
          ) : null}
          <p className="text-sm text-emerald-900/80 dark:text-emerald-200/80">{text.thanksNext}</p>
        </div>
      </div>
      <h2 className="text-sm font-semibold">{text.summaryTitle}</h2>
      <AnswersSummary questionnaire={questionnaire} steps={steps.filter((step) => step !== "summary")} text={text} lang={lang} />
    </div>
  );
}
