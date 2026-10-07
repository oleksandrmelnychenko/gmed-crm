/**
 * The lead's own GwG statements from the cabinet, as staff read them in the
 * wizard before signing the identification sheet (place of birth, identity
 * document, own economic interest, PEP and sanctions questions). Read-only:
 * staff keep their own AML assessment elsewhere in the wizard.
 */
import { countryNameForDisplay } from "@/components/ui/country-select";
import { appDateKeyOf, formatAppDateTime } from "@/lib/app-time-zone";

import type {
  LeadComplianceFlag,
  LeadCustody,
  LeadGwgIdentification,
  LeadPortalBilling,
  LeadPortalIntake,
  LeadPortalPayerLink,
  LeadPortalEnhancedDetails,
  LeadRepresentation,
  LeadRepresentative,
} from "../data/lead-portal-intake-api";
import { invoiceTaxLine, invoiceToLabel, type PaymentMethod } from "./lead-payer";

export type Tx = (ru: string, de: string) => string;

/** Shown for a statement the lead left empty. */
export const EMPTY_STATEMENT = "—";

type GwgIntake = Pick<LeadPortalIntake, "identification" | "identification_updated_at" | "identity_documents">
  & Partial<
    Pick<LeadPortalIntake, "representation" | "representation_updated_at" | "billing" | "billing_updated_at" | "enhanced_details">
  >;

/**
 * Whether the lead answered anything of the extra step "Zusätzliche Angaben":
 * a source of funds, words, what the patient knows of the payer's funds,
 * profession, sector, or a proof file.
 */
export function hasEnhancedDetailsStatements(details: LeadPortalEnhancedDetails | null | undefined): boolean {
  if (!details) return false;
  const answers = details.answers;
  return Boolean(
    details.updated_at
      || answers.funds_sources.length > 0
      || answers.funds_description
      || answers.payer_funds_source
      || answers.payer_funds_description
      || answers.occupation
      || answers.sector
      || details.funds_proof_documents.length > 0,
  );
}

/**
 * Whether the group "Дополнительные сведения" is shown: while the cabinet asks
 * the extra step, and while answers or files of it are on record (also after
 * the step is no longer asked).
 */
export function enhancedDetailsShown(
  details: LeadPortalEnhancedDetails | null | undefined,
): details is LeadPortalEnhancedDetails {
  return Boolean(details && (details.required || hasEnhancedDetailsStatements(details)));
}

/**
 * The extra step asks the self-payer's proof of funds (the enhanced check is
 * required) and none is on file: staff see an amber line.
 */
export function enhancedFundsProofMissing(details: LeadPortalEnhancedDetails | null | undefined): boolean {
  return Boolean(details?.asks.funds_proof && details.funds_proof_documents.length === 0);
}

/**
 * The patient pays himself (the step asks the own funds, or the lead stated
 * them) and no proof of funds is on file — whether it is required is the
 * caller's to say (the enhanced-check panel of the wizard decides with the
 * black-list countries it shows).
 */
export function enhancedFundsProofOutstanding(details: LeadPortalEnhancedDetails | null | undefined): boolean {
  if (!details || details.funds_proof_documents.length > 0) return false;
  return details.asks.funds_proof || details.asks.funds || details.answers.funds_sources.length > 0;
}

/** The keys of sections 7–8 the lead answers in the cabinet (not the staff fields, not the derived flags). */
const BILLING_ANSWER_KEYS = [
  "invoice_to",
  "invoice_name",
  "invoice_street",
  "invoice_zip",
  "invoice_city",
  "invoice_country",
  "invoice_email",
  "payment_method",
  "payment_method_details",
  "account_country",
  "account_holder",
  "bank_name",
  "via_third_party",
  "via_third_party_details",
] as const satisfies readonly (keyof LeadPortalBilling)[];

/**
 * Whether the lead answered anything of sections 7–8 in the cabinet. The
 * staff fields (USt-IdNr., Steuernummer) are not the lead's statements.
 */
export function hasBillingStatements(
  intake: Partial<Pick<LeadPortalIntake, "billing" | "billing_updated_at">> | null | undefined,
): boolean {
  const billing = intake?.billing;
  if (!billing) return false;
  if (intake?.billing_updated_at) return true;
  return BILLING_ANSWER_KEYS.some((key) => {
    const value = billing[key];
    return typeof value === "boolean" || Boolean(value);
  });
}

/**
 * Whether anything about the representation was entered in the cabinet: an
 * adult's answer, the data or a file of a representative. A custody stated by
 * staff and a parent who is only a trusted contact are not the lead's
 * statements.
 */
