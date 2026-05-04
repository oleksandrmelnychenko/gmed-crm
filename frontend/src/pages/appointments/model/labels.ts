import {
  formatUnknownValue,
  getLang,
  t as translateCatalog,
  type Translations,
} from "@/lib/i18n";
import type {
  AppointmentCarePathKind,
  AppointmentCommunicationChannel,
  AppointmentCommunicationStatus,
  AppointmentCommunicationTarget,
  AppointmentDetail,
  AppointmentRecurrenceFrequency,
  AppointmentKind,
  AppointmentStatus,
  BillingHandoffKind,
  DoctorOption,
  FindingsFollowUpArtifact,
  IncomingDataCategory,
  IncomingDataSource,
  InterpreterResponse,
  PatientSummary,
  ProviderSummary,
} from "@/pages/appointments/model/types";

function runtimeTranslations() {
  return translateCatalog(getLang());
}

function unknownAppointmentValue(value: unknown) {
  return formatUnknownValue(value, runtimeTranslations());
}

export function appointmentText(de: string, ru: string, _en: string) {
  void _en;
  return getLang() === "ru" ? ru : de;
}

export function roleLabel(role?: string | null) {
  const tr = runtimeTranslations();
  if (!role) return "";
  const translated = tr[`role_${role}` as keyof typeof tr];
  return typeof translated === "string"
    ? translated
    : unknownAppointmentValue(role);
}

export function appointmentTypeLabel(
  type: AppointmentKind,
  tr?: Record<string, string>,
) {
  if (type === "non_medical") {
    return (
      tr?.apt_type_non_medical ??
      appointmentText("Nicht-medizinisch", "Немедицинский", "Non-medical")
    );
  }
  if (type === "internal") {
    return tr?.apt_type_internal ?? appointmentText("Intern", "Внутренний", "Internal");
  }
  return tr?.apt_type_medical ?? appointmentText("Medizinisch", "Медицинский", "Medical");
}

export function carePathKindLabel(value?: string | null) {
  switch (value) {
    case "preventive":
      return appointmentText("Praventiv", "Профилактика", "Preventive");
    case "control":
      return appointmentText("Kontrolle", "Контроль", "Control");
    case "followup":
      return appointmentText("Nachsorge", "Наблюдение", "Follow-up");
    case "regular":
      return appointmentText("Standard", "Стандартный", "Regular");
    default:
      return appointmentText("Standard", "Стандартный", "Regular");
  }
}

export function normalizeCarePathKindForAppointmentType(
  appointmentType: AppointmentKind,
  carePathKind: AppointmentCarePathKind,
): AppointmentCarePathKind {
  return appointmentType === "medical" ? carePathKind : "regular";
}

export function statusLabel(status: AppointmentStatus) {
  switch (status) {
    case "planned":
      return appointmentText("Geplant", "Запланирован", "Planned");
    case "confirmed":
      return appointmentText("Bestatigt", "Подтверждён", "Confirmed");
    case "in_progress":
      return appointmentText("Lauft", "В процессе", "In progress");
    case "completed":
      return appointmentText("Abgeschlossen", "Завершён", "Completed");
    case "cancelled":
      return appointmentText("Abgesagt", "Отменён", "Cancelled");
  }
}

export function communicationStatusLabel(
  status: AppointmentCommunicationStatus,
) {
  switch (status) {
    case "planned":
      return appointmentText("Geplant", "Запланировано", "Planned");
    case "sent":
      return appointmentText("Gesendet", "Отправлено", "Sent");
    case "answered":
      return appointmentText("Beantwortet", "Получен ответ", "Answered");
    case "closed":
      return appointmentText("Geschlossen", "Закрыто", "Closed");
    case "cancelled":
      return appointmentText("Abgebrochen", "Отменено", "Cancelled");
  }
  return unknownAppointmentValue(status);
}

export function communicationChannelLabel(
  channel: AppointmentCommunicationChannel,
) {
  switch (channel) {
    case "phone":
      return appointmentText("Telefon", "Телефон", "Phone");
    case "email":
      return appointmentText("E-Mail", "Эл. почта", "Email");
    case "portal":
      return appointmentText("Portal", "Портал", "Portal");
    case "fax":
      return appointmentText("Fax", "Факс", "Fax");
    case "whatsapp":
      return "WhatsApp";
    case "other":
      return appointmentText("Anderer Kanal", "Другой канал", "Other");
  }
  return unknownAppointmentValue(channel);
}

