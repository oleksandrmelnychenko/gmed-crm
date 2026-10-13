import type { PatientAccountMovement, PatientAccountStatementItem } from "./detail-tab-types";

type Pair = [de: string, ru: string];

function pick(pair: Pair | undefined, lang: string, fallback: string) {
  if (!pair) return fallback;
  return lang === "de" ? pair[0] : pair[1];
}

const STATEMENT_ITEM_KIND_LABELS: Record<PatientAccountStatementItem["kind"], Pair> = {
  invoice: ["Rechnung", "Счёт"],
  prepayment: ["Vorauszahlung", "Предоплата"],
  credit_note: ["Gutschrift", "Кредит-нота"],
  credit_note_reversal: ["Gutschriftstorno", "Сторно кредит-ноты"],
  external_expense: ["Externe Kosten", "Внешние расходы"],
  service: ["Leistung", "Услуга"],
};

/**
 * Label of a document/service row of the patient account statement. The
 * server adds kinds over time (credit notes); an unknown kind must never break
 * the patient page, so it falls back to the raw value.
 */
export function accountStatementKindLabel(kind: string, lang: string) {
  return pick(STATEMENT_ITEM_KIND_LABELS[kind as PatientAccountStatementItem["kind"]], lang, kind);
}

const STATEMENT_STATE_LABELS: Record<string, Pair> = {
  reconciled_to_patient_invoice: [
    "Patientenrechnung zugeordnet",
    "Распределено по счёту пациента",
  ],
  paid: ["Bezahlt", "Оплачено"],
  partially_paid: ["Teilbezahlt – Rest offen", "Оплачено частично — требуется доплата"],
  unpaid: ["Nicht bezahlt", "Не оплачено"],
  not_issued: ["Noch nicht ausgestellt", "Ещё не выставлено"],
  amount_hidden: ["Betrag ausgeblendet", "Сумма скрыта"],
  invoice_adjustment: ["Rechnung korrigiert", "Счёт скорректирован"],
  credited: ["Storniert (Gutschrift)", "Сторнирован кредит-нотой"],
  patient_paid: ["Vom Patienten bezahlt", "Оплачено пациентом"],
  gmed_paid_patient_due: ["Von GMED bezahlt – Patient schuldet", "Оплачено GMED — долг пациента"],
  order_service_cost: [
    "GMED-Kosten – über die Auftragsleistung berechnet",
    "Расход GMED — пациенту выставляется услуга заказа",
  ],
  rebilling_waived: [
    "Trägt GMED – nicht weiterberechnet",
    "За счёт GMED — не перевыставляется",
  ],
  provider_unpaid_patient_due: [
    "Anbieter offen – Patient schuldet nach Leistung",
    "Поставщику не оплачено — долг пациента за оказанную услугу",
  ],
  provider_unpaid: ["Anbieter noch nicht bezahlt", "Поставщику ещё не оплачено"],
  not_invoiced: ["Noch nicht fakturiert", "Ещё не выставлено в счёт"],
  partially_invoiced: ["Teilweise fakturiert", "Частично выставлено в счёт"],
  invoiced: ["Fakturiert", "Выставлено в счёт"],
};

export function accountStatementStateLabel(state: string, lang: string) {
  return pick(STATEMENT_STATE_LABELS[state], lang, state);
}

