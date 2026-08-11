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
    commit: "c20292f",
    title: {
      ru: "Роли и рабочие кабинеты",
      de: "Rollen und Arbeitsbereiche",
    },
    description: {
      ru: "Разделены кабинеты CEO, консьержа и бухгалтера. Для каждой роли настроены собственные разделы, показатели и рабочие приоритеты.",
      de: "Die Arbeitsbereiche für CEO, Concierge und Buchhaltung wurden getrennt. Jede Rolle hat eigene Bereiche, Kennzahlen und Prioritäten.",
    },
  },
  {
    commit: "f60226c",
    title: {
      ru: "Список сотрудников",
      de: "Mitarbeiterverzeichnis",
    },
    description: {
      ru: "Исправлена загрузка списка сотрудников и связанных с ними ролей. Данные корректно отображаются после входа в систему.",
      de: "Das Laden des Mitarbeiterverzeichnisses und der zugehörigen Rollen wurde korrigiert. Die Daten erscheinen nach der Anmeldung korrekt.",
    },
  },
  {
    commit: "11b037b",
    title: {
      ru: "Доступ к документам пациента",
      de: "Zugriff auf Patientendokumente",
    },
    description: {
      ru: "Уточнены проверки прав на просмотр, скачивание и обработку медицинских документов для каждой роли.",
      de: "Die Berechtigungsprüfungen für Ansicht, Download und Verarbeitung medizinischer Dokumente wurden je Rolle präzisiert.",
    },
  },
  {
    commit: "cd63d60",
    title: {
      ru: "Клиническая карта пациента",
      de: "Klinische Patientenakte",
    },
    description: {
      ru: "Диагнозы, анамнез, обследования и специализации приведены к единой логике отображения и редактирования с учётом роли сотрудника.",
      de: "Diagnosen, Anamnese, Untersuchungen und Fachrichtungen folgen nun einer einheitlichen Anzeige- und Bearbeitungslogik je Mitarbeiterrolle.",
    },
  },
  {
    commit: "5bffe15",
    title: {
      ru: "Предпросмотр документов",
      de: "Dokumentvorschau",
    },
    description: {
      ru: "Клик по документу открывает предпросмотр. Скачивание вынесено в отдельное действие, чтобы файл не загружался автоматически.",
      de: "Ein Klick auf ein Dokument öffnet die Vorschau. Der Download ist eine separate Aktion und startet nicht mehr automatisch.",
    },
  },
  {
    commit: "9b6b7ed",
    title: {
      ru: "Стабильность распознавания документов",
      de: "Stabile Dokumenterkennung",
    },
    description: {
      ru: "Зафиксированы версии компонентов распознавания, чтобы результат обработки документов не менялся после обновления внешних образов.",
      de: "Die Versionen der Erkennungskomponenten wurden fixiert, damit sich Verarbeitungsergebnisse nach externen Image-Updates nicht unerwartet ändern.",
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
          ru: "Изменения в DEV-сборке",
          de: "Änderungen im DEV-Build",
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