export function communicationTargetLabel(
  target: AppointmentCommunicationTarget,
  detail?: AppointmentDetail | null,
) {
  switch (target) {
    case "doctor":
      return detail?.doctor_name || appointmentText("Arzt", "Врач", "Doctor");
    case "service_provider":
      return (
        detail?.provider_name ||
        appointmentText("Leistungserbringer", "Поставщик услуг", "Service provider")
      );
    default:
      return detail?.provider_name || appointmentText("Klinik", "Клиника", "Clinic");
  }
}

export function responseLabel(value: InterpreterResponse) {
  switch (value) {
    case "pending":
      return appointmentText("Ausstehend", "Ожидается", "Pending");
    case "accepted":
      return appointmentText("Bestatigt", "Подтверждено", "Accepted");
    case "declined":
      return appointmentText("Abgelehnt", "Отклонено", "Declined");
    case "discussion":
      return appointmentText(
        "Klärung erforderlich",
        "Нужно уточнение",
        "Needs discussion",
      );
  }
}

export function attentionIssueLabel(count: number) {
  return count === 1
    ? appointmentText("offener Punkt", "открытый пункт", "open issue")
    : appointmentText("offene Punkte", "открытые пункты", "open issues");
}

export function reportApprovalLabel(status: string) {
  switch (status) {
    case "approved":
      return appointmentText("Freigegeben", "Согласовано", "Approved");
    case "rejected":
      return appointmentText("Zuruckgewiesen", "Отклонено", "Rejected");
    case "pending_review":
      return appointmentText("Prufung ausstehend", "Ожидает проверки", "Pending review");
    case "needs_interpreter_revision":
      return appointmentText(
        "Uberarbeitung durch Dolmetscher",
        "Нужна доработка переводчика",
        "Needs interpreter revision",
      );
    default:
      return unknownAppointmentValue(status);
  }
}

export function interpreterReportBillingSyncLabel(
  status: string | null | undefined,
  t: Translations,
) {
  switch (status) {
    case "synced":
      return t.appointments_billing_sync_synced;
    case "missing_catalog":
      return t.appointments_billing_sync_missing_catalog;
    case "missing_order":
      return t.appointments_billing_sync_missing_order;
    case "pending_sync":
      return t.appointments_billing_sync_pending;
    default:
      return t.appointments_billing_sync_none;
  }
}

export function patientName(patient: PatientSummary) {
  const name = `${patient.first_name ?? ""} ${patient.last_name ?? ""}`.trim();
  return name || patient.patient_id;
}

export function doctorLabel(doctor: DoctorOption) {
  return doctor.fachbereich
    ? `${doctor.name} (${doctor.fachbereich})`
    : doctor.name;
}

export function providerLabel(provider: ProviderSummary) {
  return provider.address_city
    ? `${provider.name} · ${provider.address_city}`
    : provider.name;
}

export function staffLabel(option: { name: string; role: string }) {
  return `${option.name} · ${roleLabel(option.role)}`;
}

export function recurrenceFrequencyLabel(
  value: AppointmentRecurrenceFrequency,
) {
  switch (value) {
    case "daily":
      return appointmentText("Taglich", "Ежедневно", "Daily");
    case "weekly":
      return appointmentText("Wochentlich", "Еженедельно", "Weekly");
    case "monthly":
      return appointmentText("Monatlich", "Ежемесячно", "Monthly");
    default:
      return unknownAppointmentValue(value);
  }
}

export function findingsArtifactLabel(value: FindingsFollowUpArtifact) {
  switch (value) {
    case "arztbrief":
      return "Arztbrief";
    case "written_findings":
      return appointmentText("Schriftlicher Befund", "Письменное заключение", "Written findings");
    case "both":
      return appointmentText(
        "Arztbrief und schriftlicher Befund",
        "Arztbrief и письменное заключение",
        "Arztbrief and written findings",
      );
    default:
      return unknownAppointmentValue(value);
  }
}