const MOVEMENT_KIND_LABELS: Record<PatientAccountMovement["kind"], Pair> = {
  invoice: ["Patientenrechnung", "Счёт пациента"],
  credit_note: ["Gutschrift", "Кредит-нота"],
  credit_note_reversal: ["Gutschriftstorno", "Сторно кредит-ноты"],
  storno: ["Stornorechnung", "Документ сторно"],
  payment: ["Zahlung", "Оплата"],
  payment_reversal: ["Zahlungsstorno", "Сторно оплаты"],
  refund: ["Rückzahlung", "Возврат пациенту"],
  refund_reversal: ["Rückzahlungsstorno", "Сторно возврата"],
  balance_adjustment: ["Kontokorrektur", "Корректировка баланса"],
  balance_adjustment_reversal: ["Korrekturstorno", "Сторно корректировки"],
  external_receivable: ["Externe Forderung", "Внешний долг"],
  external_allocation: ["Forderung zugeordnet", "Долг распределён"],
  external_allocation_reversal: ["Zuordnung storniert", "Сторно распределения"],
  external_rebilling_waiver_reversal: ["Storno der Kostenübernahme durch GMED", "Отмена расхода за счёт GMED"],
  external_rebilling_waived: ["Kosten trägt GMED", "Расход за счёт GMED"],
  termination_uninvoiced: [
    "Kündigung: angefallen, noch nicht berechnet",
    "Расторжение: набежало, ещё не выставлено",
  ],
  termination_to_credit: [
    "Kündigung: vorab berechnet, nicht erbracht (gutzuschreiben)",
    "Расторжение: выставлено авансом, не оказано (к сторнированию)",
  ],
  // A credit transfer between two invoices moves credit, no money (QA D3-05).
  credit_transfer_out: ["Guthabenumbuchung auf andere Rechnung", "Зачёт переплаты в другой счёт"],
  credit_transfer_in: ["Guthabenumbuchung aus anderer Rechnung", "Зачёт переплаты из другого счёта"],
  credit_transfer_out_reversal: ["Storno der Guthabenumbuchung", "Сторно зачёта переплаты"],
  credit_transfer_in_reversal: ["Storno der Guthabenumbuchung", "Сторно зачёта переплаты"],
};

const CREDIT_TRANSFER_OUT = "Credit applied to invoice ";
const CREDIT_TRANSFER_IN = "Credit from invoice ";
const CREDIT_TRANSFER_OUT_REVERSAL = "Reversal of credit applied to invoice ";
const CREDIT_TRANSFER_IN_REVERSAL = "Reversal of credit from invoice ";

/**
 * A credit transfer between two invoices of the patient is stored as a refund
 * on the source invoice and a payment on the target; neither is cash moving.
 */
function isCreditTransfer(movement: Pick<PatientAccountMovement, "description">) {
  const description = movement.description ?? "";
  return description.startsWith(CREDIT_TRANSFER_OUT) || description.startsWith(CREDIT_TRANSFER_IN);
}

export function accountMovementKindLabel(
  movement: Pick<PatientAccountMovement, "kind" | "description">,
  lang: string,
) {
  if (isCreditTransfer(movement) && (movement.kind === "refund" || movement.kind === "payment")) {
    return lang === "de" ? "Guthabenumbuchung" : "Перенос переплаты";
  }
  if (isCreditTransfer(movement) && (movement.kind === "refund_reversal" || movement.kind === "payment_reversal")) {
    return lang === "de" ? "Storno der Guthabenumbuchung" : "Сторно переноса переплаты";
  }
  return pick(MOVEMENT_KIND_LABELS[movement.kind], lang, movement.kind);
}

const FINANCIAL_DESCRIPTIONS: Record<string, Pair> = {
  "Patient invoice": ["Patientenrechnung", "Счёт пациента"],
  "Advance payment": ["Vorauszahlung", "Предоплата"],
  "Payment received": ["Zahlung erhalten", "Оплата получена"],
  "Advance payment received": ["Vorauszahlung erhalten", "Предоплата получена"],
  "Payment reversal": ["Zahlungsstorno", "Сторно оплаты"],
  "Invoice adjustment": ["Rechnungskorrektur", "Корректировка счёта"],
  "Account adjustment": ["Kontokorrektur", "Корректировка баланса"],
  "Payment opening balance": ["Zahlungsanfangsbestand", "Начальный остаток оплаты"],
  "Advance payment opening balance": ["Anfangsbestand Vorauszahlung", "Начальный остаток предоплаты"],
  "Patient invoice cancelled; external receivable reopened": [
    "Patientenrechnung storniert; externe Forderung wieder geöffnet",
    "Счёт пациента отменён; внешний долг снова открыт",
  ],
  "External provider": ["Externer Anbieter", "Внешний поставщик"],
  "External receivable allocation reversed": [
    "Forderungszuordnung storniert",
    "Распределение внешнего долга сторнировано",
  ],
  "Termination settlement: accrued, not yet invoiced": [
    "Kündigung: angefallen, noch nicht berechnet",
    "Расторжение: набежало, ещё не выставлено",
  ],
  "Termination settlement: invoiced in advance, not delivered": [
    "Kündigung: vorab berechnet, nicht erbracht",
    "Расторжение: выставлено авансом, не оказано",
  ],
};

