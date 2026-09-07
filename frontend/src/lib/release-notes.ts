import type { Lang } from "@/lib/i18n";

type LocalizedText = Record<Lang, string>;

export type CustomerReleaseNote = {
  commit: string;
  title: LocalizedText;
  description: LocalizedText;
};

export type CustomerRelease = {
  channel: "development" | "production";
  build: string;
  builtAt: string;
  title: LocalizedText;
  notes: CustomerReleaseNote[];
};

type ReleaseEnvironment = {
  mode: "development" | "production";
  buildNumber?: string;
  buildTimestamp?: string;
};

const RELEASE_NOTES: CustomerReleaseNote[] = [
  {
    commit: "e3f7a96",
    title: { ru: "Распознавание и проверка инвойсов", de: "Rechnungserkennung und Prüfung" },
    description: {
      ru: "Импорт PDF, изображений и электронных счетов XML. Оригинал и распознанные поля открываются рядом; найденный клиент подставляется для проверки, доступны ручные исправления и сохранение исходного документа.",
      de: "PDF, Bilder und elektronische XML-Rechnungen importieren. Original und erkannte Felder stehen nebeneinander; gefundene Patienten werden zur Prüfung vorgeschlagen. Manuelle Korrekturen und das Speichern des Originals sind möglich.",
    },
  },
  {
    commit: "e3f7a96",
    title: { ru: "DATEV: отдельный экран и профиль бухгалтерии", de: "DATEV: Administration und Buchhaltungsprofil" },
    description: {
      ru: "В администрировании добавлены Unternehmen online и шесть модулей вашей бухгалтерии. Профиль сохраняется в GMed; доступны переход в кабинет и список вопросов на немецком. Автоматический обмен ожидает регистрации приложения и разрешений DATEV.",
      de: "Die Administration enthält Unternehmen online und die sechs Buchhaltungsmodule. Das Profil wird in GMed gespeichert; Portalzugang und deutsche Checkliste sind verfügbar. Automatischer Datenaustausch setzt App-Registrierung und DATEV-Berechtigungen voraus.",
    },
  },
  {
    commit: "e3f7a96",
    title: { ru: "Электронные подписи через Skribble", de: "Elektronische Signaturen mit Skribble" },
    description: {
      ru: "Добавлены настройки немецкого аккаунта, выбор подписантов, статусы запросов и получение подписанного PDF с протоколом. DEMO отделено от рабочих подписей. Отправка станет доступна после подключения собственного аккаунта.",
      de: "Einstellungen für ein deutsches Konto, Auswahl der Unterzeichnenden, Anfragestatus sowie signiertes PDF und Protokoll wurden ergänzt. DEMO ist von produktiven Signaturen getrennt. Der Versand benötigt ein eigenes verbundenes Konto.",
    },
  },
  {
    commit: "e3f7a96",
    title: { ru: "Счета компании и обновление финансов", de: "Unternehmensrechnungen und Finanzaktualisierung" },
    description: {
      ru: "Счета поставщиков на GMed можно учитывать как расходы компании без привязки к пациенту или заказу. Улучшены выписки, взаиморасчёты и обновление финансовых данных после изменений.",
      de: "Lieferantenrechnungen an GMed lassen sich ohne Patient oder Auftrag als Unternehmensausgaben erfassen. Kontoauszüge, Abrechnungen und die Aktualisierung der Finanzdaten wurden verbessert.",
    },
  },
  {
    commit: "ff4f4bf",
    title: { ru: "Каталог услуг, цены и описания", de: "Leistungskatalog, Preise und Beschreibungen" },
    description: {
      ru: "Добавлен явный выбор цены услуги. Описание можно редактировать отдельными пунктами; согласованные тексты и цены сохраняются в заказе и используются в документах.",
      de: "Leistungspreise können ausdrücklich ausgewählt werden. Beschreibungen sind in einzelnen Punkten bearbeitbar; vereinbarte Texte und Preise bleiben im Auftrag erhalten und werden in Dokumenten verwendet.",
    },
  },
  {
    commit: "e3f7a96",
    title: { ru: "Чат и защищённые вложения", de: "Chat und geschützte Anhänge" },
    description: {
      ru: "Обновлены переписка, список чатов и отправка вложений. Доработаны настройка защищённого устройства, восстановление состояния сообщений и отображение чата на телефоне.",
      de: "Unterhaltungen, Chatliste und Anhänge wurden überarbeitet. Die Einrichtung geschützter Geräte, die Wiederherstellung des Nachrichtenstatus und die mobile Chatansicht wurden verbessert.",
    },
  },
  {
    commit: "e3f7a96",
    title: { ru: "Медицинский OCR и перевод с английского", de: "Medizinische Texterkennung und Englisch-Übersetzung" },
    description: {
      ru: "Улучшено распознавание медицинских отчётов, дат, лабораторных таблиц и истории анализов. Для английских документов добавлен немецкий перевод с сохранением оригинала для проверки.",
      de: "Die Erkennung medizinischer Berichte, Datumsangaben, Labortabellen und Laborverläufe wurde verbessert. Für englische Dokumente ist eine deutsche Übersetzung verfügbar; das Original bleibt zum Abgleich erhalten.",
    },
  },
  {
    commit: "e3f7a96",
    title: { ru: "Защита изменений в формах", de: "Schutz ungespeicherter Formulare" },
    description: {
      ru: "Окна редактирования предупреждают о потере изменённых данных. Уточнена работа вложенных окон, выпадающих списков и выбора файлов в документах, пациентах, заказах и задачах.",
      de: "Bearbeitungsfenster warnen vor dem Verlust geänderter Daten. Verschachtelte Fenster, Auswahllisten und Dateiauswahl in Dokumenten, Patientenakten, Aufträgen und Aufgaben wurden verbessert.",
    },
  },
  {
    commit: "e3f7a96",
    title: { ru: "Проекты и понятные статусы задач", de: "Projekte und verständliche Aufgabenstatus" },
    description: {
      ru: "В проектах и связанных задачах уточнены отображение workflow, исполнителей и статусов. Названия действий и состояний согласованы с выбранным языком интерфейса.",
      de: "Workflow, Zuständige und Status werden in Projekten und verknüpften Aufgaben klarer dargestellt. Aktions- und Statusbezeichnungen folgen der gewählten Oberflächensprache.",
    },
  },
  {
    commit: "e3f7a96",
    title: { ru: "Документы и карточки пациентов", de: "Dokumente und Patientenakten" },
    description: {
      ru: "Доработаны предпросмотр документов, выбор связанного договора и редактирование привязок. Обновлены карточка пациента и формы лида, услуг и заказа.",
      de: "Dokumentenvorschau, Auswahl verknüpfter Verträge und Bearbeitung von Zuordnungen wurden erweitert. Patientenübersicht sowie Lead-, Leistungs- und Auftragsformulare wurden überarbeitet.",
    },
  },
];

