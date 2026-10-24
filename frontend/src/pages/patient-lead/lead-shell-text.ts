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
  /** Under the name in the side bar: what this login is. */
  accountCaption: string;
  toggleSidebar: string;
  skipToContent: string;
  /** Suffix of a locked patient-portal entry ("Dashboard — Gesperrt"). */
  locked: string;
  signOut: string;
  /** Side-bar entries by id: the cabinet's own and the locked patient-portal ones. */
  nav: Record<LeadShellNavId, string>;
  /** The dialog behind a locked entry: interest in a package. */
  planDialog: {
    title: string;
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
  | "privacy";

const de: LeadShellText = {
  portalName: "Patientenportal",
  accountCaption: "Anfrageportal",
  toggleSidebar: "Seitenleiste umschalten",
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
  },
  planDialog: {
    title: "Patientenbereich",
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
  accountCaption: "Кабинет заявки",
  toggleSidebar: "Переключить боковую панель",
  skipToContent: "Перейти к содержанию",
  locked: "Закрыто",
  signOut: "Выход",
  nav: {
    lead_request: "Ваша заявка",
    account: "Аккаунт",
    legal: "Impressum и защита данных",
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
  },
  planDialog: {
    title: "Раздел пациента",
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
  accountCaption: "Кабінет заявки",
  toggleSidebar: "Перемкнути бічну панель",
  skipToContent: "Перейти до вмісту",
  locked: "Заблоковано",
  signOut: "Вийти",
  nav: {
    lead_request: "Ваша заявка",
    account: "Обліковий запис",
    legal: "Impressum і захист даних",
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
  },
  planDialog: {
    title: "Розділ пацієнта",
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
  accountCaption: "Request portal",
  toggleSidebar: "Toggle sidebar",
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
  },
  planDialog: {
    title: "Patient area",
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

/** The side-bar label of a nav item by id; an id outside the cabinet falls back to `fallback`. */
export function leadShellNavLabel(text: LeadShellText, id: string, fallback: string): string {
  return (text.nav as Partial<Record<string, string>>)[id] ?? fallback;
}
