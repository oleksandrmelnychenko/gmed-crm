import { asLeadCabinetLang, type LeadCabinetLang } from "./lead-request-text";

/**
 * The texts of the shell around the lead cabinet: side bar, top bar and the dialog of a locked
 * patient-portal entry (QA 2026-10-24, A-7). The cabinet speaks DE, EN, UA and RU, the app's
 * catalogs only DE and RU; this table gives the shell the other two languages. German is the
 * original; DE and RU repeat the catalog texts, so the shell of a German or Russian cabinet reads
 * as before. Used only for a login in the lead cabinet (`isLeadPortalUser`); the staff and the
 * patient-portal shells keep the catalogs.
 */
export interface LeadShellText {
  /** Caption next to the wordmark ("GMED Patientenportal" for screen readers). */
  portalName: string;
  toggleSidebar: string;
  /** The visible menu button on a phone (owner 2026-10-27: the bare icon was not obvious). */
  menu: string;
  skipToContent: string;
  /** Suffix of a locked patient-portal entry ("Dashboard — Gesperrt"). */
  locked: string;
  signOut: string;
  /** Side-bar entries by id: the cabinet's own and the locked patient-portal ones. */
  nav: Record<LeadShellNavId, string>;
  /** The dialog behind a locked entry: interest in a package. */
  planDialog: {
    title: string;
    /** Above the list of the portal's areas (the one entry "what comes after your request"). */
    featuresIntro: string;
    locked: string;
    explanation: string;
    disclaimer: string;
    request: string;
    forRequest: string;
    unnamed: string;
    packages: string;
    empty: string;
    unavailable: string;
    loading: string;
    error: string;
    submitError: string;
    retry: string;
    submit: string;
    pending: string;
    sent: string;
    existing: string;
    close: string;
  };
}

export type LeadShellNavId =
  | "lead_request"
  | "account"
  | "legal"
  | "dashboard"
  | "notifications"
  | "chat"
  | "appointments"
  | "recommendations"
  | "documents"
  | "subscriptions"
  | "invoices"
  | "feedback"
  | "privacy"
  | "after_request";

/** The one side-bar entry for the patient portal to come (owner 2026-10-26, C1). */
export const LEAD_PORTAL_AFTER_REQUEST = "after_request";

/** The areas of the patient portal a lead gets later, listed in the dialog of that entry. */
const PORTAL_FEATURES = [
  "dashboard",
  "notifications",
  "chat",
  "appointments",
  "recommendations",
  "documents",
  "subscriptions",
  "invoices",
  "feedback",
  "privacy",
] as const satisfies readonly LeadShellNavId[];

const de: LeadShellText = {
  portalName: "Patientenportal",
  toggleSidebar: "Seitenleiste umschalten",
  menu: "Menü",
  skipToContent: "Zum Inhalt springen",
  locked: "Gesperrt",
  signOut: "Abmelden",
  nav: {
    lead_request: "Ihre Anfrage",
    account: "Konto",
    legal: "Impressum & Datenschutz",
    dashboard: "Dashboard",
    notifications: "Meine Benachrichtigungen",
    chat: "Chat",
    appointments: "Meine Termine",
    recommendations: "Meine Empfehlungen",
    documents: "Meine Dokumente",
    subscriptions: "Meine Abonnements",
    invoices: "Meine Rechnungen",
    feedback: "Mein Feedback",
    privacy: "Datenschutz",
    after_request: "Was nach der Anfrage kommt",
  },
  planDialog: {
    title: "Patientenbereich",
    featuresIntro: "Nach der Aufnahme als Patient finden Sie hier:",
    locked: "Dieser Bereich ist noch gesperrt.",
    explanation:
      "Er wird nach der Aufnahme als Patient und der Freigabe des Zugangs verfügbar. Sie können GMED jetzt Ihr Interesse an einem Paket mitteilen.",
    disclaimer: "Die Anfrage aktiviert kein Paket und schaltet diesen Bereich nicht frei.",
    request: "Anfrage auswählen",
    forRequest: "Für die Anfrage",
    unnamed: "Anfrage ohne Namen",
    packages: "Paket auswählen",
    empty: "Zurzeit sind keine Pakete verfügbar. Bitte wenden Sie sich an GMED.",
    unavailable: "Keine zugängliche Anfrage gefunden. Bitte wenden Sie sich an GMED.",
    loading: "Pakete werden geladen…",
    error: "Die Pakete konnten nicht geladen werden. Bitte versuchen Sie es erneut.",
    submitError: "Die Anfrage konnte nicht gesendet werden. Bitte versuchen Sie es erneut.",
    retry: "Erneut versuchen",
    submit: "Interesse senden",
    pending: "Bereits angefragt",
    sent: "Ihr Interesse wurde an GMED übermittelt.",
    existing: "Ihr Interesse an diesem Paket liegt GMED bereits vor.",
    close: "Schließen",
  },
};