export function incomingDataSourceLabel(value: IncomingDataSource) {
  switch (value) {
    case "patient":
      return appointmentText("Patient", "Пациент", "Patient");
    case "doctor":
      return appointmentText("Arzt", "Врач", "Doctor");
    case "clinic":
      return appointmentText("Klinik", "Клиника", "Clinic");
    case "interpreter":
      return appointmentText("Dolmetscher", "Переводчик", "Interpreter");
    case "external_lab":
      return appointmentText("Externes Labor", "Внешняя лаборатория", "External lab");
    case "other":
      return appointmentText("Andere Quelle", "Другой источник", "Other source");
    default:
      return unknownAppointmentValue(value);
  }
}

export function incomingDataCategoryLabel(value: IncomingDataCategory) {
  switch (value) {
    case "medical_update":
      return appointmentText("Medizinisch", "Медицинское", "Medical");
    case "diagnosis":
      return appointmentText("Diagnose", "Диагноз", "Diagnosis");
    case "medication":
      return appointmentText("Medikation", "Назначения", "Medication");
    case "symptom":
      return appointmentText("Symptome", "Симптомы", "Symptoms");
    case "lab_result":
      return appointmentText("Laborergebnis", "Результат анализа", "Lab result");
    case "imaging":
      return appointmentText("Bildgebung", "Визуализация", "Imaging");
    case "recommendation":
      return appointmentText("Empfehlung", "Рекомендация", "Recommendation");
    case "risk_flag":
      return appointmentText("Risikohinweis", "Флаг риска", "Risk flag");
    case "other":
      return appointmentText("Sonstiges", "Другое", "Other");
    default:
      return unknownAppointmentValue(value);
  }
}

export function taskStatusLabel(status: string) {
  switch (status) {
    case "open":
      return appointmentText("Offen", "Открыта", "Open");
    case "in_progress":
      return appointmentText("In Bearbeitung", "В работе", "In progress");
    case "completed":
      return appointmentText("Erledigt", "Завершена", "Completed");
    case "cancelled":
      return appointmentText("Abgebrochen", "Отменена", "Cancelled");
    default:
      return unknownAppointmentValue(status);
  }
}

export function taskPriorityLabel(priority: string) {
  switch (priority) {
    case "low":
      return appointmentText("Niedrig", "Низкий", "Low");
    case "medium":
      return appointmentText("Mittel", "Средний", "Medium");
    case "high":
      return appointmentText("Hoch", "Высокий", "High");
    case "urgent":
      return appointmentText("Dringend", "Срочно", "Urgent");
    default:
      return unknownAppointmentValue(priority);
  }
}

export function billingHandoffKindLabel(kind: BillingHandoffKind) {
  switch (kind) {
    case "interpreter_hours":
      return appointmentText("Dolmetscherstunden", "Часы переводчика", "Interpreter hours");
    case "concierge_settlement":
      return appointmentText("Concierge-Abrechnung", "Расчёт concierge", "Concierge settlement");
    case "patient_invoice":
      return appointmentText("Patientenrechnung", "Счёт пациенту", "Patient invoice");
    case "provider_invoice":
      return appointmentText("Rechnung des Providers", "Счёт провайдера", "Provider invoice");
    case "payment_confirmation":
      return appointmentText("Zahlungsbestätigung", "Подтверждение оплаты", "Payment confirmation");
    case "other":
      return appointmentText("Sonstiges", "Другое", "Other");
    default:
      return unknownAppointmentValue(kind);
  }
}

export function serviceKindLabel(kind: string) {
  return unknownAppointmentValue(kind);
}

export function billingStatusLabel(status: string) {
  switch (status) {
    case "draft":
      return appointmentText("Entwurf", "Черновик", "Draft");
    case "planned":
      return appointmentText("Geplant", "Запланировано", "Planned");
    case "ready":
      return appointmentText("Bereit", "Готово", "Ready");
    case "submitted":
      return appointmentText("Ubergeben", "Передано", "Submitted");
    case "approved":
      return appointmentText("Freigegeben", "Согласовано", "Approved");
    case "settled":
      return appointmentText("Abgerechnet", "Рассчитано", "Settled");
    case "paid":
      return appointmentText("Bezahlt", "Оплачено", "Paid");
    case "cancelled":
      return appointmentText("Abgebrochen", "Отменено", "Cancelled");
    default:
      return unknownAppointmentValue(status);
  }
}
