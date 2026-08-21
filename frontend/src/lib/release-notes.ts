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

const DEVELOPMENT_RELEASE_NOTES: CustomerReleaseNote[] = [
  {
    commit: "448f24b",
    title: {
      ru: "Рабочее место Concierge",
      de: "Concierge-Arbeitsbereich",
    },
    description: {
      ru: "Сервисные запросы, события и следующие действия собраны в одном адаптивном рабочем месте. Доступны доска, список, календарь и карта без медицинской информации.",
      de: "Serviceanfragen, Termine und nächste Schritte sind in einem responsiven Arbeitsbereich gebündelt. Verfügbar sind Board, Liste, Kalender und Karte ohne medizinische Daten.",
    },
  },
  {
    commit: "8dd1554",
    title: {
      ru: "Менеджер задач",
      de: "Aufgabenmanager",
    },
    description: {
      ru: "Добавлены задачи и события с ответственными, сроками, приоритетами, чек-листами, комментариями и историей. Изменения обновляются для участников автоматически.",
      de: "Aufgaben und Ereignisse enthalten Zuständigkeiten, Fristen, Prioritäten, Checklisten, Kommentare und Verlauf. Änderungen werden für Beteiligte automatisch aktualisiert.",
    },
  },
  {
    commit: "3d4d50e",
    title: {
      ru: "Маршруты и адреса",
      de: "Routen und Adressen",
    },
    description: {
      ru: "Задачи и сервисные события объединяются в дневной маршрут. Можно выбрать остановки, изменить их порядок и открыть готовый маршрут с несколькими адресами в Google Maps.",
      de: "Aufgaben und Serviceereignisse werden zu einer Tagesroute verbunden. Stopps lassen sich auswählen, sortieren und als Route mit mehreren Adressen in Google Maps öffnen.",
    },
  },
  {
    commit: "1d68325",
    title: {
      ru: "Партнёры, бронирования и ключи",
      de: "Partner, Buchungen und Schlüssel",
    },
    description: {
      ru: "Concierge может подобрать ресторан, водителя, гостиницу или другого исполнителя, зафиксировать контакт и бронирование. Передача и возврат ключей сохраняются с ответственным и полной историей.",
      de: "Concierge kann Restaurant, Fahrer, Hotel oder andere Leistungserbringer auswählen sowie Kontakt und Buchung dokumentieren. Schlüsselübergabe und Rückgabe werden mit Zuständigkeit und Verlauf gespeichert.",
    },
  },
  {
    commit: "30a5203",
    title: {
      ru: "Расходы и чеки Concierge",
      de: "Concierge-Auslagen und Belege",
    },
    description: {
      ru: "К сервису можно приложить фотографию или файл чека за гостиницу, транспорт и другие расходы, указать сумму, налог, плательщика и дату. До проверки бухгалтером запись не меняет баланс.",
      de: "Zu einem Service können Foto oder Datei eines Belegs für Hotel, Transport und weitere Auslagen mit Betrag, Steuer, Zahler und Datum erfasst werden. Vor Prüfung durch die Buchhaltung ändert sich kein Saldo.",
    },
  },
  {
    commit: "5deda33",
    title: {
      ru: "Проверка расходов бухгалтером",
      de: "Prüfung durch die Buchhaltung",
    },
    description: {
      ru: "В финансах компании появилась очередь чеков Concierge. Руководитель или бухгалтер видит документ, связывает расход с заказом и услугой, затем подтверждает, отклоняет или отменяет проведение.",
      de: "In den Unternehmensfinanzen gibt es eine Prüfliste für Concierge-Belege. Geschäftsführung oder Buchhaltung sieht den Beleg, ordnet ihn Auftrag und Leistung zu und kann ihn buchen, ablehnen oder stornieren.",
    },
  },
  {
    commit: "60869f9",
    title: {
      ru: "Баланс компании",
      de: "Unternehmenssaldo",
    },
    description: {
      ru: "Добавлены денежные счета компании, внутренние переводы и единый обзор поступлений, выплат, открытых обязательств и доступных средств с фильтрами по периоду и валюте.",
      de: "Unternehmenskonten, interne Umbuchungen und eine Gesamtübersicht über Einnahmen, Auszahlungen, offene Verpflichtungen und verfügbare Mittel mit Zeitraum- und Währungsfiltern wurden ergänzt.",
    },
  },
  {
    commit: "b0d06ed",
    title: {
      ru: "Баланс пациента и взаиморасчёты",
      de: "Patientensaldo und Abrechnung",
    },
    description: {
      ru: "Счета, частичные оплаты, предоплаты, возвраты, корректировки и кредитовые документы объединены в проверяемую историю. Система отдельно показывает задолженность пациента и его переплату.",
      de: "Rechnungen, Teilzahlungen, Vorauszahlungen, Erstattungen, Korrekturen und Gutschriften sind in einem prüfbaren Verlauf zusammengeführt. Patientenschuld und Guthaben werden getrennt ausgewiesen.",
    },
  },
  {
    commit: "3ce7678",
    title: {
      ru: "Расчёты с партнёрами и исполнителями",
      de: "Abrechnung mit Partnern und Leistungserbringern",
    },
    description: {
      ru: "Для партнёров и исполнителей доступны выписки, начисления, произведённые выплаты и остаток к выплате. Расход пациента и обязательство компании учитываются без двойного начисления.",
      de: "Für Partner und Leistungserbringer stehen Kontoauszüge, Belastungen, geleistete Zahlungen und offene Beträge bereit. Patientenforderung und Unternehmensverpflichtung werden ohne Doppelzählung erfasst.",
    },
  },
  {
    commit: "3d4d50e",
    title: {
      ru: "Экономика заказа",
      de: "Auftragswirtschaftlichkeit",
    },
    description: {
      ru: "По заказу видны плановые и фактические расходы, поступления от пациента, неоплаченные суммы и финансовый результат. Суммы разделены по услугам и валютам.",
      de: "Pro Auftrag werden geplante und tatsächliche Kosten, Patienteneingänge, offene Beträge und Ergebnis dargestellt. Beträge sind nach Leistungen und Währungen getrennt.",
    },
  },
  {
    commit: "f0391d5",
    title: {
      ru: "Уведомления и автоматическое обновление",
      de: "Benachrichtigungen und automatische Aktualisierung",
    },
    description: {
      ru: "Бухгалтер получает уведомление о новом чеке с переходом прямо к проверке. Concierge получает решение по расходу, а очереди и рабочие экраны обновляются автоматически.",
      de: "Die Buchhaltung erhält bei einem neuen Beleg eine Benachrichtigung mit direktem Link zur Prüfung. Concierge erhält die Entscheidung; Listen und Arbeitsbereiche aktualisieren sich automatisch.",
    },
  },
];

const PRODUCTION_RELEASE_NOTES: CustomerReleaseNote[] = [
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
    build: environment.buildNumber?.trim() || "2026.08.11.1",
    builtAt: environment.buildTimestamp?.trim() || "2026-08-11T20:20:00+03:00",
    title: isDevelopment
      ? {
          ru: "Новое: от Concierge до бухгалтерии",
          de: "Neu: vom Concierge bis zur Buchhaltung",
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
