type L = (de: string, ru: string, en: string) => string;

// Maps backend workflow_checklist item_key → localized text.
// Keys must match crates/server/src/routes/workflow_checklists.rs templates.
const ITEM_TEXT_MAP: Record<string, [string, string, string]> = {
  // patient_intake
  profile_verification: [
    "Kontakt-, Versicherungs- und Notfalldaten prüfen",
    "Проверить контактные, страховые и экстренные данные",
    "Verify contact, insurance and emergency data",
  ],
  compliance_readiness: [
    "DSGVO, Vertragsstatus und rechtliche Freigabe prüfen",
    "Проверить DSGVO, готовность договора и правовой статус",
    "Review DSGVO, contract readiness and legal status",
  ],
  document_pack_review: [
    "Erforderliche Patientendokumente und Upload-Lücken prüfen",
    "Аудит обязательных документов пациента и пробелов в загрузках",
    "Audit required patient documents and current upload gaps",
  ],
  language_support_needs: [
    "Sprach-, Reise- und Concierge-Bedarf bestätigen",
    "Подтвердить языковую, travel- и concierge-поддержку",
    "Confirm language, travel and concierge support needs",
  ],
  // order_discovery
  scope_review: [
    "Auftragsumfang prüfen und in Leistungsblöcke überführen",
    "Проверить объём заказа и преобразовать в сервисные блоки",
    "Review order scope and convert needs into service blocks",
  ],
  provider_shortlist: [
    "Klinik- und Arzt-Shortlist für die Ausführung vorbereiten",
    "Подготовить шорт-лист клиник и врачей для исполнения",
    "Prepare provider and doctor shortlist for execution",
  ],
  // order_intake
  intake_prerequisites: [
    "Intake-Voraussetzungen und Termin-Abhängigkeiten bestätigen",
    "Подтвердить требования intake и зависимости приёмов",
    "Confirm intake prerequisites and appointment dependencies",
  ],
  supporting_documents: [
    "Unterlagen der verknüpften Kliniken oder Ärzte prüfen",
    "Проверить документы связанных клиник или врачей",
    "Check supporting documents for linked clinics or doctors",
  ],
  // order_execution
  leistungen_tracking: [
    "Erbrachte Leistungen und ausstehende Freigaben verfolgen",
    "Отслеживать оказанные услуги и ожидающие согласования",
    "Track delivered Leistungen and pending approvals",
  ],
  concierge_handoff: [
    "Reise, Unterkunft oder externen Support-Handoff koordinieren",
    "Координировать поездку, проживание или внешнюю поддержку",
    "Coordinate travel, accommodation or external support handoff",
  ],
  // order_closure
  closure_readiness: [
    "Auftragsabschluss und Billing-Handoff prüfen",
    "Проверить готовность закрытия заказа и передачи в billing",
    "Validate order closure and billing handoff readiness",
  ],
  closure_notes: [
    "Medizinische und operative Abschlussnotizen erfassen",
    "Зафиксировать медицинские и операционные закрывающие заметки",
    "Capture medical and operational closure notes",
  ],
  // order_followup
  followup_plan: [
    "Nachsorge-Termine und Outreach nach Behandlung planen",
    "Запланировать follow-up визиты и пост-лечебную коммуникацию",
    "Plan follow-up visits and post-treatment outreach",
  ],
  final_release: [
    "Finale Dokumentenfreigabe und Patientenkommunikation bestätigen",
    "Подтвердить финальную выдачу документов и коммуникацию с пациентом",
    "Confirm final document release and patient communication",
  ],
};

// Maps backend checklist_key → localized group label.
const CHECKLIST_GROUP_MAP: Record<string, [string, string, string]> = {
  patient_intake: ["Patientenaufnahme", "Приём пациента", "Patient intake"],
  order_discovery: ["Auftrags-Entdeckung", "Обнаружение заказа", "Order discovery"],
  order_intake: ["Auftrags-Intake", "Intake заказа", "Order intake"],
  order_execution: ["Auftragsausführung", "Исполнение заказа", "Order execution"],
  order_closure: ["Auftragsabschluss", "Закрытие заказа", "Order closure"],
  order_followup: ["Nachsorge", "Follow-up", "Follow-up"],
};

export function localizeWorkflowItemText(
  itemKey: string | null | undefined,
  fallbackText: string,
  l: L,
): string {
  if (!itemKey) return fallbackText;
  const entry = ITEM_TEXT_MAP[itemKey];
  if (entry) return l(entry[0], entry[1], entry[2]);
  return fallbackText;
}

export function localizeWorkflowGroupLabel(
  checklistKey: string | null | undefined,
  fallbackLabel: string,
  l: L,
): string {
  if (!checklistKey) return fallbackLabel;
  const entry = CHECKLIST_GROUP_MAP[checklistKey];
  if (entry) return l(entry[0], entry[1], entry[2]);
  return fallbackLabel;
}