/**
 * German document texts the server stores as descriptions (credit-note and
 * reversal reasons it writes itself), worded in the RU UI (QA D2-05).
 */
const GERMAN_DESCRIPTION_PATTERNS: Array<[RegExp, (match: RegExpExecArray) => Pair]> = [
  [
    /^Restbetrag der Anzahlungsrechnung (.+?) – abgerechnet mit der Schlussrechnung (.+)$/,
    (match) => [match[0], `Остаток авансового счёта ${match[1]} — закрыт финальным счётом ${match[2]}`],
  ],
  [
    /^Rechnungskorrektur \(Gutschrift\) zu (.+)$/,
    (match) => [match[0], `Кредит-нота к счёту ${match[1]}`],
  ],
  [/^Stornierung der Rechnung (.+)$/, (match) => [match[0], `Отмена счёта ${match[1]}`]],
];

const FINANCIAL_DESCRIPTION_PREFIXES: Array<[string, Pair]> = [
  ["Cancellation of invoice ", ["Stornierung der Rechnung ", "Отмена счёта "]],
  ["Concierge partner payment reversal", ["Storno der Zahlung an Concierge-Partner", "Сторно оплаты партнёру консьержа"]],
  ["Concierge partner payment", ["Zahlung an Concierge-Partner", "Оплата партнёру консьержа"]],
  [CREDIT_TRANSFER_OUT_REVERSAL, ["Storno der Guthabenverrechnung mit Rechnung ", "Сторно зачёта переплаты в счёт "]],
  [CREDIT_TRANSFER_IN_REVERSAL, ["Storno des Guthabens aus Rechnung ", "Сторно зачёта переплаты из счёта "]],
  [CREDIT_TRANSFER_OUT, ["Guthaben verrechnet mit Rechnung ", "Переплата зачтена в счёт "]],
  [CREDIT_TRANSFER_IN, ["Guthaben aus Rechnung ", "Переплата из счёта "]],
  // Supplier payouts in the patient card's accounting ledger (QA D2-05 remark).
  ["Provider payment reversal ", ["Storno der Zahlung an Leistungserbringer ", "Сторно оплаты поставщику "]],
  ["Provider payment ", ["Zahlung an Leistungserbringer ", "Оплата поставщику "]],
  ["External invoice payment ", ["Zahlung der Eingangsrechnung ", "Оплата счёта поставщика "]],
  // Accounting ledger entries are described as "<kind> <transaction> <invoice>".
  ["invoice_payment payment ", ["Zahlung zu Rechnung ", "Оплата по счёту "]],
  ["invoice_payment reversal ", ["Zahlungsstorno zu Rechnung ", "Сторно оплаты по счёту "]],
  ["invoice_refund refund ", ["Erstattung zu Rechnung ", "Возврат по счёту "]],
  ["invoice_refund reversal ", ["Erstattungsstorno zu Rechnung ", "Сторно возврата по счёту "]],
];

/** Server descriptions of statement rows are English; show them in the UI language. */
export function localizeFinancialDescription(value: string, lang: string): string {
  const direct = FINANCIAL_DESCRIPTIONS[value];
  if (direct) return pick(direct, lang, value);
  // "<provider> -> <invoice>": a supplier cost allocated to a patient invoice.
  const arrow = value.indexOf(" -> ");
  if (arrow > 0) {
    return `${localizeFinancialDescription(value.slice(0, arrow), lang)} → ${value.slice(arrow + 4)}`;
  }
  for (const [pattern, words] of GERMAN_DESCRIPTION_PATTERNS) {
    const match = pattern.exec(value);
    if (match) return pick(words(match), lang, value);
  }
  for (const [prefix, labels] of FINANCIAL_DESCRIPTION_PREFIXES) {
    if (value.startsWith(prefix)) {
      return `${pick(labels, lang, prefix)}${value.slice(prefix.length)}`;
    }
  }
  return value;
}