export function resolveCustomerRelease(environment: ReleaseEnvironment): CustomerRelease {
  const isDevelopment = environment.mode === "development";
  const builtAt = environment.buildTimestamp?.trim() || "2026-09-05T20:00:00+03:00";
  const buildDate = new Date(builtAt);
  const title: LocalizedText = isDevelopment
    ? { ru: "Обновления", de: "Aktualisierungen" }
    : { ru: "Релиз", de: "Release" };
  if (!Number.isNaN(buildDate.getTime())) {
    const dateOptions: Intl.DateTimeFormatOptions = {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    };
    const ruDate = new Intl.DateTimeFormat("ru-RU", dateOptions).format(buildDate).replace(/\s*г\.$/, "");
    const deDate = new Intl.DateTimeFormat("de-DE", dateOptions).format(buildDate);
    title.ru += `${isDevelopment ? " за" : " от"} ${ruDate}`;
    title.de += ` vom ${deDate}`;
  }

  return {
    channel: environment.mode,
    build: environment.buildNumber?.trim() || "2026.09.05.1",
    builtAt,
    title,
    notes: RELEASE_NOTES,
  };
}

const requestedChannel = import.meta.env.VITE_RELEASE_CHANNEL?.trim().toLowerCase();
const currentMode = requestedChannel === "production" || requestedChannel === "prod"
  ? "production"
  : requestedChannel === "development" || requestedChannel === "dev"
    ? "development"
    : import.meta.env.PROD
      ? "production"
      : "development";

export const CURRENT_CUSTOMER_RELEASE = resolveCustomerRelease({
  mode: currentMode,
  buildNumber: import.meta.env.VITE_BUILD_NUMBER,
  buildTimestamp: import.meta.env.VITE_BUILD_TIMESTAMP,
});

/*
 * Deployment overrides:
 * VITE_RELEASE_CHANNEL=dev | production
 * VITE_BUILD_NUMBER=2026.09.05.1
 * VITE_BUILD_TIMESTAMP=2026-09-05T20:00:00+03:00
 */

export function localizeReleaseText(text: LocalizedText, lang: Lang): string {
  return text[lang];
}
