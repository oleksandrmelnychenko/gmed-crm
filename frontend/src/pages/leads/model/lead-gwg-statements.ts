/**
 * The lead's own GwG statements from the cabinet, as staff read them in the
 * wizard before signing the identification sheet (place of birth, identity
 * document, own economic interest, PEP and sanctions questions). Read-only:
 * staff keep their own AML assessment elsewhere in the wizard.
 */
import { countryNameForDisplay } from "@/components/ui/country-select";
import { appDateKeyOf } from "@/lib/app-time-zone";

import type { LeadGwgIdentification, LeadPortalIntake } from "../data/lead-portal-intake-api";

export type Tx = (ru: string, de: string) => string;

/** Shown for a statement the lead left empty. */
export const EMPTY_STATEMENT = "—";

type GwgIntake = Pick<LeadPortalIntake, "identification" | "identification_updated_at" | "identity_documents">;

/** Whether the lead entered any GwG statement or uploaded an identity document. */
export function hasGwgStatements(intake: GwgIntake | null | undefined): boolean {
  if (!intake) return false;
  if (intake.identification_updated_at || intake.identity_documents.length > 0) return true;
  return Object.values(intake.identification ?? {}).some((value) =>
    Array.isArray(value) ? value.length > 0 : typeof value === "boolean" || Boolean(value),
  );
}

/** The label of a known value; an unknown value is shown as it is, an empty one as "". */
function enumLabel(labels: Record<string, string>, value: string | null | undefined): string {
  if (!value) return "";
  return Object.hasOwn(labels, value) ? labels[value] : value;
}

export function salutationLabel(value: string | null | undefined, tx: Tx): string {
  return enumLabel(
    {
      mr: tx("Господин", "Herr"),
      ms: tx("Госпожа", "Frau"),
      none: tx("Без обращения", "Keine Anrede"),
    },
    value,
  );
}

export function idDocumentTypeLabel(value: string | null | undefined, tx: Tx): string {
  return enumLabel(
    {
      passport: tx("Паспорт", "Reisepass"),
      id_card: tx("Удостоверение личности", "Personalausweis"),
      residence_permit: tx("Вид на жительство", "Aufenthaltstitel"),
    },
    value,
  );
}

/** "E-mail, телефон": the channels the lead allowed, in the order of the form. */
export function contactChannelsLabel(values: readonly string[] | null | undefined, tx: Tx): string {
  const labels: Record<string, string> = {
    email: tx("E-mail", "E-Mail"),
    phone: tx("Телефон", "Telefon"),
    messenger: tx("Мессенджер", "Messenger"),
  };
  const order = Object.keys(labels);
  const rank = (value: string) => (order.includes(value) ? order.indexOf(value) : order.length);
  return Array.from(new Set(values ?? []))
    .sort((left, right) => rank(left) - rank(right))
    .map((value) => enumLabel(labels, value))
    .join(", ");
}

/** A yes/no answer of the lead; null and undefined mean "not answered yet". */
export function answerLabel(value: boolean | null | undefined, tx: Tx): string {
  if (value === true) return tx("Да", "Ja");
  if (value === false) return tx("Нет", "Nein");
  return tx("Не отвечено", "Nicht beantwortet");
}

export type IdDocumentValidity = "valid" | "expired" | "missing";

/**
 * Whether the identity document is still valid on `today` ("YYYY-MM-DD", the
 * Berlin date). The last day of validity still counts; a missing or unreadable
 * date is "missing".
 */
export function idDocumentValidity(validUntil: string | null | undefined, today: string): IdDocumentValidity {
  const key = appDateKeyOf(validUntil);
  if (!key) return "missing";
  return key < today ? "expired" : "valid";
}

export type GwgLegalAnswerKey = "pep_self" | "pep_related" | "high_risk_country" | "sanctions_links";

export type GwgLegalAnswer = {
  key: GwgLegalAnswerKey;
  question: string;
  answer: boolean | null;
  /** What the lead added to a "yes"; "" otherwise. */
  details: string;
};

/** The four legal questions of the cabinet with the lead's answers. */
export function gwgLegalAnswers(identification: LeadGwgIdentification, tx: Tx, lang: string): GwgLegalAnswer[] {
  const details = (answer: boolean | null, text: string | null | undefined) => (answer === true ? (text ?? "").trim() : "");
  return [
    {
      key: "pep_self",
      question: tx(
        "Занимает или занимал за последние 12 месяцев высокую государственную должность (PEP)",
        "Bekleidet ein wichtiges öffentliches Amt oder hat es in den letzten 12 Monaten bekleidet (PEP)",
      ),
      answer: identification.pep_self,
      details: details(identification.pep_self, identification.pep_self_details),
    },
    {
      key: "pep_related",
      question: tx(
        "Близкий родственник или близкое лицо — PEP",
        "Familienmitglied oder nahestehende Person ist PEP",
      ),
      answer: identification.pep_related,
      details: details(identification.pep_related, identification.pep_related_details),
    },
    {
      key: "high_risk_country",
      question: tx(
        "Проживание или место нахождения в стране высокого риска (список ЕС)",
        "Wohnsitz oder Sitz in einem Hochrisiko-Drittstaat (EU-Liste)",
      ),
      answer: identification.high_risk_country,
      details: details(
        identification.high_risk_country,
        countryNameForDisplay(identification.high_risk_country_code, lang),
      ),
    },
    {
      key: "sanctions_links",
      question: tx(
        "Связи с лицами или компаниями под санкциями",
        "Verbindungen zu sanktionierten Personen oder Unternehmen",
      ),
      answer: identification.sanctions_links,
      details: details(identification.sanctions_links, identification.sanctions_links_details),
    },
  ];
}

/**
 * The part of the payer declaration ("who pays") that belongs to the GwG
 * statements. The staff declaration names the beneficial owner in two fields,
 * the cabinet in one.
 */
export type GwgPayerStatement = {
  acts_on_own_account?: boolean | null;
  /**
   * False while nobody answered the question: `acts_on_own_account` is then
   * only the stored default. Absent on a server that does not track it.
   */
  own_account_answered?: boolean | null;
  beneficial_owner?: string | null;
  beneficial_owner_name?: string | null;
  beneficial_owner_note?: string | null;
};

/**
 * Own economic interest: the answer (null = not answered, also without a
 * payer declaration) and, for a "no", the person in whose interest the
 * patient acts.
 */
export function ownAccountStatement(payer: GwgPayerStatement | null | undefined): {
  answer: boolean | null;
  beneficialOwner: string;
} {
  const answer =
    typeof payer?.acts_on_own_account === "boolean" && payer.own_account_answered !== false
      ? payer.acts_on_own_account
      : null;
  if (answer !== false) return { answer, beneficialOwner: "" };
  const single = payer?.beneficial_owner?.trim();
  const beneficialOwner = single
    || [payer?.beneficial_owner_name, payer?.beneficial_owner_note]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" · ");
  return { answer, beneficialOwner };
}
