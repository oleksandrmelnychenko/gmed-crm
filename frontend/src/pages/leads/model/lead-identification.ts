/**
 * Identification of a lead's contract partners by qualified electronic
 * signature (§ 12 Abs. 1 GwG, owner decision 2026-10-05): a completed QES of
 * the person counts as the identification, and staff confirm by hand that the
 * payment arrived from an account in that person's own name. The labels only
 * inform — nothing is blocked by them. For a minor the legal representatives
 * sign and pay, so they are identified instead of the child. An adult's
 * representative and legal guardian are identified beside the adult.
 */
import type { StatusTone } from "@/components/ui-shell";
import { ApiRequestError } from "@/lib/api";
import { formatAppDate } from "@/lib/app-time-zone";

export type Tx = (ru: string, de: string) => string;

/**
 * A legal representative of a minor, or an adult's representative or legal
 * guardian: `representative:<id of the trusted contact>`.
 */
export type RepresentativeSubject = `representative:${string}`;

/**
 * The patient, a third-party payer or — for a minor, who has no line of his
 * own — one of the legal representatives.
 */
export type IdentificationSubject = "contract_partner" | "payer" | RepresentativeSubject;

export function representativeSubject(id: string): RepresentativeSubject {
  return `representative:${id}`;
}

export function isRepresentativeSubject(value: unknown): value is RepresentativeSubject {
  return typeof value === "string" && value.startsWith("representative:") && value.length > "representative:".length;
}

export type QualifiedSignature = {
  signed_at: string;
  /** Signed on the provider's demo account: shown, but no legal evidence. */
  test_mode: boolean;
};

export type OwnAccountPayment = {
  confirmed_at: string;
  confirmed_by_name: string | null;
  note: string | null;
};

export type PersonIdentification = {
  qes: QualifiedSignature | null;
  own_account_payment: OwnAccountPayment | null;
};

/**
 * The third-party payer. For a minor the payer is often a parent: then he is
 * the same person as a legal representative, `same_person_as` names that
 * representative and the signature and the payment are that person's.
 */
export type PayerIdentification = PersonIdentification & {
  same_person_as: RepresentativeSubject | null;
};

/** A legal representative of a minor: signs and pays instead of the child. */
export type RepresentativeIdentification = PersonIdentification & {
  id: string;
  subject: RepresentativeSubject;
  name: string;
  /** The relation of the trusted contact: `parent`, `guardian`, … */
  relation: string | null;
  /** A signature is attributed by the signer's e-mail: without one it cannot count. */
  has_email: boolean;
};

/**
 * An adult's representative (slot `agent`) or legal guardian (slot
 * `guardian`, the Betreuer) named in the cabinet: a person of its own with an
 * own identification sheet (owner decision 2026-10-10). The patient keeps the
 * own line beside it. The subject is `representative:<id>`, as for a minor.
 */
export type ActingPersonIdentification = RepresentativeIdentification & {
  slot: "agent" | "guardian";
  /** `authorised_representative` or `legal_guardian`. */
  role: string | null;
};