export function hasRepresentationStatements(
  intake: Partial<Pick<LeadPortalIntake, "representation" | "representation_updated_at">> | null | undefined,
): boolean {
  const representation = intake?.representation;
  if (!representation) return false;
  if (intake?.representation_updated_at) return true;
  if (typeof representation.has_representative === "boolean" || typeof representation.under_guardianship === "boolean") {
    return true;
  }
  return representation.representatives.some(
    (person) => person.has_data || person.identity_documents.length > 0 || person.authority_documents.length > 0,
  );
}

/**
 * Whether the lead entered any GwG statement, uploaded an identity document,
 * stated who acts for him, or answered where the invoice goes and how he pays.
 */
export function hasGwgStatements(intake: GwgIntake | null | undefined): boolean {
  if (!intake) return false;
  if (intake.identification_updated_at || intake.identity_documents.length > 0) return true;
  if (hasRepresentationStatements(intake) || hasBillingStatements(intake)) return true;
  if (hasEnhancedDetailsStatements(intake.enhanced_details)) return true;
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

/** The keys of the four legal questions and their details: the lead's, or a payer's. */
export type GwgLegalAnswerSource = Pick<
  LeadGwgIdentification,
  | "pep_self"
  | "pep_self_details"
  | "pep_related"
  | "pep_related_details"
  | "high_risk_country"
  | "high_risk_country_code"
  | "sanctions_links"
  | "sanctions_links_details"
>;

/** The four legal questions of the cabinet with the answers of the lead (or of the payer). */
export function gwgLegalAnswers(identification: GwgLegalAnswerSource, tx: Tx, lang: string): GwgLegalAnswer[] {
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

/** "Anna Muster"; "" while neither part of the name is known. */
export function representativeName(person: Pick<LeadRepresentative, "first_name" | "last_name">): string {
  return [person.first_name, person.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}

/** Who represents a minor, as the cabinet words the three answers. */
export function custodyLabel(custody: LeadCustody | null | undefined, tx: Tx): string {
  return enumLabel(
    {
      joint: tx("Оба родителя совместно", "Beide Eltern gemeinsam"),
      sole_parent: tx("Один родитель (единоличная опека)", "Ein Elternteil allein (alleiniges Sorgerecht)"),
      guardian: tx("Опекун или попечитель", "Vormund oder Pfleger"),
    },
    custody,
  );
}

/** The custody of a minor; while nobody stated it, both parents represent the child. */
export function custodyStatement(
  representation: Pick<LeadRepresentation, "custody" | "custody_stated">,
  tx: Tx,
): string {
  return representation.custody_stated && representation.custody
    ? custodyLabel(representation.custody, tx)
    : tx("не указано — оба родителя", "nicht angegeben – beide Eltern");
}

/** In which capacity a person acts for the lead. */
export function representativeRoleLabel(person: Pick<LeadRepresentative, "role" | "relation">, tx: Tx): string {
  if (person.role === "authorised_representative") {
    return tx("Уполномоченный представитель", "Bevollmächtigte Person");
  }
  if (person.role === "legal_guardian") return tx("Опекун (Betreuer)", "Betreuer/in");
  const relation = person.relation?.trim().toLowerCase();
  if (relation === "parent") return tx("Родитель", "Elternteil");
  if (relation === "guardian") return tx("Опекун", "Vormund");
  return tx("Законный представитель", "Gesetzliche/r Vertreter/in");
}

/** "Musterweg 1, 10115 Berlin, Германия": the parts that are known. */
export function representativeAddress(
  person: Pick<LeadRepresentative, "street" | "zip" | "city" | "country">,
  lang: string,
): string {
  return [
    person.street,
    [person.zip, person.city].map((part) => part?.trim()).filter(Boolean).join(" "),
    countryNameForDisplay(person.country, lang),
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * What staff must look at before they rely on the representation of a minor:
 * nobody is on file, one parent states to act alone while several people are
 * on file, or both parents act and one of them is missing.
 */
export type RepresentationWarning = "no_representative" | "single_custody_several" | "joint_custody_incomplete";

export function representationWarnings(
  representation: Pick<LeadRepresentation, "custody" | "representatives"> | null | undefined,
  minor: boolean,
): RepresentationWarning[] {
  if (!representation || !minor) return [];
  const count = representation.representatives.length;
  if (count === 0) return ["no_representative"];
  // Without an answer both parents represent the child.
  const joint = (representation.custody ?? "joint") === "joint";
  if (joint) return count < 2 ? ["joint_custody_incomplete"] : [];
  return count > 1 ? ["single_custody_several"] : [];
}

export function representationWarningText(warning: RepresentationWarning, tx: Tx): string {
  switch (warning) {
    case "no_representative":
      return tx(
        "Добавьте родителя или законного представителя",
        "Bitte einen Elternteil oder eine gesetzliche Vertreterin / einen gesetzlichen Vertreter hinzufügen",
      );
    case "single_custody_several":
      return tx(
        "Ребёнка представляет один человек, но указано несколько представителей — проверьте, кто действует за ребёнка",
        "Das Kind wird von einer Person allein vertreten, es sind aber mehrere Vertreter erfasst – bitte prüfen, wer für das Kind handelt",
      );
    case "joint_custody_incomplete":
      return tx(
        "Ребёнка представляют оба родителя, но указан только один — нужны данные и подпись второго родителя",
        "Das Kind wird von beiden Eltern vertreten, es ist aber nur ein Elternteil erfasst – Angaben und Unterschrift des zweiten Elternteils fehlen",
      );
  }
}

/**
 * Who acts for the lead, as the block "Данные от пациента" shows it: for a
 * minor the custody, the legal representatives and the warnings; for an adult
 * the two answers and the persons named by a "yes". `null` when the server
 * keeps it from the caller's role or does not know it.
 */
export type RepresentationStatements =
  | {
      kind: "minor";
      custody: string;
      persons: LeadRepresentative[];
      warnings: RepresentationWarning[];
    }
  | {
      kind: "adult";
      hasRepresentative: boolean | null;
      underGuardianship: boolean | null;
      persons: LeadRepresentative[];
    };

export function representationStatements(
  intake: Pick<LeadPortalIntake, "minor" | "representation"> | null | undefined,
  tx: Tx,
): RepresentationStatements | null {
  const representation = intake?.representation;
  if (!intake || !representation) return null;
  if (intake.minor) {
    return {
      kind: "minor",
      custody: custodyStatement(representation, tx),
      persons: representation.representatives,
      warnings: representationWarnings(representation, true),
    };
  }
  return {
    kind: "adult",
    hasRepresentative: representation.has_representative,
    underGuardianship: representation.under_guardianship,
    persons: representation.representatives,
  };
}

/** How the lead will pay, as the cabinet words the five answers. */
export function paymentMethodLabel(value: PaymentMethod | string | null | undefined, tx: Tx): string {
  return enumLabel(
    {
      bank_transfer: tx("Банковский перевод", "Überweisung"),
      card: tx("Банковская карта", "Karte"),
      cash: tx("Наличные", "Bar"),
      crypto: tx("Криптовалюта", "Kryptowährung"),
      other: tx("Иной способ", "Sonstiges"),
    },
    value,
  );
}

/** What a compliance flag of the server stands for, in the words of the amber line. */
export function complianceFlagLabel(flag: LeadComplianceFlag | string, tx: Tx): string {
  return enumLabel(
    {
      cash_payment: tx("наличные", "Barzahlung"),
      crypto_payment: tx("криптовалюта", "Kryptowährung"),
      other_method: tx("иной способ оплаты", "sonstiger Zahlungsweg"),
      third_party_payment: tx("платёж через третье лицо", "Zahlung über Dritte"),
    },
    flag,
  );
}

/** "Требуется проверка комплаенса: наличные, платёж через третье лицо"; "" without a flag. */
export function complianceFlagsLine(flags: readonly string[], tx: Tx): string {
  if (flags.length === 0) return "";
  return tx("Требуется проверка комплаенса: ", "Compliance-Prüfung erforderlich: ")
    + flags.map((flag) => complianceFlagLabel(flag, tx)).join(", ");
}

/** The methods that call for a compliance check on their own (D7). */
const FLAGGED_METHODS: readonly string[] = ["cash", "crypto", "other"];

export type BillingStatementKey =
  | "invoice_to"
  | "invoice_name"
  | "invoice_address"
  | "invoice_email"
  | "invoice_tax"
  | "payment_method"
  | "account_country"
  | "account_holder"
  | "bank_name"
  | "via_third_party";

export type BillingStatement = {
  key: BillingStatementKey;
  label: string;
  /** "" when the lead left it empty (shown as a dash). */
  value: string;
  /** What the lead added to "other" or to a "yes"; "" otherwise. */
  details: string;
  /** Staff must look at it: cash, crypto, another method, a payment through a third party. */
  warning: boolean;
};

/**
 * Sections 7–8 as the group "Счёт и оплата" shows them: the rows of the
 * invoice recipient, the rows of the payment route — or none while the payer
 * answers section 8 himself through an own link (`byPayer`) — and the
 * compliance flags of the server as labels.
 */
export type BillingStatements = {
  invoice: BillingStatement[];
  payment: BillingStatement[];
  /** Section 8 is the third-party payer's answer: the cabinet asked nothing. */
  byPayer: boolean;
  /** The compliance line; "" without a flag. */
  complianceLine: string;
};

export function billingStatements(
  billing: LeadPortalBilling,
  tx: Tx,
  lang: string,
  /**
   * The payer sent the answers through the own link: section 8 is the
   * payer's answer then and is shown as such (phase 3a).
   */
  payerAnswered = false,
): BillingStatements {
  const country = (code: string | null) => countryNameForDisplay(code, lang);
  const statement = (
    key: BillingStatementKey,
    label: string,
    value: string | null,
    options: { details?: string | null; warning?: boolean } = {},
  ): BillingStatement => ({
    key,
    label,
    value: value?.trim() ?? "",
    details: options.details?.trim() ?? "",
    warning: options.warning === true,
  });

  const invoice: BillingStatement[] = [
    statement("invoice_to", tx("Счёт направляется", "Rechnung geht an"), invoiceToLabel(billing.invoice_to, tx)),
  ];
  if (billing.invoice_to === "other") {
    invoice.push(
      statement("invoice_name", tx("Имя на счёте", "Name auf der Rechnung"), billing.invoice_name),
      statement(
        "invoice_address",
        tx("Адрес для счёта", "Rechnungsanschrift"),
        representativeAddress(
          { street: billing.invoice_street, zip: billing.invoice_zip, city: billing.invoice_city, country: billing.invoice_country },
          lang,
        ),
      ),
    );
  }
  invoice.push(statement("invoice_email", tx("E-mail для счетов", "E-Mail für Rechnungen"), billing.invoice_email));
  const taxLine = invoiceTaxLine(billing);
  if (taxLine) invoice.push(statement("invoice_tax", "USt-IdNr. / Steuernummer", taxLine));

  const byPayer = billing.payment_route_by === "payer";
  const method = billing.payment_method;
  const payment: BillingStatement[] = [];
  if (!byPayer || payerAnswered) {
    payment.push(
      statement("payment_method", tx("Способ оплаты", "Zahlungsweg"), paymentMethodLabel(method, tx), {
        details: method === "other" ? billing.payment_method_details : null,
        warning: method !== null && FLAGGED_METHODS.includes(method),
      }),
    );
    // The account is asked for a transfer or a card; for cash, crypto or
    // another method the server clears it.
    if (method === null || method === "bank_transfer" || method === "card") {
      payment.push(
        statement("account_country", tx("Страна счёта", "Land des Kontos"), country(billing.account_country)),
        statement("account_holder", tx("Владелец счёта", "Kontoinhaber/in"), billing.account_holder),
        statement("bank_name", tx("Банк", "Bank"), billing.bank_name),
      );
    }
    payment.push(
      statement(
        "via_third_party",
        tx("Платёж через третье лицо / платёжного провайдера", "Zahlung über Dritte / Zahlungsdienstleister"),
        answerLabel(billing.via_third_party, tx),
        {
          details: billing.via_third_party === true ? billing.via_third_party_details : null,
          warning: billing.via_third_party === true,
        },
      ),
    );
  }

  return { invoice, payment, byPayer, complianceLine: complianceFlagsLine(billing.compliance_flags, tx) };
}

/** The note that stands in for section 8 while the third-party payer answers it himself. */
export function paymentRouteByPayerNote(tx: Tx): string {
  return tx(
    "Способ оплаты укажет плательщик (собственная ссылка — следующий этап)",
    "Den Zahlungsweg gibt der Zahler selbst an (eigener Link folgt)",
  );
}

/**
 * The line of section 8 for a third-party payer (phase 3a): the payer states
 * the payment route through the own link, or stated it on a day. A server
 * without the payer link keeps the note of before.
 */
export function paymentRouteByPayerLine(
  payerLink: Pick<LeadPortalPayerLink, "submitted_at"> | null | undefined,
  tx: Tx,
): string {
  if (!payerLink) return paymentRouteByPayerNote(tx);
  if (payerLink.submitted_at) {
    const at = formatAppDateTime(payerLink.submitted_at);
    return tx(`Способ оплаты: указал плательщик ${at}`, `Zahlungsweg: angegeben vom Zahler am ${at}`);
  }
  return tx("Способ оплаты: укажет плательщик по ссылке", "Zahlungsweg: gibt der Zahler über den Link an");
}
