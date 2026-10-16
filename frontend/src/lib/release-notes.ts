import { formatAppDate } from "@/lib/app-time-zone";
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
    commit: "9629c4b",
    title: { ru: "Автосохранение заявки и одна кнопка «Далее»", de: "Automatisches Speichern und eine Weiter-Schaltfläche" },
    description: {
      ru: "Выбор согласий и сведения о третьих лицах сохраняются автоматически. «Далее» дожидается сохранения текущего шага и проверяет свежие данные, без отдельного «Сохранить выбор».",
      de: "Einwilligungen und Angaben zu Dritten werden automatisch gespeichert. „Weiter“ wartet auf das Speichern des aktuellen Schritts und prüft die aktuellen Daten; eine separate Auswahlbestätigung entfällt.",
    },
  },
  {
    commit: "74922b2",
    title: { ru: "Адрес представителя в короткой форме", de: "Vertreteradresse im Kurzformular" },
    description: {
      ru: "Улица, индекс и город доступны уже в короткой форме родителя. Адрес можно перенести из данных ребёнка; сохранённые поля используются и в данных выбранного плательщика.",
      de: "Straße, Postleitzahl und Ort sind bereits im Kurzformular der Eltern verfügbar. Die Adresse kann vom Kind übernommen werden; gespeicherte Angaben werden auch für den ausgewählten Kostenträger verwendet.",
    },
  },
  {
    commit: "3191533",
    title: { ru: "Один аккаунт родителя для нескольких детей", de: "Ein Elternkonto für mehrere Kinder" },
    description: {
      ru: "Дети связаны с одним аккаунтом родителя, роли матери и отца указаны явно. При оформлении сохраняются семейные связи и доступна дата начала договора.",
      de: "Mehrere Kinder sind mit einem Elternkonto verknüpft; Mutter und Vater werden ausdrücklich benannt. Familienverknüpfungen bleiben bei der Aufnahme erhalten, der Vertragsbeginn lässt sich angeben.",
    },
  },
  {
    commit: "a9d9384",
    title: { ru: "Разделы портала по подписке в заказе", de: "Portalbereiche nach Abonnement im Auftrag" },
    description: {
      ru: "Без активной подписки в заказе остаются доступны аккаунт, конфиденциальность, документы и счета. Остальные сервисные разделы показаны с замочком; доступ проверяет и сервер.",
      de: "Ohne aktives Abonnement im Auftrag bleiben Konto, Datenschutz, Dokumente und Rechnungen verfügbar. Die übrigen Servicebereiche sind mit einem Schloss gekennzeichnet; auch der Server prüft den Zugriff.",
    },
  },
  {
    commit: "9573afc",
    title: { ru: "Именной список получателей информации", de: "Namentlich benannte Auskunftsempfänger" },
    description: {
      ru: "Раздел «Предоставление информации третьим лицам» находится внутри «Ваша заявка». Названные лица и объём разрешённой информации согласованы между формуляром и документом согласия.",
      de: "„Auskunft an Dritte“ ist Teil von „Ihre Anfrage“. Die benannten Personen und der erlaubte Auskunftsumfang werden zwischen Formular und Einwilligungsdokument abgeglichen.",
    },
  },
  {
    commit: "2549f6d",
    title: { ru: "Получатель счёта и короткая форма родителей", de: "Rechnungsempfänger und kurze Elternangaben" },
    description: {
      ru: "Если представителей двое, можно выбрать конкретного получателя счёта. Родителям доступна короткая форма, а отправка анкеты плательщика завершается отдельным экраном подтверждения.",
      de: "Bei zwei Vertretern lässt sich der Rechnungsempfänger gezielt auswählen. Eltern erhalten ein Kurzformular; nach dem Absenden des Kostenträgerformulars erscheint eine eigene Bestätigung.",
    },
  },
  {
    commit: "7e714d8",
    title: { ru: "Актуальные статусы электронных подписей", de: "Aktueller Stand elektronischer Signaturen" },
    description: {
      ru: "Видны состояние пакета и подпись каждого участника. После подписи клиента статус обновляется и сотрудник получает уведомление; подписанный PDF и отчёт доступны в запросе.",
      de: "Paketstatus und Signaturen der einzelnen Beteiligten sind sichtbar. Nach der Kundenunterschrift wird der Status aktualisiert und die zuständige Person benachrichtigt; PDF und Signaturbericht sind im Auftrag abrufbar.",
    },
  },
  {
    commit: "da80622",
    title: { ru: "Текст защиты данных из формуляра", de: "Datenschutzhinweis aus dem Formular" },
    description: {
      ru: "Ссылки из формуляра открывают согласованный текст из DOCX на немецком и русском. Длинный текст доступен с прокруткой на компьютере и телефоне.",
      de: "Formularlinks öffnen den abgestimmten DOCX-Text auf Deutsch und Russisch. Der vollständige Text ist auf Computer und Smartphone scrollbar.",
    },
  },
];

export function resolveCustomerRelease(environment: ReleaseEnvironment): CustomerRelease {
  const isDevelopment = environment.mode === "development";
  const timestamp = environment.buildTimestamp?.trim() || "";
  const buildDate = formatAppDate(timestamp);
  const builtAt = buildDate ? timestamp : "";
  const title: LocalizedText = isDevelopment
    ? { ru: "Обновления", de: "Aktualisierungen" }
    : { ru: "Релиз", de: "Release" };
  if (buildDate) {
    title.ru += `${isDevelopment ? " за" : " от"} ${buildDate}`;
    title.de += ` vom ${buildDate}`;
  }

  return {
    channel: environment.mode,
    build: environment.buildNumber?.trim() || (isDevelopment ? "local" : "unversioned"),
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
 * VITE_BUILD_NUMBER=release-sha-<source commit>
 * VITE_BUILD_TIMESTAMP=<UTC ISO build timestamp>
 */

export function localizeReleaseText(text: LocalizedText, lang: Lang): string {
  return text[lang];
}