const ru: LeadShellText = {
  portalName: "Портал пациента",
  toggleSidebar: "Переключить боковую панель",
  menu: "Меню",
  skipToContent: "Перейти к содержанию",
  locked: "Закрыто",
  signOut: "Выход",
  nav: {
    lead_request: "Ваша заявка",
    account: "Аккаунт",
    legal: "Правовая информация и защита данных",
    dashboard: "Панель управления",
    notifications: "Мои уведомления",
    chat: "Чат",
    appointments: "Мои визиты",
    recommendations: "Мои рекомендации",
    documents: "Мои документы",
    subscriptions: "Мои подписки",
    invoices: "Мои счета",
    feedback: "Мои отзывы",
    privacy: "Конфиденциальность",
    after_request: "Что будет после заявки",
  },
  planDialog: {
    title: "Раздел пациента",
    featuresIntro: "После оформления пациента здесь будут:",
    locked: "Этот раздел пока закрыт.",
    explanation:
      "Он станет доступен после оформления пациента и подтверждения доступа. Сейчас можно сообщить GMED о желании оформить пакет.",
    disclaimer: "Запрос не активирует пакет и не открывает этот раздел.",
    request: "Выберите заявку",
    forRequest: "Для заявки",
    unnamed: "Заявка без имени",
    packages: "Выберите пакет",
    empty: "Сейчас нет доступных пакетов. Обратитесь в GMED.",
    unavailable: "Доступная заявка не найдена. Обратитесь в GMED.",
    loading: "Загружаем пакеты…",
    error: "Не удалось загрузить пакеты. Попробуйте ещё раз.",
    submitError: "Не удалось отправить запрос. Попробуйте ещё раз.",
    retry: "Повторить",
    submit: "Запросить пакет",
    pending: "Уже запрошен",
    sent: "Ваш запрос отправлен в GMED.",
    existing: "GMED уже получил ваш запрос на этот пакет.",
    close: "Закрыть",
  },
};

const uk: LeadShellText = {
  portalName: "Портал пацієнта",
  toggleSidebar: "Перемкнути бічну панель",
  menu: "Меню",
  skipToContent: "Перейти до вмісту",
  locked: "Заблоковано",
  signOut: "Вийти",
  nav: {
    lead_request: "Ваша заявка",
    account: "Обліковий запис",
    legal: "Правова інформація та захист даних",
    dashboard: "Панель керування",
    notifications: "Мої сповіщення",
    chat: "Чат",
    appointments: "Мої візити",
    recommendations: "Мої рекомендації",
    documents: "Мої документи",
    subscriptions: "Мої підписки",
    invoices: "Мої рахунки",
    feedback: "Мої відгуки",
    privacy: "Конфіденційність",
    after_request: "Що буде після заявки",
  },
  planDialog: {
    title: "Розділ пацієнта",
    featuresIntro: "Після оформлення як пацієнта тут будуть:",
    locked: "Цей розділ поки заблоковано.",
    explanation:
      "Він стане доступним після оформлення як пацієнта та надання доступу. Ви можете вже зараз повідомити GMED про свій інтерес до пакета.",
    disclaimer: "Запит не активує пакет і не відкриває цей розділ.",
    request: "Виберіть заявку",
    forRequest: "Для заявки",
    unnamed: "Заявка без імені",
    packages: "Виберіть пакет",
    empty: "Зараз немає доступних пакетів. Зверніться до GMED.",
    unavailable: "Доступну заявку не знайдено. Зверніться до GMED.",
    loading: "Завантажуємо пакети…",
    error: "Не вдалося завантажити пакети. Спробуйте ще раз.",
    submitError: "Не вдалося надіслати запит. Спробуйте ще раз.",
    retry: "Повторити",
    submit: "Надіслати запит",
    pending: "Уже запитано",
    sent: "Ваш запит надіслано до GMED.",
    existing: "GMED уже отримав ваш запит на цей пакет.",
    close: "Закрити",
  },
};

const en: LeadShellText = {
  portalName: "Patient portal",
  toggleSidebar: "Toggle sidebar",
  menu: "Menu",
  skipToContent: "Skip to content",
  locked: "Locked",
  signOut: "Sign out",
  nav: {
    lead_request: "Your request",
    account: "Account",
    legal: "Legal notice & privacy",
    dashboard: "Dashboard",
    notifications: "My notifications",
    chat: "Chat",
    appointments: "My appointments",
    recommendations: "My recommendations",
    documents: "My documents",
    subscriptions: "My subscriptions",
    invoices: "My invoices",
    feedback: "My feedback",
    privacy: "Privacy",
    after_request: "What comes after your request",
  },
  planDialog: {
    title: "Patient area",
    featuresIntro: "Once you are admitted as a patient, you will find here:",
    locked: "This area is still locked.",
    explanation:
      "It becomes available once you are admitted as a patient and your access has been released. You can let GMED know now which package you are interested in.",
    disclaimer: "The request does not activate a package and does not unlock this area.",
    request: "Select a request",
    forRequest: "For the request",
    unnamed: "Request without a name",
    packages: "Select a package",
    empty: "No packages are available at the moment. Please contact GMED.",
    unavailable: "No accessible request found. Please contact GMED.",
    loading: "Loading packages…",
    error: "The packages could not be loaded. Please try again.",
    submitError: "The request could not be sent. Please try again.",
    retry: "Try again",
    submit: "Send interest",
    pending: "Already requested",
    sent: "Your interest has been passed on to GMED.",
    existing: "GMED already has your interest in this package on file.",
    close: "Close",
  },
};

