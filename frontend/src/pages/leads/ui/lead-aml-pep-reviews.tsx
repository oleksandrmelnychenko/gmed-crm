import type { ComponentType } from "react";

import {
  type PepAnswerValue,
  type PepPerson,
  type PepReviewEntry,
  pepAnswerValue,
  pepReviewDate,
  pepReviewed,
  sanctionsAnswerValue,
} from "../model/pep-review";

type Tx = (ru: string, de: string) => string;

export type PatientPepField = "pepContractPartner" | "pepBeneficialOwner" | "pepStatusChecked";

type ToggleProps = { checked: boolean; label: string; onChange: (checked: boolean) => void; disabled?: boolean };

export type LeadAmlPepReviewsProps = {
  persons: readonly PepPerson[];
  /** The patient's staff fields of the form. */
  patient: { pepContractPartner: boolean; pepBeneficialOwner: boolean; pepStatusChecked: boolean };
  disabled: boolean;
  tx: Tx;
  Toggle: ComponentType<ToggleProps>;
  onPatientChange: (field: PatientPepField, checked: boolean) => void;
  onReviewChange: (subject: string, patch: Partial<Pick<PepReviewEntry, "checked" | "isPep">>) => void;
};

function roleLabel(person: PepPerson, tx: Tx) {
  if (person.kind === "patient") return tx("Пациент", "Patient/in");
  if (person.kind === "payer") return tx("Плательщик (третье лицо)", "Zahler (Dritte/r)");
  switch (person.role) {
    case "authorised_representative":
      return tx("Представитель по доверенности", "Bevollmächtigte/r");
    case "legal_guardian":
      return tx("Опекун (Betreuer)", "Rechtliche/r Betreuer/in");
    default:
      return tx("Законный представитель", "Gesetzliche/r Vertreter/in");
  }
}

function answerLabel(value: PepAnswerValue, tx: Tx) {
  if (value === "yes") return tx("да", "ja");
  if (value === "no") return tx("нет", "nein");
  return tx("нет ответа", "keine Angabe");
}

function reviewLabel(review: PepReviewEntry, tx: Tx) {
  if (!pepReviewed(review)) return tx("ещё не проверено", "noch nicht geprüft");
  const day = pepReviewDate(review.checkedOn);
  const parts = [tx("PEP-статус проверен", "PEP-Status geprüft")];
  if (day) parts.push(tx(day, `am ${day}`));
  if (review.checkedBy) parts.push(tx(`(${review.checkedBy})`, `von ${review.checkedBy}`));
  const result = review.isPep ? tx("является PEP", "PeP") : tx("не PEP", "keine PeP");
  return `${parts.join(" ")} — ${tx("итог", "Ergebnis")}: ${result}`;
}

/**
 * Who answered what, and staff's PEP review of each person (owner decision
 * 2026-10-23): the person's answers are display-only; staff's review is a
 * layer of its own, per person.
 */
export function LeadAmlPepReviews({ persons, patient, disabled, tx, Toggle, onPatientChange, onReviewChange }: LeadAmlPepReviewsProps) {
  return (
    <div className="space-y-3" data-testid="lead-aml-pep-persons">
      {persons.map((person) => {
        const pep = pepAnswerValue(person.answers);
        const sanctions = sanctionsAnswerValue(person.answers);
        return (
          <div
            key={person.subject}
            className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3"
            data-testid={`lead-aml-pep-person-${person.kind}`}
            data-subject={person.subject}
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[13px] font-medium text-foreground">{roleLabel(person, tx)}</span>
              {person.name ? <span className="text-sm text-muted-foreground">{person.name}</span> : null}
            </div>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              <div className="flex gap-2">
                <dt className="text-muted-foreground">{tx("Ответ лица: PEP", "Angabe der Person: PeP")}</dt>
                <dd className="font-medium text-foreground" data-testid="lead-aml-pep-person-answer" data-value={pep}>{answerLabel(pep, tx)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">{tx("Ответ лица: санкции", "Angabe der Person: Sanktionen")}</dt>
                <dd className="font-medium text-foreground" data-testid="lead-aml-pep-person-sanctions" data-value={sanctions}>{answerLabel(sanctions, tx)}</dd>
              </div>
            </dl>
            <div className="border-y border-border/70">
              {person.kind === "patient" ? (
                <>
                  <Toggle
                    checked={patient.pepContractPartner}
                    disabled={disabled}
                    onChange={(checked) => onPatientChange("pepContractPartner", checked)}
                    label={tx("Контрагент является PEP", "Vertragspartner ist eine PeP")}
                  />
                  <Toggle
                    checked={patient.pepBeneficialOwner}
                    disabled={disabled}
                    onChange={(checked) => onPatientChange("pepBeneficialOwner", checked)}
                    label={tx("Бенефициарный владелец является PEP", "Wirtschaftlich Berechtigter ist eine PeP")}
                  />
                  <div data-testid="lead-aml-pep-status-checked">
                    <Toggle
                      checked={patient.pepStatusChecked}
                      disabled={disabled}
                      onChange={(checked) => onPatientChange("pepStatusChecked", checked)}
                      label={tx("PEP-статус проверен (по базам или со слов клиента)", "PeP-Status geprüft (Datenbank oder Angabe des Kunden)")}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div data-testid="lead-aml-pep-review-checked">
                    <Toggle
                      checked={person.review.checked}
                      disabled={disabled}
                      onChange={(checked) => onReviewChange(person.subject, { checked })}
                      label={tx("PEP-статус проверен (по базам или со слов лица)", "PeP-Status geprüft (Datenbank oder Angabe der Person)")}
                    />
                  </div>
                  <div data-testid="lead-aml-pep-review-is-pep">
                    <Toggle
                      checked={person.review.isPep}
                      disabled={disabled}
                      onChange={(isPep) => onReviewChange(person.subject, { isPep })}
                      label={tx("По итогам проверки является PEP", "Nach Prüfung eine PeP")}
                    />
                  </div>
                </>
              )}
            </div>
            <p className="text-xs leading-5 text-muted-foreground" data-testid="lead-aml-pep-person-review">
              {tx("Проверка GMED", "Prüfung durch GMED")}: {reviewLabel(person.review, tx)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
