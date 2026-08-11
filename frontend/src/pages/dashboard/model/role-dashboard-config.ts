import type { Lang } from "@/lib/i18n";

export type RoleDashboardMetricFormat =
  | "number"
  | "currency"
  | "percent"
  | "hours"
  | "days"
  | "score";

export type RoleDashboardMetric = {
  key: string;
  label: string;
  hint: string;
  format: RoleDashboardMetricFormat;
};

export type RoleDashboardDefinition = {
  eyebrow: string;
  subtitle: string;
  metrics: RoleDashboardMetric[];
  focus: string[];
  preview: Record<string, unknown>;
};

type Localized = { ru: string; de: string };

const l = (lang: Lang, value: Localized) => value[lang];

const metric = (
  lang: Lang,
  key: string,
  label: Localized,
  hint: Localized,
  format: RoleDashboardMetricFormat = "number",
): RoleDashboardMetric => ({ key, label: l(lang, label), hint: l(lang, hint), format });

export function roleDashboardDefinition(role: string, lang: Lang): RoleDashboardDefinition {
  switch (role) {
    case "ceo_assistant":
      return {
        eyebrow: l(lang, { ru: "Координация руководителя", de: "Geschäftsführungskoordination" }),
        subtitle: l(lang, {
          ru: "Задачи, сроки и решения, которые требуют внимания руководства",
          de: "Aufgaben, Fristen und Entscheidungen für die Geschäftsführung",
        }),
        metrics: [
          metric(lang, "open_tasks", { ru: "Открытые задачи", de: "Offene Aufgaben" }, { ru: "ваша очередь", de: "Ihre Warteschlange" }),
          metric(lang, "overdue_tasks", { ru: "Просрочено", de: "Überfällig" }, { ru: "требует эскалации", de: "Eskalation nötig" }),
          metric(lang, "appointments_next_7d", { ru: "Приёмы на 7 дней", de: "Termine in 7 Tagen" }, { ru: "общая координация", de: "Koordinationsbedarf" }),
          metric(lang, "active_orders", { ru: "Активные заказы", de: "Aktive Aufträge" }, { ru: "операционный контур", de: "operativer Bestand" }),
          metric(lang, "qualified_leads", { ru: "Квалифицированные лиды", de: "Qualifizierte Leads" }, { ru: "готовы к решению", de: "entscheidungsbereit" }),
          metric(lang, "open_checklist_items", { ru: "Пункты контроля", de: "Offene Prüfpunkte" }, { ru: "не закрыты", de: "noch offen" }),
        ],
        focus: [
          l(lang, { ru: "Снять блокировки по просроченным задачам", de: "Blockaden bei überfälligen Aufgaben lösen" }),
          l(lang, { ru: "Подготовить решения и материалы для CEO", de: "Entscheidungen und Unterlagen für den CEO vorbereiten" }),
          l(lang, { ru: "Синхронизировать встречи и ответственных", de: "Termine und Verantwortliche synchronisieren" }),
        ],
        preview: { open_tasks: 8, overdue_tasks: 2, appointments_next_7d: 14, active_orders: 12, qualified_leads: 5, open_checklist_items: 7 },
      };
    case "patient_manager":
      return {
        eyebrow: l(lang, { ru: "Пациенты и сопровождение", de: "Patienten & Betreuung" }),
        subtitle: l(lang, { ru: "Ваши пациенты, незакрытые задачи и контроль готовности", de: "Ihre Patienten, offenen Aufgaben und Bereitschaftsprüfungen" }),
        metrics: [
          metric(lang, "active_patients", { ru: "Активные пациенты", de: "Aktive Patienten" }, { ru: "в вашем сопровождении", de: "in Ihrer Betreuung" }),
          metric(lang, "active_orders", { ru: "Активные заказы", de: "Aktive Aufträge" }, { ru: "по вашим пациентам", de: "für Ihre Patienten" }),
          metric(lang, "open_tasks", { ru: "Открытые задачи", de: "Offene Aufgaben" }, { ru: "личная очередь", de: "persönliche Queue" }),
          metric(lang, "overdue_tasks", { ru: "Просрочено", de: "Überfällig" }, { ru: "нужно закрыть сегодня", de: "heute zu klären" }),
          metric(lang, "checklist_completion_rate_pct", { ru: "Готовность чеклистов", de: "Checklisten-Fortschritt" }, { ru: "доля закрытых пунктов", de: "abgeschlossene Punkte" }, "percent"),
          metric(lang, "avg_feedback_score", { ru: "Оценка пациентов", de: "Patientenbewertung" }, { ru: "средний балл", de: "Durchschnitt" }, "score"),
        ],
        focus: [
          l(lang, { ru: "Закрыть просроченные действия по пациентам", de: "Überfällige Patientenaktionen abschließen" }),
          l(lang, { ru: "Проверить готовность документов и согласий", de: "Dokumente und Einwilligungen prüfen" }),
          l(lang, { ru: "Подготовить ближайшие приёмы", de: "Anstehende Termine vorbereiten" }),
        ],
        preview: { active_patients: 18, active_orders: 9, open_tasks: 11, overdue_tasks: 3, checklist_completion_rate_pct: 78, avg_feedback_score: 4.7 },
      };
    case "teamlead_interpreter":
      return {
        eyebrow: l(lang, { ru: "Команда и покрытие", de: "Team & Abdeckung" }),
        subtitle: l(lang, { ru: "Загрузка команды, покрытие приёмов и подтверждение часов", de: "Teamauslastung, Terminabdeckung und Stundenfreigabe" }),
        metrics: [
          metric(lang, "team_size", { ru: "Сотрудники", de: "Teammitglieder" }, { ru: "активная команда", de: "aktives Team" }),
          metric(lang, "completed_appointments_30d", { ru: "Завершённые приёмы", de: "Abgeschlossene Termine" }, { ru: "за 30 дней", de: "in 30 Tagen" }),
          metric(lang, "upcoming_hours_30d", { ru: "Будущие часы", de: "Geplante Stunden" }, { ru: "следующие 30 дней", de: "nächste 30 Tage" }, "hours"),
          metric(lang, "utilization_rate_pct", { ru: "Подтверждение часов", de: "Stundenfreigabe" }, { ru: "утверждено от отработанного", de: "freigegeben vs. gebucht" }, "percent"),
          metric(lang, "approved_hours_30d", { ru: "Подтверждено", de: "Freigegeben" }, { ru: "часов за 30 дней", de: "Stunden in 30 Tagen" }, "hours"),
          metric(lang, "avg_feedback_score", { ru: "Оценка команды", de: "Teambewertung" }, { ru: "средний балл", de: "Durchschnitt" }, "score"),
        ],
        focus: [
          l(lang, { ru: "Закрыть приёмы без назначенного сотрудника", de: "Termine ohne Zuweisung besetzen" }),
          l(lang, { ru: "Проверить отчёты и подтверждение часов", de: "Berichte und Stundenfreigaben prüfen" }),
          l(lang, { ru: "Сбалансировать загрузку команды", de: "Teamauslastung ausgleichen" }),
        ],
        preview: { team_size: 7, completed_appointments_30d: 42, upcoming_hours_30d: 64.5, utilization_rate_pct: 91, approved_hours_30d: 118, avg_feedback_score: 4.8 },
      };
    case "interpreter":
      return {
        eyebrow: l(lang, { ru: "Мой рабочий график", de: "Mein Arbeitsplan" }),
        subtitle: l(lang, { ru: "Ваши приёмы, часы и личная эффективность", de: "Ihre Termine, Stunden und persönliche Leistung" }),
        metrics: [
          metric(lang, "completed_appointments_30d", { ru: "Завершённые приёмы", de: "Abgeschlossene Termine" }, { ru: "за 30 дней", de: "in 30 Tagen" }),
          metric(lang, "upcoming_hours_30d", { ru: "Предстоящие часы", de: "Anstehende Stunden" }, { ru: "следующие 30 дней", de: "nächste 30 Tage" }, "hours"),
          metric(lang, "approved_hours_30d", { ru: "Подтверждено", de: "Freigegeben" }, { ru: "часов к оплате", de: "abrechenbare Stunden" }, "hours"),
          metric(lang, "utilization_rate_pct", { ru: "Подтверждение", de: "Freigabequote" }, { ru: "утверждено от отработанного", de: "freigegeben vs. gebucht" }, "percent"),
          metric(lang, "booked_hours_30d", { ru: "Отработано", de: "Gebucht" }, { ru: "часов за 30 дней", de: "Stunden in 30 Tagen" }, "hours"),
          metric(lang, "avg_feedback_score", { ru: "Моя оценка", de: "Meine Bewertung" }, { ru: "средний балл", de: "Durchschnitt" }, "score"),
        ],
        focus: [
          l(lang, { ru: "Проверить материалы к ближайшим приёмам", de: "Unterlagen für kommende Termine prüfen" }),
          l(lang, { ru: "Внести и отправить часы на подтверждение", de: "Stunden erfassen und freigeben lassen" }),
          l(lang, { ru: "Закрыть отчёты по завершённым приёмам", de: "Berichte zu abgeschlossenen Terminen schließen" }),
        ],
        preview: { completed_appointments_30d: 16, upcoming_hours_30d: 24, approved_hours_30d: 38, utilization_rate_pct: 95, booked_hours_30d: 40, avg_feedback_score: 4.9 },
      };
    case "concierge":
      return {
        eyebrow: l(lang, { ru: "Сервис и логистика", de: "Service & Logistik" }),
        subtitle: l(lang, { ru: "Активные запросы, ближайшие действия и передача в бухгалтерию", de: "Aktive Anfragen, nächste Schritte und Übergabe an die Abrechnung" }),
        metrics: [
          metric(lang, "active_services", { ru: "Активные сервисы", de: "Aktive Services" }, { ru: "в вашей очереди", de: "in Ihrer Queue" }),
          metric(lang, "completed_services_30d", { ru: "Выполнено", de: "Abgeschlossen" }, { ru: "за 30 дней", de: "in 30 Tagen" }),
          metric(lang, "ready_for_billing", { ru: "Готово к оплате", de: "Bereit zur Abrechnung" }, { ru: "нужно передать", de: "zu übergeben" }),
          metric(lang, "portal_requests_30d", { ru: "Запросы из портала", de: "Portal-Anfragen" }, { ru: "за 30 дней", de: "in 30 Tagen" }),
          metric(lang, "avg_feedback_score", { ru: "Оценка сервиса", de: "Servicebewertung" }, { ru: "средний балл", de: "Durchschnitt" }, "score"),
          metric(lang, "taxonomy_mix", { ru: "Направления сервиса", de: "Servicebereiche" }, { ru: "виды активных запросов", de: "Arten aktiver Anfragen" }),
        ],
        focus: [
          l(lang, { ru: "Разобрать новые запросы из портала", de: "Neue Portal-Anfragen bearbeiten" }),
          l(lang, { ru: "Проверить логистику ближайших приёмов", de: "Logistik der nächsten Termine prüfen" }),
          l(lang, { ru: "Передать выполненные сервисы в бухгалтерию", de: "Erledigte Services an die Abrechnung übergeben" }),
        ],
        preview: { active_services: 9, completed_services_30d: 27, ready_for_billing: 4, portal_requests_30d: 6, avg_feedback_score: 4.8, taxonomy_mix: [{}, {}, {}] },
      };
    case "billing":
      return {
        eyebrow: l(lang, { ru: "Финансы и дебиторка", de: "Finanzen & Forderungen" }),
        subtitle: l(lang, { ru: "Счета, просрочки и скорость закрытия финансового цикла", de: "Rechnungen, Überfälligkeiten und Geschwindigkeit des Finanzzyklus" }),
        metrics: [
          metric(lang, "outstanding_receivables_total", { ru: "Дебиторка", de: "Offene Forderungen" }, { ru: "к получению", de: "noch einzuziehen" }, "currency"),
          metric(lang, "overdue_invoice_count", { ru: "Просроченные счета", de: "Überfällige Rechnungen" }, { ru: "требуют действия", de: "Handlungsbedarf" }),
          metric(lang, "invoices_30d", { ru: "Счета", de: "Rechnungen" }, { ru: "создано за 30 дней", de: "in 30 Tagen erstellt" }),
          metric(lang, "paid_within_14d_rate_pct", { ru: "Оплата до 14 дней", de: "Zahlung bis 14 Tage" }, { ru: "доля оплат", de: "Zahlungsquote" }, "percent"),
          metric(lang, "avg_invoice_gross", { ru: "Средний счёт", de: "Ø Rechnungswert" }, { ru: "брутто", de: "brutto" }, "currency"),
          metric(lang, "avg_service_to_invoice_days", { ru: "До выставления", de: "Bis Rechnungsstellung" }, { ru: "среднее время", de: "durchschnittlich" }, "days"),
        ],
        focus: [
          l(lang, { ru: "Отработать просроченные счета", de: "Überfällige Rechnungen bearbeiten" }),
          l(lang, { ru: "Проверить готовые к выставлению заказы", de: "Abrechnungsbereite Aufträge prüfen" }),
          l(lang, { ru: "Закрыть расхождения между услугами и счетами", de: "Abweichungen zwischen Leistungen und Rechnungen klären" }),
        ],
        preview: { outstanding_receivables_total: "18240.50", overdue_invoice_count: 6, invoices_30d: 34, paid_within_14d_rate_pct: 76, avg_invoice_gross: 2840, avg_service_to_invoice_days: 3.4 },
      };
    case "sales":
      return {
        eyebrow: l(lang, { ru: "Продажи и партнёры", de: "Vertrieb & Partner" }),
        subtitle: l(lang, { ru: "Новые лиды, квалификация и конверсия в пациентов", de: "Neue Leads, Qualifizierung und Konversion zu Patienten" }),
        metrics: [
          metric(lang, "new_leads_30d", { ru: "Новые лиды", de: "Neue Leads" }, { ru: "за 30 дней", de: "in 30 Tagen" }),
          metric(lang, "qualified_leads_30d", { ru: "Квалифицировано", de: "Qualifiziert" }, { ru: "за 30 дней", de: "in 30 Tagen" }),
          metric(lang, "converted_leads_30d", { ru: "Конвертировано", de: "Konvertiert" }, { ru: "в пациентов", de: "zu Patienten" }),
          metric(lang, "lead_to_patient_conversion_rate_pct", { ru: "Конверсия", de: "Konversion" }, { ru: "лид → пациент", de: "Lead → Patient" }, "percent"),
          metric(lang, "active_lead_country_count", { ru: "Активные страны", de: "Aktive Länder" }, { ru: "за 90 дней", de: "in 90 Tagen" }),
          metric(lang, "new_partner_clinics_90d", { ru: "Новые клиники", de: "Neue Kliniken" }, { ru: "за 90 дней", de: "in 90 Tagen" }),
        ],
        focus: [
          l(lang, { ru: "Квалифицировать новые обращения", de: "Neue Anfragen qualifizieren" }),
          l(lang, { ru: "Вернуть лиды без следующего контакта", de: "Leads ohne nächsten Kontakt nachfassen" }),
          l(lang, { ru: "Развивать партнёрства с клиниками", de: "Klinikpartnerschaften ausbauen" }),
        ],
        preview: { new_leads_30d: 24, qualified_leads_30d: 11, converted_leads_30d: 7, lead_to_patient_conversion_rate_pct: 29.2, active_lead_country_count: 8, new_partner_clinics_90d: 3 },
      };
    case "it_admin":
      return {
        eyebrow: l(lang, { ru: "Система и безопасность", de: "System & Sicherheit" }),
        subtitle: l(lang, { ru: "Состояние доступов, активных сессий и событий безопасности", de: "Status von Zugriffen, Sitzungen und Sicherheitsereignissen" }),
        metrics: [
          metric(lang, "active_users", { ru: "Активные пользователи", de: "Aktive Benutzer" }, { ru: "учётные записи", de: "Konten" }),
          metric(lang, "active_sessions", { ru: "Активные сессии", de: "Aktive Sitzungen" }, { ru: "сейчас в системе", de: "derzeit im System" }),
          metric(lang, "locked_accounts", { ru: "Заблокировано", de: "Gesperrte Konten" }, { ru: "учётные записи", de: "Konten" }),
          metric(lang, "auth_alerts_24h", { ru: "События входа", de: "Anmeldealarme" }, { ru: "за 24 часа", de: "in 24 Stunden" }),
          metric(lang, "pending_logins", { ru: "Ожидают MFA", de: "Warten auf MFA" }, { ru: "нужно подтвердить", de: "zu bestätigen" }),
          metric(lang, "audit_events_24h", { ru: "Audit-события", de: "Audit-Ereignisse" }, { ru: "за 24 часа", de: "in 24 Stunden" }),
        ],
        focus: [
          l(lang, { ru: "Проверить предупреждения авторизации", de: "Anmeldewarnungen prüfen" }),
          l(lang, { ru: "Разобрать заблокированные учётные записи", de: "Gesperrte Konten bearbeiten" }),
          l(lang, { ru: "Проверить ожидающие MFA-входы", de: "Ausstehende MFA-Anmeldungen prüfen" }),
        ],
        preview: { active_users: 12, active_sessions: 5, locked_accounts: 1, auth_alerts_24h: 3, pending_logins: 2, audit_events_24h: 184 },
      };
    default:
      return roleDashboardDefinition("patient_manager", lang);
  }
}
