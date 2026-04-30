type L = (de: string, ru: string, en: string) => string;

// Known backend entity_type codes -> localized label.
const ENTITY_TYPE_MAP: Record<string, [string, string, string]> = {
  patient: ["Patient", "Пациент", "Patient"],
  case: ["Fall", "Кейс", "Case"],
  order: ["Auftrag", "Заказ", "Order"],
  appointment: ["Termin", "Приём", "Appointment"],
  document: ["Dokument", "Документ", "Document"],
  contract: ["Vertrag", "Договор", "Contract"],
  invoice: ["Rechnung", "Счёт", "Invoice"],
  invoice_visibility: ["Rechnungssichtbarkeit", "Invoice visibility", "Invoice visibility"],
  recommendation: ["Empfehlung", "Recommendation", "Recommendation"],
  translation_request: ["Ubersetzungsanfrage", "Translation request", "Translation request"],
  interpreter_preference: ["Dolmetscher-Praeferenz", "Interpreter preference", "Interpreter preference"],
  drug_verification: ["Arznei-Verifikation", "Drug verification", "Drug verification"],
  service_package: ["Servicepaket", "Service package", "Service package"],
  service_package_change: ["Paketaenderung", "Package change", "Package change"],
  service_package_consumption: ["Paketverbrauch", "Package consumption", "Package consumption"],
  service_group: ["Leistungsgruppe", "Service group", "Service group"],
  compliance: ["Compliance", "Комплаенс", "Compliance"],
  task: ["Aufgabe", "Задача", "Task"],
  workflow_task: ["Workflow-Aufgabe", "Задача процесса", "Workflow task"],
  communication: ["Kommunikation", "Коммуникация", "Communication"],
  risk_score: ["Risikoscore", "Риск-скор", "Risk score"],
  card_entry: ["Karteneintrag", "Запись в карте", "Card entry"],
  vital: ["Vitalwert", "Показатель", "Vital"],
  medical_order: ["Medizinische Anordnung", "Мед. назначение", "Medical order"],
  relation: ["Beziehung", "Связь", "Relation"],
  note: ["Notiz", "Заметка", "Note"],
  reminder: ["Erinnerung", "Напоминание", "Reminder"],
  message: ["Nachricht", "Сообщение", "Message"],
  dunning: ["Mahnung", "Напоминание об оплате", "Dunning"],
  quote: ["Angebot", "Смета", "Quote"],
};

// Timeline category codes commonly used by the backend.
const CATEGORY_MAP: Record<string, [string, string, string]> = {
  clinical: ["Klinisch", "Клиническое", "Clinical"],
  administrative: ["Administrativ", "Административное", "Administrative"],
  financial: ["Finanziell", "Финансы", "Financial"],
  billing: ["Billing", "Биллинг", "Billing"],
  invoice_visibility: ["Rechnungssichtbarkeit", "Invoice visibility", "Invoice visibility"],
  interpreter_preference: ["Dolmetscher-Praeferenz", "Interpreter preference", "Interpreter preference"],
  drug_verification: ["Arznei-Verifikation", "Drug verification", "Drug verification"],
  service_package: ["Servicepaket", "Service package", "Service package"],
  package_consumption: ["Paketverbrauch", "Package consumption", "Package consumption"],
  service_group: ["Leistungsgruppe", "Service group", "Service group"],
  legal: ["Rechtlich", "Юридическое", "Legal"],
  compliance: ["Compliance", "Комплаенс", "Compliance"],
  communication: ["Kommunikation", "Коммуникация", "Communication"],
  care: ["Betreuung", "Уход", "Care"],
  intake: ["Intake", "Intake", "Intake"],
  followup: ["Nachsorge", "Follow-up", "Follow-up"],
  execution: ["Ausführung", "Исполнение", "Execution"],
  discovery: ["Entdeckung", "Обнаружение", "Discovery"],
  closure: ["Abschluss", "Закрытие", "Closure"],
  scheduling: ["Terminplanung", "Планирование", "Scheduling"],
  documents: ["Dokumente", "Документы", "Documents"],
  contracts: ["Verträge", "Договоры", "Contracts"],
  invoices: ["Rechnungen", "Счета", "Invoices"],
  appointments: ["Termine", "Приёмы", "Appointments"],
  orders: ["Aufträge", "Заказы", "Orders"],
  cases: ["Fälle", "Кейсы", "Cases"],
  workflow: ["Workflow", "Процесс", "Workflow"],
};

