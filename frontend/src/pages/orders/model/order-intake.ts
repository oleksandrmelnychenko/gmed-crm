import { money } from "./order-service-presentation";
import { moneyLineAmounts, roundCents } from "@/lib/money";
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
  specialization_ids?: string[];
  selected_work_type_ids?: string[];
  cost_estimate_additional_language?: "" | "ru" | "en" | "es";
  catalog_snapshot?: {
    specializations: import("@/pages/providers/model/types").SpecializationItem[];
    work_types: import("@/pages/specializations/data/specialization-work-types-api").SpecializationWorkType[];
    services: import("@/pages/contracts/model/types").AgencyServiceItem[];
  };
  aml_review: { risk_reason: string; manager_approval_name: string; continuous_monitoring: string; reviewer_name: string; review_date: string | null };
};
export type IntakeCheck = { key: string; status: "passed" | "warning" | "blocked"; step: number;
  reason?: import("./order-document-review").PassportReviewStatus; expiry?: string | null };
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
// A framework contract has no validity period: once signed it covers any order until it is terminated.
export function isContractUsable(contract: Pick<ContractItem, "status">) {
  return contract.status === "signed";
}
export function formatIntakeDate(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return day && month && year ? `${day}.${month}.${year}` : value;
}
/** Gross order total, rounded per line like the server (`order_intakes::sync_services`). */
export function intakeTotal(lines: IntakeLine[]) {
  return roundCents(lines.reduce((sum, line) => {
    const { gross } = moneyLineAmounts(money(line.quantity), money(line.unit_price), money(line.vat_rate));
    return sum + (Number.isFinite(gross) ? gross : 0);
  }, 0));
}
export function changedFacts(before: IntakeFacts, after: IntakeFacts) {
  return (Object.keys(before) as (keyof IntakeFacts)[]).filter(key => before[key] !== after[key]);
}

export const INTAKE_CHECK_LABELS: Record<string, [string, string]> = {
  facts: ["Актуальные данные пациента подтверждены", "Aktuelle Patientendaten bestätigt"],
  period: ["Указаны цель и период заказа", "Auftragsziel und Zeitraum angegeben"],
  services: ["Услуги и стоимость сохранены", "Leistungen und Preise gespeichert"],
  contract: ["Подписанный рамочный договор действует", "Unterzeichneter Rahmenvertrag liegt vor"],
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