export type LeadIdentificationStatus = {
  /** For a minor both values are null: the child neither signs nor pays. */
  contract_partner: PersonIdentification;
  /** `null` unless the payer declaration names a third party. */
  payer: PayerIdentification | null;
  minor: boolean;
  /** The legal representatives of a minor; empty for an adult. */
  representatives: RepresentativeIdentification[];
  /** An adult's representative and legal guardian; empty for a minor. */
  acting_persons: ActingPersonIdentification[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

function normalizePerson(value: Record<string, unknown>): PersonIdentification {
  const qes = asRecord(value.qes);
  const payment = asRecord(value.own_account_payment);
  const signedAt = text(qes?.signed_at);
  const confirmedAt = text(payment?.confirmed_at);
  return {
    qes: qes && signedAt ? { signed_at: signedAt, test_mode: qes.test_mode === true } : null,
    own_account_payment: payment && confirmedAt
      ? {
          confirmed_at: confirmedAt,
          confirmed_by_name: text(payment.confirmed_by_name),
          note: text(payment.note),
        }
      : null,
  };
}

/** One line of a person who acts for the lead; `null` without an id. */
function normalizeRepresentative(item: unknown): RepresentativeIdentification | null {
  const record = asRecord(item);
  const id = text(record?.id)?.trim();
  if (!record || !id) return null;
  return {
    ...normalizePerson(record),
    id,
    // The subject is built from the id, so a line can never post to another person.
    subject: representativeSubject(id),
    name: text(record.name)?.trim() ?? "",
    relation: text(record.relation)?.trim() ?? null,
    has_email: record.has_email === true,
  };
}

function normalizeRepresentatives(value: unknown): RepresentativeIdentification[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => normalizeRepresentative(item) ?? []);
}

/** An adult's acting persons: a line with an id and the slot `agent` or `guardian`. */
function normalizeActingPersons(value: unknown): ActingPersonIdentification[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const person = normalizeRepresentative(item);
    const record = asRecord(item);
    const slot = text(record?.slot)?.trim();
    if (!person || (slot !== "agent" && slot !== "guardian")) return [];
    return [{ ...person, slot, role: text(record?.role)?.trim() ?? null }];
  });
}

/**
 * The server response; `null` for anything that is not an identification
 * status (an older backend, an unexpected proxy reply), so nothing is claimed
 * about a state that is not known. A server that does not know minors yet
 * answers without `minor` and `representatives`: the lead is then shown as an
 * adult, as before. A server that does not know an adult's acting persons
 * answers without `acting_persons`: the adult has only the own line, as
 * before. A minor has no acting persons (the representatives act for him).
 */
export function normalizeLeadIdentificationStatus(value: unknown): LeadIdentificationStatus | null {
  const record = asRecord(value);
  const contractPartner = asRecord(record?.contract_partner);
  if (!record || !contractPartner) return null;
  const payer = asRecord(record.payer);
  const minor = record.minor === true;
  const representatives = normalizeRepresentatives(record.representatives);
  const actingPersons = minor ? [] : normalizeActingPersons(record.acting_persons);
  // Only a representative of this very answer can be "the same person".
  const samePersonAs = payer?.same_person_as;
  const samePerson = isRepresentativeSubject(samePersonAs)
    && representatives.some((person) => person.subject === samePersonAs)
    ? samePersonAs
    : null;
  return {
    contract_partner: normalizePerson(contractPartner),
    payer: payer ? { ...normalizePerson(payer), same_person_as: samePerson } : null,
    minor,
    representatives,
    acting_persons: actingPersons,
  };
}

export type IdentificationLabel = { tone: StatusTone; text: string };

/** "Qualified signature · 05.10.2026", marked as a test for a demo signature. */
export function qualifiedSignatureLabel(person: PersonIdentification, tx: Tx): IdentificationLabel {
  if (!person.qes) {
    return {
      tone: "neutral",
      text: tx("Квалифицированной подписи ещё нет", "Noch keine qualifizierte Signatur"),
    };
  }
  const signed = `${tx("Квалифицированная подпись", "Qualifizierte Signatur")} · ${formatAppDate(person.qes.signed_at)}`;
  return person.qes.test_mode
    ? { tone: "info", text: `${signed} · ${tx("тест", "Test")}` }
    : { tone: "success", text: signed };
}

