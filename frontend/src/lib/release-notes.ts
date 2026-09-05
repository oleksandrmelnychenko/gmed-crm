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

const DAILY_RELEASE_NOTES: CustomerReleaseNote[] = [
  {
    commit: "846b6f4",
    title: {
      ru: "Проекты и наглядный workflow",
      de: "Projekte und visueller Workflow",
    },
    description: {
      ru: "Добавлен единый раздел проектов с владельцем, командой, сроками и связанными задачами. На схеме workflow видны зависимости, блокирующие задачи, прогресс и просрочки.",
      de: "Ein zentraler Projektbereich bündelt Projektleitung, Team, Termine und Aufgaben. Der visuelle Workflow zeigt Abhängigkeiten, blockierende Aufgaben, Fortschritt und Überfälligkeiten.",
    },
  },
  {
    commit: "846b6f4",
    title: {
      ru: "Обновлённое рабочее место Concierge",
      de: "Aktualisierter Concierge-Arbeitsbereich",
    },
    description: {
      ru: "Сервисные запросы и операционные задачи стали компактнее и обновляются в реальном времени. Доступные роли могут безопасно удалять ошибочно созданные запросы с проверкой актуальности данных.",
      de: "Serviceanfragen und operative Aufgaben sind kompakter und werden in Echtzeit aktualisiert. Berechtigte Rollen können irrtümlich erstellte Anfragen mit Versionsprüfung sicher entfernen.",
    },
  },
  {
    commit: "846b6f4",
    title: {
      ru: "Несколько доверенных контактов пациента",
      de: "Mehrere Vertrauenskontakte pro Patient",
    },
    description: {
      ru: "В карточке пациента теперь можно хранить несколько доверенных и экстренных контактов с типом связи, телефоном и заметкой. Данные согласованно сохраняются при создании и редактировании профиля.",
      de: "In der Patientenakte können mehrere Vertrauens- und Notfallkontakte mit Beziehung, Telefonnummer und Notiz gepflegt werden. Die Daten werden beim Erstellen und Bearbeiten konsistent gespeichert.",
    },
  },
  {
    commit: "f278135",
    title: {
      ru: "Защищённый чат и стабильные обновления",
      de: "Geschützter Chat und stabile Aktualisierungen",
    },
    description: {
      ru: "Усилена защита ключей, сообщений и вложений в чатах, добавлены лимиты метаданных и ранняя проверка подключений. Непрочитанные сообщения и события задач доставляются стабильнее.",
      de: "Der Schutz von Schlüsseln, Nachrichten und Anhängen wurde verstärkt; Metadatenlimits und eine frühe Verbindungsprüfung wurden ergänzt. Ungelesene Nachrichten und Aufgabenereignisse werden zuverlässiger zugestellt.",
    },
  },
  {
    commit: "846b6f4",
    title: {
      ru: "Точнее управление пользователями и профилями",
      de: "Präzisere Benutzer- und Profilverwaltung",
    },
    description: {
      ru: "Формы пользователей и пациентов лучше контролируют несохранённые изменения, пароль и подтверждение. Новые разделы появляются в навигации только у сотрудников с подходящей ролью.",
      de: "Benutzer- und Patientenformulare prüfen ungespeicherte Änderungen, Passwort und Bestätigung genauer. Neue Bereiche erscheinen nur für Mitarbeitende mit passender Rolle in der Navigation.",
    },
  },
  {
    commit: "dfbe82d",
    title: {
      ru: "Импорт медицинских документов и анализов",
      de: "Import medizinischer Dokumente und Laborwerte",
    },
    description: {
      ru: "Обновлены распознавание и повторное сканирование документов, предпросмотр источника и импорт лабораторных таблиц. Результаты сохраняют связь с документом и показывают лабораторию как источник.",
      de: "Dokumentenerkennung, erneutes Scannen, Quellenvorschau und der Import von Labortabellen wurden aktualisiert. Ergebnisse bleiben mit dem Dokument verknüpft und zeigen das Labor als Quelle.",
    },
  },
  {
    commit: "edacb62",
    title: {
      ru: "Задачи, события и файлы",
      de: "Aufgaben, Ereignisse und Dateien",
    },
    description: {
      ru: "Задачи получили читаемые номера, вложения, комментарии, архив и связи с пациентами и провайдерами. Исполнитель может менять статус своей задачи, а история действий и уведомления сохраняются.",
      de: "Aufgaben haben lesbare Nummern, Anhänge, Kommentare, Archivierung sowie Verknüpfungen mit Patienten und Providern erhalten. Zuständige können den Status eigener Aufgaben ändern; Verlauf und Benachrichtigungen bleiben erhalten.",
    },
  },
  {
    commit: "d06d0c4",
    title: {
      ru: "Чат и уведомления",
      de: "Chat und Benachrichtigungen",
    },
    description: {
      ru: "Улучшена отправка сообщений, отображение непрочитанных чатов и онлайн-пользователей. События задач, комментарии и новые сообщения собраны в центре уведомлений.",
      de: "Nachrichtenversand, ungelesene Chats und die Anzeige aktiver Benutzer wurden verbessert. Aufgabenereignisse, Kommentare und neue Nachrichten erscheinen im Benachrichtigungszentrum.",
    },
  },
  {
    commit: "577ec21",
    title: {
      ru: "Concierge и взаиморасчёты",
      de: "Concierge und Abrechnung",
    },
    description: {
      ru: "Запросы Concierge можно редактировать и сразу превращать в связанную задачу. Доработаны расходы с чеками, расчётом нетто, налога и брутто, финансовой проверкой и отражением на балансе пациента.",
      de: "Concierge-Anfragen lassen sich bearbeiten und direkt in eine verknüpfte Aufgabe überführen. Auslagen mit Belegen, Netto-, Steuer- und Bruttoberechnung, Finanzprüfung und Patientenbelastung wurden erweitert.",
    },
  },
  {
    commit: "26f22bf",
    title: {
      ru: "Повторный маршрут пациента",
      de: "Erneuter Patientenprozess",
    },
    description: {
      ru: "Для существующего пациента можно запустить повторный визард прямо из профиля, проверить актуальность данных и создать новый заказ без повторного превращения пациента в лид.",
      de: "Für bestehende Patienten kann der erneute Assistent direkt aus dem Profil gestartet werden, um Daten zu prüfen und einen neuen Auftrag ohne erneute Lead-Erfassung anzulegen.",
    },
  },
  {
    commit: "f694c51",
    title: {
      ru: "Профили пациентов и провайдеров",
      de: "Patienten- und Providerprofile",
    },
    description: {
      ru: "В профилях собраны связанные задачи, документы и открытые действия. Медицинские документы можно связать одновременно с пациентом и провайдером, а доверенные контакты пациента больше не ограничены одной записью.",
      de: "Profile bündeln zugeordnete Aufgaben, Dokumente und offene Aktionen. Medizinische Dokumente lassen sich gleichzeitig Patient und Provider zuordnen; Vertrauenskontakte sind nicht mehr auf einen Eintrag begrenzt.",
    },
  },
  {
    commit: "dfbe82d",
    title: {
      ru: "Документы с индивидуальным текстом",
      de: "Dokumente mit individuellem Text",
    },
    description: {
      ru: "Добавлено создание PDF-документа для пациента с собственным вступлением, основным текстом и заключительной заметкой. Форма показывает только действительно обязательные поля.",
      de: "PDF-Dokumente für Patienten können mit eigener Einleitung, Haupttext und Schlussbemerkung erstellt werden. Das Formular kennzeichnet nur tatsächlich erforderliche Felder.",
    },
  },
  {
    commit: "dfbe82d",
    title: {
      ru: "Языки пациента",
      de: "Patientensprachen",
    },
    description: {
      ru: "Список языков пациента синхронизирован между интерфейсом и сервером. Поддерживаются стандартные двухбуквенные коды, включая узбекский язык.",
      de: "Die Liste der Patientensprachen ist zwischen Oberfläche und Server synchronisiert. Standardisierte zweistellige Sprachcodes einschließlich Usbekisch werden unterstützt.",
    },
  },
];

