import type { ContractItem } from "@/pages/contracts/model/types";

export type IntakeFacts = {
  insurance_type: string; insurance_provider: string; insurance_number: string;
  phone_primary: string; email: string;
  address_street: string; address_city: string; address_zip: string; address_country: string;
  pep_contract_partner: boolean | null; pep_beneficial_owner: boolean | null;
  pep_office: string; pep_asset_origin: string;
  representative_name: string; representative_phone: string; representative_authority: string;
};
export type IntakeLine = {
  id: string; description: string; quantity: string; unit_price: string; vat_rate: string;
  agency_service_id: string | null; agency_service_price_version_id: string | null;
};
export type IntakeDraft = {
  step: number; facts: IntakeFacts; needs_description: string;
  date_from: string | null; date_to: string | null; case_id: string | null; contract_id: string | null;
  lines: IntakeLine[]; prepayment_required: boolean; prepayment_amount: string; prepayment_due_at: string | null;
  aml_review: { risk_reason: string; manager_approval_name: string; continuous_monitoring: string; reviewer_name: string; review_date: string | null };
};
export type IntakeCheck = { key: string; status: "passed" | "warning" | "blocked"; step: number };
export type IntakeWorkspace = {
  order_id: string; patient_id: string; order_number: string; intake_state: "draft" | "confirmed";
  revision: number; data: IntakeDraft; current_facts: IntakeFacts; baseline_facts: IntakeFacts;
  confirmed_facts: IntakeFacts | null; facts_confirmed_at: string | null;
  checks: IntakeCheck[]; current_document_ids: string[];
};
export type IntakeAction = "save" | "reload_facts" | "confirm_facts" | "prepare" | "review_documents" | "confirm";

export function emptyIntake(facts: IntakeFacts): IntakeDraft {
  return { step: 0, facts, needs_description: "", date_from: null, date_to: null, case_id: null,
    contract_id: null, lines: [], prepayment_required: false, prepayment_amount: "", prepayment_due_at: null,
    aml_review: { risk_reason: "", manager_approval_name: "", continuous_monitoring: "", reviewer_name: "", review_date: null } };
}
export function contractCoversOrder(contract: Pick<ContractItem, "status" | "valid_from" | "valid_to">, from: string | null, to: string | null) {
  return !!from && !!to && from <= to && contract.status === "signed"
    && (!contract.valid_from || contract.valid_from <= from) && (!contract.valid_to || contract.valid_to >= to);
}
export function formatIntakeDate(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return day && month && year ? `${day}.${month}.${year}` : value;
}
export function intakeTotal(lines: IntakeLine[]) {
  return lines.reduce((sum, line) => {
    const net = Math.round(Number(line.quantity) * Number(line.unit_price) * 100);
    return sum + (Number.isFinite(net) ? net + Math.round(net * Number(line.vat_rate) / 100) : 0);
  }, 0) / 100;
}
export function changedFacts(before: IntakeFacts, after: IntakeFacts) {
  return (Object.keys(before) as (keyof IntakeFacts)[]).filter(key => before[key] !== after[key]);
}

export const INTAKE_CHECK_LABELS: Record<string, [string, string]> = {
  facts: ["Актуальные данные пациента подтверждены", "Aktuelle Patientendaten bestätigt"],
  period: ["Указаны цель и период заказа", "Auftragsziel und Zeitraum angegeben"],
  services: ["Услуги и стоимость сохранены", "Leistungen und Preise gespeichert"],
  contract: ["Подписанный договор покрывает весь период", "Unterzeichneter Vertrag deckt den gesamten Zeitraum ab"],
  base_data_ready: ["Основные данные заполнены", "Stammdaten vollständig"],
  compliance_ready: ["Проверка и согласие на обработку данных", "Prüfung und Datenschutz-Einwilligung"],
  identity_ready: ["Личность подтверждена", "Identität bestätigt"],
  document_pack_ready: ["Обязательные документы пациента", "Erforderliche Patientendokumente"],
  confidentiality_release_ready: ["Освобождение от врачебной тайны", "Schweigepflichtentbindung"],
  debt_clear: ["Нет блокировки из-за задолженности", "Keine Schuldensperre"],
  single_order: ["Актуальная версия заказа подписана", "Aktuelle Auftragsversion unterschrieben"],
  quote: ["Смета соответствует услугам", "Kostenvoranschlag entspricht den Leistungen"],
  pep_evidence: ["Актуальная проверка PEP подписана", "Aktuelle PEP-Prüfung unterschrieben"],
  pep_review: ["Указаны результат и ответственные за проверку PEP", "PEP-Prüfung und Verantwortliche dokumentiert"],
  passport: ["Проверьте срок действия паспорта", "Gültigkeit des Passes prüfen"],
};
