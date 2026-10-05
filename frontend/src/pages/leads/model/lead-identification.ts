/**
 * Identification of a lead's contract partners by qualified electronic
 * signature (§ 12 Abs. 1 GwG, owner decision 2026-10-05): a completed QES of
 * the person counts as the identification, and staff confirm by hand that the
 * payment arrived from an account in that person's own name. The labels only
 * inform — nothing is blocked by them.
 */
import type { StatusTone } from "@/components/ui-shell";
import { formatAppDate } from "@/lib/app-time-zone";

export type Tx = (ru: string, de: string) => string;

/** The patient or, when somebody else pays, the third-party payer. */
export type IdentificationSubject = "contract_partner" | "payer";

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

export type LeadIdentificationStatus = {
  contract_partner: PersonIdentification;
  /** `null` unless the payer declaration names a third party. */
  payer: PersonIdentification | null;
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

/**
 * The server response; `null` for anything that is not an identification
 * status (an older backend, an unexpected proxy reply), so nothing is claimed
 * about a state that is not known.
 */
export function normalizeLeadIdentificationStatus(value: unknown): LeadIdentificationStatus | null {
  const record = asRecord(value);
  const contractPartner = asRecord(record?.contract_partner);
  if (!record || !contractPartner) return null;
  const payer = asRecord(record.payer);
  return {
    contract_partner: normalizePerson(contractPartner),
    payer: payer ? normalizePerson(payer) : null,
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
  /** The person's role in the lead, as the line is captioned. */
  role: string;
  person: PersonIdentification;
};

/** The lines of the block: the patient, and the payer only when a third party pays. */
export function identificationPersons(status: LeadIdentificationStatus, tx: Tx): IdentificationPerson[] {
  const persons: IdentificationPerson[] = [
    { subject: "contract_partner", role: tx("Пациент", "Patient/in"), person: status.contract_partner },
  ];
  if (status.payer) {
    persons.push({ subject: "payer", role: tx("Плательщик", "Kostenübernehmer"), person: status.payer });
  }
  return persons;
}