const DEVELOPMENT_RELEASE_NOTES: CustomerReleaseNote[] = [
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

const PRODUCTION_RELEASE_NOTES: CustomerReleaseNote[] = [
  ...DAILY_RELEASE_NOTES,
  {
    commit: "e47e5ab",
    title: { ru: "Рабочие панели", de: "Arbeitsbereiche" },
    description: {
      ru: "Исправлены переходы между клиническими разделами и применение ролевых ограничений на рабочих экранах.",
      de: "Die Navigation zwischen klinischen Bereichen und die rollenbasierten Einschränkungen wurden korrigiert.",
    },
  },
  {
    commit: "5bffe15",
    title: { ru: "Документы пациента", de: "Patientendokumente" },
    description: {
      ru: "Добавлен просмотр документа прямо в системе. Скачивание доступно отдельной кнопкой.",
      de: "Dokumente können direkt im System angesehen und über eine separate Aktion heruntergeladen werden.",
    },
  },
  {
    commit: "3159464",
    title: { ru: "Медицинский профиль", de: "Medizinisches Profil" },
    description: {
      ru: "В карточке пациента объединены диагнозы, план медикаментов и обследования с сохранением связи с пациентом.",
      de: "Diagnosen, Medikationsplan und Untersuchungen wurden in der Patientenakte zusammengeführt und bleiben dem Patienten zugeordnet.",
    },
  },
  {
    commit: "4472d33",
    title: { ru: "Права доступа", de: "Zugriffsrechte" },
    description: {
      ru: "Усилена проверка прав для документов и клинических данных, включая проверку входных данных на сервере.",
      de: "Die Zugriffsprüfung für Dokumente und klinische Daten wurde einschließlich serverseitiger Eingabeprüfung verschärft.",
    },
  },
];

export function resolveCustomerRelease(environment: ReleaseEnvironment): CustomerRelease {
  const isDevelopment = environment.mode === "development";

  return {
    channel: environment.mode,
    build: environment.buildNumber?.trim() || (isDevelopment ? "2026.09.05.1" : "2026.08.11.1"),
    builtAt: environment.buildTimestamp?.trim() || (isDevelopment ? "2026-09-05T20:00:00+03:00" : "2026-08-11T20:20:00+03:00"),
    title: isDevelopment
      ? {
          ru: "Обновления за 5 сентября 2026",
          de: "Aktualisierungen vom 5. September 2026",
        }
      : {
          ru: "Изменения в PROD-сборке",
          de: "Änderungen im PROD-Build",
        },
    notes: isDevelopment ? DEVELOPMENT_RELEASE_NOTES : PRODUCTION_RELEASE_NOTES,
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
 * VITE_BUILD_NUMBER=2026.08.11.1
 * VITE_BUILD_TIMESTAMP=2026-08-11T20:20:00+03:00
 */

export function localizeReleaseText(text: LocalizedText, lang: Lang): string {
  return text[lang];
}