/** The payment from the person's own account: awaited, or confirmed with the day and who confirmed it. */
export function ownAccountPaymentLabel(person: PersonIdentification, tx: Tx): IdentificationLabel {
  const payment = person.own_account_payment;
  if (!payment) {
    return {
      tone: "warning",
      text: tx("Ожидается платёж с собственного счёта", "Zahlung vom eigenen Konto ausstehend"),
    };
  }
  return {
    tone: "success",
    text: [
      tx("Платёж с собственного счёта подтверждён", "Zahlung vom eigenen Konto bestätigt"),
      formatAppDate(payment.confirmed_at),
      payment.confirmed_by_name,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

export type IdentificationPerson = {
  subject: IdentificationSubject;
  /** How the line is captioned: the person's role in the lead, or the name of a representative. */
  role: string;
  /** Said beside the caption in small print (a representative's relation); "" otherwise. */
  detail: string;
  person: PersonIdentification;
  /**
   * Whether the payment is confirmed on this line. Not on the line of a payer
   * who is a representative: it only repeats that person's labels.
   */
  canConfirm: boolean;
  /** A caption that is a whole sentence stands on a line of its own. */
  wide: boolean;
  /** What stands in the way of this person's identification; "" when nothing does. */
  note: string;
};

/** "родитель" / "опекун" beside the name of a legal representative. */
function representativeRelationLabel(relation: string | null, tx: Tx): string {
  const key = relation?.trim().toLowerCase();
  if (key === "parent") return tx("родитель", "Elternteil");
  if (key === "guardian") return tx("опекун", "Vormund");
  return tx("законный представитель", "gesetzliche/r Vertreter/in");
}

/** "уполномоченный представитель" / "опекун (Betreuer)" beside the name of an adult's acting person. */
function actingPersonRoleLabel(person: ActingPersonIdentification, tx: Tx): string {
  return person.slot === "guardian"
    ? tx("опекун (Betreuer)", "Betreuer/in")
    : tx("уполномоченный представитель", "bevollmächtigte Person");
}

/** Without an address a signature cannot be attributed to the person. */
function missingEmailNote(person: RepresentativeIdentification, tx: Tx): string {
  return person.has_email
    ? ""
    : tx("нет e-mail — подпись не засчитается", "keine E-Mail – die Signatur wird nicht angerechnet");
}

/**
 * The lines of the block. Adult: the patient, one line per representative or
 * legal guardian named in the cabinet, and the payer when a third party pays.
 * Minor: no line for the child — one per legal representative, and the payer;
 * a payer who is one of the representatives is the same person and gets no
 * second confirmation.
 */
export function identificationPersons(status: LeadIdentificationStatus, tx: Tx): IdentificationPerson[] {
  const persons: IdentificationPerson[] = status.minor
    ? status.representatives.map((representative) => ({
        subject: representative.subject,
        role: representative.name || tx("Законный представитель", "Gesetzliche/r Vertreter/in"),
        detail: representativeRelationLabel(representative.relation, tx),
        person: { qes: representative.qes, own_account_payment: representative.own_account_payment },
        canConfirm: true,
        wide: false,
        note: missingEmailNote(representative, tx),
      }))
    : [
        {
          subject: "contract_partner",
          role: tx("Пациент", "Patient/in"),
          detail: "",
          person: status.contract_partner,
          canConfirm: true,
          wide: false,
          note: "",
        },
        ...status.acting_persons.map((acting) => ({
          subject: acting.subject,
          role: acting.name || (acting.slot === "guardian"
            ? tx("Опекун (Betreuer)", "Betreuer/in")
            : tx("Уполномоченный представитель", "Bevollmächtigte Person")),
          detail: actingPersonRoleLabel(acting, tx),
          person: { qes: acting.qes, own_account_payment: acting.own_account_payment },
          canConfirm: true,
          wide: false,
          note: missingEmailNote(acting, tx),
        })),
      ];
  const payer = status.payer;
  if (!payer) return persons;
  const samePerson = payer.same_person_as
    ? status.representatives.find((representative) => representative.subject === payer.same_person_as)
    : undefined;
  if (samePerson) {
    const name = samePerson.name || tx("без имени", "ohne Namen");
    persons.push({
      subject: "payer",
      role: tx(
        `Плательщик — тот же человек, что и представитель ${name}`,
        `Kostenträger — dieselbe Person wie Vertreter/in ${name}`,
      ),
      detail: "",
      person: { qes: samePerson.qes, own_account_payment: samePerson.own_account_payment },
      canConfirm: false,
      wide: true,
      note: "",
    });
    return persons;
  }
  persons.push({
    subject: "payer",
    role: tx("Плательщик", "Kostenübernehmer"),
    detail: "",
    person: { qes: payer.qes, own_account_payment: payer.own_account_payment },
    canConfirm: true,
    wide: false,
    note: "",
  });
  return persons;
}

/**
 * How the payment is made, as the lead (or the payer on the own link) stated
 * it in section 8 of the form; the intake's `billing` has these keys.
 */
export type DeclaredPaymentRoute = {
  /** `payer`: the third-party payer states the route; `patient`: the lead or a paying parent. */
  payment_route_by: "patient" | "payer";
  payment_method: string | null;
  via_third_party: boolean | null;
};

/** Cash, crypto or a payment through a third party: no payment from the own account is to be expected. */
export function declaresNoOwnAccountPayment(route: DeclaredPaymentRoute | null | undefined): boolean {
  if (!route) return false;
  return route.payment_method === "cash" || route.payment_method === "crypto" || route.via_third_party === true;
}

/**
 * The lines that get the hint "no payment from the own account declared":
 * the line of the person whose payment the stated route describes — the
 * third-party payer when the payer states it, else the patient; for a minor
 * the paying parent, or every legal representative while it is not known
 * which of them pays. A payer who is one of the representatives is that
 * representative's line (the payer line only repeats it). The hint only
 * informs: the button stays.
 */
export function ownAccountHintSubjects(
  status: LeadIdentificationStatus,
  route: DeclaredPaymentRoute | null | undefined,
): Set<IdentificationSubject> {
  if (!declaresNoOwnAccountPayment(route)) return new Set();
  const payer = status.payer;
  const samePerson = payerSamePerson(status);
  if (samePerson) return new Set([samePerson.subject]);
  if (route?.payment_route_by === "payer" && payer) return new Set(["payer"]);
  if (status.minor) return new Set(status.representatives.map((representative) => representative.subject));
  return new Set(["contract_partner"]);
}

/** The hint below such a line. */
export function noOwnAccountPaymentHint(tx: Tx): string {
  return tx(
    "Оплата не с собственного счёта (наличные / через третье лицо) — подтверждение по § 12 GwG не ожидается",
    "Keine Zahlung vom eigenen Konto angegeben (bar / über Dritte) – Bestätigung nach § 12 GwG nicht zu erwarten",
  );
}

/** A minor without a parent or guardian on file: nobody can be identified yet. */
export function identificationLacksRepresentative(status: LeadIdentificationStatus): boolean {
  return status.minor && status.representatives.length === 0;
}

/**
 * The server refuses to confirm a payment for the child of a minor's request
 * (422 `identification_subject_minor`: an older wizard tab still shows the
 * patient's line), as one localized sentence; `null` for other errors.
 */
export function identificationErrorText(error: unknown, tx: Tx): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  if (![error.body?.code, error.body?.error, error.code].includes("identification_subject_minor")) return null;
  return tx(
    "Пациент несовершеннолетний: платёж подтверждается у законного представителя, а не у ребёнка. Обновите страницу",
    "Der Patient ist minderjährig: Die Zahlung wird bei der gesetzlichen Vertretung bestätigt, nicht beim Kind. Bitte die Seite aktualisieren",
  );
}

/**
 * The representative a third-party payer is the same person as (a parent who
 * also pays): staff identify that person once, as the representative.
 */
export function payerSamePerson(
  status: LeadIdentificationStatus | null | undefined,
): RepresentativeIdentification | null {
  const subject = status?.payer?.same_person_as;
  if (!status || !subject) return null;
  return status.representatives.find((representative) => representative.subject === subject) ?? null;
}