/** The shell texts in the cabinet language; an unknown value reads as Russian, like the cabinet. */
export function leadShellText(lang: LeadCabinetLang | string | null | undefined): LeadShellText {
  switch (asLeadCabinetLang(lang)) {
    case "de":
      return de;
    case "en":
      return en;
    case "uk":
      return uk;
    default:
      return ru;
  }
}

/** The names of the patient portal's areas in the cabinet language. */
export function leadPortalFeatureLabels(lang: LeadCabinetLang | string | null | undefined): string[] {
  const text = leadShellText(lang);
  return PORTAL_FEATURES.map((id) => text.nav[id]);
}

/** The side-bar label of a nav item by id; an id outside the cabinet falls back to `fallback`. */
export function leadShellNavLabel(text: LeadShellText, id: string, fallback: string): string {
  return (text.nav as Partial<Record<string, string>>)[id] ?? fallback;
}

/**
 * The account page of the lead cabinet (profile, language, appearance) in the
 * cabinet language, keyed like the catalog texts it replaces (QA 2026-11-12,
 * B S3-1: in EN and UA the page was German). The lead has no password, second
 * factor or sessions there, so the subtitle names what the page holds.
 */
type LeadAccountTextKey =
  | "account_title"
  | "account_subtitle"
  | "account_profile_title"
  | "account_profile_email"
  | "account_profile_name"
  | "account_profile_phone"
  | "account_profile_language"
  | "account_profile_save"
  | "account_profile_saved"
  | "account_profile_error_name_required"
  | "account_profile_error_name"
  | "account_profile_error_phone";

const LEAD_ACCOUNT_TEXT: Record<LeadCabinetLang, Record<LeadAccountTextKey, string>> = {
  de: {
    account_title: "Konto",
    account_subtitle: "Profil, Sprache und Darstellung.",
    account_profile_title: "Profil",
    account_profile_email: "E-Mail",
    account_profile_name: "Name",
    account_profile_phone: "Telefon",
    account_profile_language: "Sprache der Oberfläche",
    account_profile_save: "Profil speichern",
    account_profile_saved: "Profil gespeichert.",
    account_profile_error_name_required: "Bitte geben Sie Ihren Namen an.",
    account_profile_error_name: "Bitte einen Namen mit höchstens 200 Zeichen angeben.",
    account_profile_error_phone: "Telefon: nur Ziffern, +, Leerzeichen, Bindestrich und Klammern (max. 40 Zeichen).",
  },
  en: {
    account_title: "Account",
    account_subtitle: "Profile, language and appearance.",
    account_profile_title: "Profile",
    account_profile_email: "E-mail",
    account_profile_name: "Name",
    account_profile_phone: "Phone",
    account_profile_language: "Interface language",
    account_profile_save: "Save profile",
    account_profile_saved: "Profile saved.",
    account_profile_error_name_required: "Please enter your name.",
    account_profile_error_name: "Please enter a name of at most 200 characters.",
    account_profile_error_phone: "Phone: digits, +, spaces, hyphens and brackets only (at most 40 characters).",
  },
  uk: {
    account_title: "Обліковий запис",
    account_subtitle: "Профіль, мова та оформлення.",
    account_profile_title: "Профіль",
    account_profile_email: "E-mail",
    account_profile_name: "Ім'я",
    account_profile_phone: "Телефон",
    account_profile_language: "Мова інтерфейсу",
    account_profile_save: "Зберегти профіль",
    account_profile_saved: "Профіль збережено.",
    account_profile_error_name_required: "Вкажіть ім'я.",
    account_profile_error_name: "Вкажіть ім'я не довше 200 символів.",
    account_profile_error_phone: "Телефон: лише цифри, +, пробіли, дефіс і дужки (не більше 40 символів).",
  },
  ru: {
    account_title: "Аккаунт",
    account_subtitle: "Профиль, язык и оформление.",
    account_profile_title: "Профиль",
    account_profile_email: "E-mail",
    account_profile_name: "Имя",
    account_profile_phone: "Телефон",
    account_profile_language: "Язык интерфейса",
    account_profile_save: "Сохранить профиль",
    account_profile_saved: "Профиль сохранён.",
    account_profile_error_name_required: "Укажите имя.",
    account_profile_error_name: "Укажите имя не длиннее 200 символов.",
    account_profile_error_phone: "Телефон: только цифры, +, пробелы, дефис и скобки (не более 40 символов).",
  },
};

/** A text of the lead cabinet's account page, or `null` for a key it does not word. */
export function leadAccountText(lang: LeadCabinetLang | string | null | undefined, key: string): string | null {
  const table = LEAD_ACCOUNT_TEXT[asLeadCabinetLang(lang) ?? "ru"];
  return (table as Partial<Record<string, string>>)[key] ?? null;
}