// Source labels (who created the event).
const SOURCE_MAP: Record<string, [string, string, string]> = {
  system: ["System", "Система", "System"],
  patient_manager: ["Patientenmanager", "Менеджер пациентов", "Patient manager"],
  interpreter: ["Dolmetscher", "Переводчик", "Interpreter"],
  concierge: ["Concierge", "Consierge", "Concierge"],
  billing: ["Billing", "Billing", "Billing"],
  ceo: ["CEO", "CEO", "CEO"],
  patient: ["Patient", "Пациент", "Patient"],
  staff: ["Mitarbeiter", "Сотрудник", "Staff"],
  automated: ["Automatisch", "Автоматически", "Automated"],
  portal: ["Portal", "Портал", "Portal"],
  clinic: ["Klinik", "Клиника", "Clinic"],
  doctor: ["Arzt", "Врач", "Doctor"],
};

function humanizeFallback(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function lookupOrHumanize(
  map: Record<string, [string, string, string]>,
  value: string | null | undefined,
  l: L,
): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const key = trimmed.toLowerCase();
  const entry = map[key];
  if (entry) return l(entry[0], entry[1], entry[2]);
  // snake_case code → humanize; already-human text → leave alone
  if (/^[a-z0-9][a-z0-9_-]*$/.test(trimmed)) return humanizeFallback(trimmed);
  return trimmed;
}

export function localizeTimelineEntityType(
  value: string | null | undefined,
  l: L,
): string {
  return lookupOrHumanize(ENTITY_TYPE_MAP, value, l);
}

export function localizeTimelineCategory(
  value: string | null | undefined,
  l: L,
): string {
  return lookupOrHumanize(CATEGORY_MAP, value, l);
}

export function localizeTimelineSource(
  value: string | null | undefined,
  l: L,
): string {
  return lookupOrHumanize(SOURCE_MAP, value, l);
}

const ENTITY_TYPE_BADGE_CLASS: Record<string, string> = {
  patient: "border-slate-200 bg-slate-50 text-slate-700",
  case: "border-violet-200 bg-violet-50 text-violet-700",
  order: "border-indigo-200 bg-indigo-50 text-indigo-700",
  appointment: "border-sky-200 bg-sky-50 text-sky-700",
  document: "border-teal-200 bg-teal-50 text-teal-700",
  contract: "border-amber-200 bg-amber-50 text-amber-700",
  invoice: "border-rose-200 bg-rose-50 text-rose-700",
  invoice_visibility: "border-rose-200 bg-rose-50 text-rose-700",
  recommendation: "border-blue-200 bg-blue-50 text-blue-700",
  translation_request: "border-cyan-200 bg-cyan-50 text-cyan-700",
  interpreter_preference: "border-sky-200 bg-sky-50 text-sky-700",
  drug_verification: "border-emerald-200 bg-emerald-50 text-emerald-700",
  service_package: "border-amber-200 bg-amber-50 text-amber-700",
  service_package_change: "border-amber-200 bg-amber-50 text-amber-700",
  service_package_consumption: "border-orange-200 bg-orange-50 text-orange-700",
  service_group: "border-indigo-200 bg-indigo-50 text-indigo-700",
  compliance: "border-emerald-200 bg-emerald-50 text-emerald-700",
  task: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  workflow_task: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  communication: "border-cyan-200 bg-cyan-50 text-cyan-700",
  risk_score: "border-orange-200 bg-orange-50 text-orange-700",
  card_entry: "border-lime-200 bg-lime-50 text-lime-700",
  vital: "border-pink-200 bg-pink-50 text-pink-700",
  medical_order: "border-blue-200 bg-blue-50 text-blue-700",
  relation: "border-purple-200 bg-purple-50 text-purple-700",
  note: "border-neutral-200 bg-neutral-50 text-neutral-700",
  reminder: "border-yellow-200 bg-yellow-50 text-yellow-700",
  message: "border-cyan-200 bg-cyan-50 text-cyan-700",
  dunning: "border-red-200 bg-red-50 text-red-700",
  quote: "border-green-200 bg-green-50 text-green-700",
};

export function timelineEntityTypeBadgeClass(
  value: string | null | undefined,
): string {
  if (!value) return "border-border/60 bg-muted/25 text-muted-foreground";
  const key = value.trim().toLowerCase();
  return (
    ENTITY_TYPE_BADGE_CLASS[key] ??
    "border-border/60 bg-muted/25 text-muted-foreground"
  );
}
