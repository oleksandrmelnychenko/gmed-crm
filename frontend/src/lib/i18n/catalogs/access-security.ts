/**
 * Sign-in, mandatory second factor, portal accounts in the user
 * administration, CEO-only business settings and the redacted activity log
 * (full QA 2026-10-11: E-05, E-17/E-28, E-19, E-24, E-30, E-31, E-37, E-45).
 */
export interface AccessSecurityTranslations {
  login_error_invalid_or_held: string;
  login_session_expired: string;
  login_session_idle: string;
  twofactor_gate_title: string;
  twofactor_gate_body: string;
  twofactor_gate_done: string;
  twofactor_qr_alt: string;
  twofactor_qr_hint: string;
  users_portal_account_managed_elsewhere: string;
  users_portal_role_change_forbidden: string;
  users_portal_role_locked: string;
  settings_ceo_only_hint: string;
  settings_iban_invalid: string;
  settings_bic_invalid: string;
  activity_context_redacted: string;
  activity_portal_actor: string;
}

export const accessSecurityRu: AccessSecurityTranslations = {
  login_error_invalid_or_held:
    "Неверная электронная почта или пароль. После нескольких неудачных попыток вход с этого устройства приостанавливается на некоторое время — подождите и попробуйте снова.",
  login_session_expired: "Сессия истекла. Войдите снова.",
  login_session_idle: "Вы вышли из системы после периода бездействия. Войдите снова.",
  twofactor_gate_title: "Настройте двухфакторный вход",
  twofactor_gate_body:
    "Для вашей роли двухфакторный вход обязателен. Пока он не настроен, доступна только эта страница. Отсканируйте QR-код приложением-аутентификатором (например, Microsoft Authenticator, Google Authenticator или 2FAS) и введите шестизначный код из приложения.",
  twofactor_gate_done: "Двухфакторный вход настроен. Открываем рабочее место…",
  twofactor_qr_alt: "QR-код для приложения-аутентификатора",
  twofactor_qr_hint:
    "Отсканируйте код камерой в приложении-аутентификаторе. Если сканирование невозможно, введите ключ вручную.",
  users_portal_account_managed_elsewhere:
    "Входы пациентов и лидов управляются в карточке лида или пациента.",
  users_portal_role_change_forbidden:
    "Роль портального входа (пациент или лид) нельзя сменить на роль сотрудника, и наоборот.",
  users_portal_role_locked: "Роль портального входа не меняется.",
  settings_ceo_only_hint:
    "Эти данные (реквизиты и банковский счёт агентства, налоговые данные, сроки хранения и доступа, правила документов) изменяет только CEO.",
  settings_iban_invalid:
    "IBAN неверен: проверьте код страны, длину и контрольные цифры.",
  settings_bic_invalid:
    "BIC неверен: 8 или 11 символов — код банка, страна, место и при необходимости филиал.",
  activity_context_redacted:
    "Скрыто: данные пациентов, лидов, финансов и проверок видит только CEO",
  activity_portal_actor: "Вход пациента или лида",
};

export const accessSecurityDe: AccessSecurityTranslations = {
  login_error_invalid_or_held:
    "E-Mail oder Passwort ist falsch. Nach mehreren Fehlversuchen wird die Anmeldung von diesem Gerät für eine Weile ausgesetzt – bitte warten Sie und versuchen Sie es erneut.",
  login_session_expired: "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.",
  login_session_idle:
    "Sie wurden nach einer Zeit ohne Aktivität abgemeldet. Bitte melden Sie sich erneut an.",
  twofactor_gate_title: "Zwei-Faktor-Anmeldung einrichten",
  twofactor_gate_body:
    "Für Ihre Rolle ist die Zwei-Faktor-Anmeldung Pflicht. Bis sie eingerichtet ist, ist nur diese Seite verfügbar. Scannen Sie den QR-Code mit einer Authenticator-App (zum Beispiel Microsoft Authenticator, Google Authenticator oder 2FAS) und geben Sie den sechsstelligen Code aus der App ein.",
  twofactor_gate_done: "Zwei-Faktor-Anmeldung eingerichtet. Der Arbeitsbereich wird geöffnet …",
  twofactor_qr_alt: "QR-Code für die Authenticator-App",
  twofactor_qr_hint:
    "Scannen Sie den Code mit der Kamera in der Authenticator-App. Ist das nicht möglich, geben Sie den Schlüssel manuell ein.",
  users_portal_account_managed_elsewhere:
    "Zugänge von Patienten und Leads werden im Lead- bzw. Patientendatensatz verwaltet.",
  users_portal_role_change_forbidden:
    "Ein Portalzugang (Patient oder Lead) kann nicht in einen Mitarbeiterzugang umgewandelt werden und umgekehrt.",
  users_portal_role_locked: "Die Rolle eines Portalzugangs ändert sich nicht.",
  settings_ceo_only_hint:
    "Diese Angaben (Agenturdaten und Bankverbindung, Steuerdaten, Aufbewahrungs- und Zugriffsfristen, Dokumentregeln) ändert nur der CEO.",
  settings_iban_invalid:
    "Die IBAN ist ungültig: Bitte Ländercode, Länge und Prüfziffern prüfen.",
  settings_bic_invalid:
    "Die BIC ist ungültig: 8 oder 11 Zeichen – Bankcode, Land, Ort und optional Filiale.",
  activity_context_redacted:
    "Ausgeblendet: Patienten-, Lead-, Finanz- und Prüfdaten sieht nur der CEO",
  activity_portal_actor: "Patienten- oder Lead-Zugang",
};
