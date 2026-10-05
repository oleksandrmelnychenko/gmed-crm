import type { LeadPortalAccountSummary } from "@/lib/api/types";

/**
 * State of the patient login created with a lead (owner decision 2026-10-03):
 * - `none`: the lead has no login (older leads, or created without e-mail)
 * - `disabled`: the lead was deleted, so the login was switched off
 * - `never_logged_in`: the issued password has not been used yet
 * - `password_pending`: an administrator forced a password change that is still open
 * - `active`: signed in
 */
export type LeadPortalStatus =
  | "none"
  | "disabled"
  | "never_logged_in"
  | "password_pending"
  | "active";

export function leadPortalStatus(
  account: LeadPortalAccountSummary | null | undefined,
): LeadPortalStatus {
  if (!account) return "none";
  if (!account.is_active) return "disabled";
  if (!account.last_login_at) return "never_logged_in";
  return account.password_change_pending ? "password_pending" : "active";
}

type Lang = "de" | "ru" | string;

const STATUS_LABELS: Record<LeadPortalStatus, { ru: string; de: string }> = {
  none: { ru: "Нет доступа", de: "Kein Zugang" },
  disabled: { ru: "Отключён", de: "Deaktiviert" },
  never_logged_in: { ru: "Ещё не входил", de: "Noch nicht angemeldet" },
  password_pending: { ru: "Входил, пароль не сменил", de: "Angemeldet, Passwort nicht geändert" },
  active: { ru: "Входил", de: "Angemeldet" },
};

export function leadPortalStatusLabel(status: LeadPortalStatus, lang: Lang): string {
  return lang === "de" ? STATUS_LABELS[status].de : STATUS_LABELS[status].ru;
}

export function leadPortalStatusTone(
  status: LeadPortalStatus,
): "neutral" | "warning" | "success" | "error" {
  switch (status) {
    case "active":
      return "success";
    case "never_logged_in":
    case "password_pending":
      return "warning";
    case "disabled":
      return "error";
    default:
      return "neutral";
  }
}

/** Only the CEO and patient managers see or issue a one-time password. */
export function canIssueLeadPortalPassword(role: string | null | undefined): boolean {
  return role === "ceo" || role === "patient_manager";
}

/** Owner of an address a lead may not take, from a 409 `portal_email_taken`. */
export type PortalEmailOwner = {
  name: string | null;
  role: string | null;
  lead_id: string | null;
  lead_name: string | null;
  patient_id: string | null;
  patient_code: string | null;
  patient_name: string | null;
};

export function portalEmailOwnerFromError(error: unknown): PortalEmailOwner | null {
  if (!error || typeof error !== "object") return null;
  const body = (error as { body?: Record<string, unknown> | null }).body;
  if (!body || body.code !== "portal_email_taken") return null;
  const owner = body.owner;
  return owner && typeof owner === "object" ? (owner as PortalEmailOwner) : null;
}

const ROLE_LABELS: Record<string, { ru: string; de: string }> = {
  ceo: { ru: "CEO", de: "CEO" },
  ceo_assistant: { ru: "ассистент CEO", de: "CEO-Assistenz" },
  patient_manager: { ru: "менеджер пациентов", de: "Patientenmanager" },
  teamlead_interpreter: { ru: "тимлид переводчиков", de: "Teamleitung Dolmetscher" },
  interpreter: { ru: "переводчик", de: "Dolmetscher" },
  concierge: { ru: "консьерж", de: "Concierge" },
  billing: { ru: "бухгалтерия", de: "Buchhaltung" },
  sales: { ru: "продажи", de: "Vertrieb" },
  it_admin: { ru: "IT-администратор", de: "IT-Administration" },
};

/** "Anna Müller · пациент P-00123", "Max Muster · сотрудник (продажи)", … */
export function portalEmailOwnerLabel(owner: PortalEmailOwner, lang: Lang): string {
  const de = lang === "de";
  if (owner.patient_id) {
    const name = owner.patient_name ?? owner.name ?? "";
    const code = owner.patient_code ? ` ${owner.patient_code}` : "";
    return `${name} · ${de ? "Patient" : "пациент"}${code}`;
  }
  if (owner.lead_id) {
    return `${owner.lead_name ?? owner.name ?? ""} · ${de ? "Lead" : "лид"}`;
  }
  if (owner.role && owner.role !== "patient") {
    const role = ROLE_LABELS[owner.role];
    const roleLabel = role ? (de ? role.de : role.ru) : owner.role;
    return `${owner.name ?? ""} · ${de ? "Mitarbeiter" : "сотрудник"} (${roleLabel})`;
  }
  return `${owner.name ?? ""} · ${de ? "Patientenkonto" : "аккаунт пациента"}`;
}

/** Where the owner of a taken address can be opened, if anywhere. */
export function portalEmailOwnerHref(owner: PortalEmailOwner): string | null {
  if (owner.patient_id) return `/patients/${owner.patient_id}`;
  if (owner.lead_id) return `/leads?lead=${owner.lead_id}`;
  return null;
}

export type PatientMessageLanguage = "de" | "en" | "ru" | "uk";

/** Resolves the lead's language to one of the message templates (German fallback). */
export function patientMessageLanguage(language: string | null | undefined): PatientMessageLanguage {
  const code = (language ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (code === "en" || code === "ru" || code === "uk") return code;
  return "de";
}

/**
 * Text the staff member sends to the patient (messenger, SMS) together with
 * the password. The password is never put into a URL. The lead keeps this
 * password: the cabinet neither forces nor offers a change (owner decision
 * 2026-10-05); a lost one is replaced by staff.
 */
export function portalCredentialsMessage(input: {
  firstName: string;
  email: string;
  password: string;
  loginUrl: string;
  language: PatientMessageLanguage;
}): string {
  const { firstName, email, password, loginUrl, language } = input;
  const name = firstName.trim();
  switch (language) {
    case "en":
      return [
        `Hello${name ? ` ${name}` : ""},`,
        "your access to the GMed patient portal is ready. Please enter your personal details and upload your documents there.",
        `Sign in: ${loginUrl}`,
        `Login: ${email}`,
        `Password: ${password}`,
      ].join("\n");
    case "ru":
      return [
        `Здравствуйте${name ? `, ${name}` : ""}!`,
        "Ваш доступ в портал пациента GMed готов. Пожалуйста, заполните там свои данные и загрузите документы.",
        `Вход: ${loginUrl}`,
        `Логин: ${email}`,
        `Пароль: ${password}`,
      ].join("\n");
    case "uk":
      return [
        `Вітаємо${name ? `, ${name}` : ""}!`,
        "Ваш доступ до порталу пацієнта GMed готовий. Будь ласка, заповніть там свої дані та завантажте документи.",
        `Вхід: ${loginUrl}`,
        `Логін: ${email}`,
        `Пароль: ${password}`,
      ].join("\n");
    default:
      return [
        `Guten Tag${name ? ` ${name}` : ""},`,
        "Ihr Zugang zum GMed-Patientenportal ist eingerichtet. Bitte tragen Sie dort Ihre persönlichen Daten ein und laden Sie Ihre Unterlagen hoch.",
        `Anmeldung: ${loginUrl}`,
        `Benutzername: ${email}`,
        `Passwort: ${password}`,
      ].join("\n");
  }
}
