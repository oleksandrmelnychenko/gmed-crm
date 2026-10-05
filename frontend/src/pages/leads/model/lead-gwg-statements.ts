/**
 * The lead's own GwG statements from the cabinet, as staff read them in the
 * wizard before signing the identification sheet (place of birth, identity
 * document, own economic interest, PEP and sanctions questions). Read-only:
 * staff keep their own AML assessment elsewhere in the wizard.
 */
import { countryNameForDisplay } from "@/components/ui/country-select";
import { appDateKeyOf } from "@/lib/app-time-zone";

import type {
  LeadCustody,
  LeadGwgIdentification,
  LeadPortalIntake,
  LeadRepresentation,
  LeadRepresentative,
} from "../data/lead-portal-intake-api";

export type Tx = (ru: string, de: string) => string;

/** Shown for a statement the lead left empty. */
export const EMPTY_STATEMENT = "—";

type GwgIntake = Pick<LeadPortalIntake, "identification" | "identification_updated_at" | "identity_documents">
  & Partial<Pick<LeadPortalIntake, "representation" | "representation_updated_at">>;

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
 * Whether the lead entered any GwG statement, uploaded an identity document
 * or stated who acts for him.
 */
export function hasGwgStatements(intake: GwgIntake | null | undefined): boolean {
  if (!intake) return false;
  if (intake.identification_updated_at || intake.identity_documents.length > 0) return true;
  if (hasRepresentationStatements(intake)) return true;
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
