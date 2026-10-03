import type { Lang } from "@/lib/i18n";

import type { PersonalField } from "./lead-request-model";

/**
 * Texts of the lead cabinet (the patient portal speaks DE and RU; the
 * language follows the portal toggle and the account setting).
 */
export type LeadRequestText = {
  title: string;
  titleGuardian: string;
  intro: string;
  introGuardian: string;
  deadline: (date: string) => string;
  deadlineNote: string;
  stepData: string;
  stepDocuments: string;
  stepSend: string;
  fields: Record<PersonalField, string>;
  legalSexOptions: Record<"female" | "male" | "diverse" | "no_entry", string>;
  choose: string;
  citizenshipsPlaceholder: string;
  required: string;
  saving: string;
  saved: string;
  notSaved: string;
  invalidField: string;
  minorNeedsGuardian: string;
  next: string;
  back: string;
  inquiryConsentLabel: string;
  privacyLink: string;
  consentGivenAt: (dateTime: string) => string;
  consentWithdraw: string;
  consentWithdrawConfirm: string;
  documentsIntro: string;
  healthConsentTitle: string;
  healthConsentLabel: string;
  uploadButton: string;
  uploading: string;
  uploadNeedsConsent: string;
  fileTooLarge: (name: string) => string;
  noDocuments: string;
  documentsOptional: string;
  removeDocument: string;
  documentTakenOver: string;
  maxDocuments: (count: number) => string;
  sendTitle: string;
  sendSummaryFields: (filled: number, total: number) => string;
  sendSummaryDocuments: (count: number) => string;
  missingTitle: string;
  inquiryConsentMissing: string;
  sendButton: string;
  sending: string;
  sentTitle: string;
  sentBody: (dateTime: string) => string;
  sentAgainHint: string;
  sendAgain: string;
  editData: string;
  loadFailed: string;
  retry: string;
  noRequest: string;
  requestFor: string;
};

const de: LeadRequestText = {
  title: "Ihre Anfrage",
  titleGuardian: "Anfrage für Ihr Kind",
  intro: "Bitte tragen Sie Ihre persönlichen Daten ein und laden Sie Ihre Unterlagen hoch. Alles wird automatisch gespeichert.",
  introGuardian:
    "Bitte tragen Sie die persönlichen Daten Ihres Kindes ein und laden Sie die Unterlagen hoch. Alles wird automatisch gespeichert.",
  deadline: (date) => `Bitte bis ${date} ausfüllen.`,
  deadlineNote:
    "Aus Datenschutzgründen löschen wir Anfragen, die bis dahin nicht weiterbearbeitet werden, nach diesem Datum automatisch.",
  stepData: "Daten",
  stepDocuments: "Unterlagen",
  stepSend: "Senden",
  fields: {
    first_name: "Vorname",
    middle_name: "Zweiter Vorname",
    last_name: "Nachname",
    date_of_birth: "Geburtsdatum",
    legal_sex: "Geschlecht laut Ausweis",
    citizenships: "Staatsangehörigkeit(en)",
    street_address: "Straße und Hausnummer",
    zip_code: "Postleitzahl",
    city: "Ort",
    country: "Wohnsitzland",
    phone: "Telefon",
    primary_language: "Bevorzugte Sprache",
  },
  legalSexOptions: {
    female: "Weiblich",
    male: "Männlich",
    diverse: "Divers",
    no_entry: "Keine Angabe",
  },
  choose: "Auswählen",
  citizenshipsPlaceholder: "Land hinzufügen",
  required: "Pflichtfeld",
  saving: "Wird gespeichert…",
  saved: "Gespeichert",
  notSaved: "Nicht gespeichert",
  invalidField: "Bitte prüfen Sie diese Angabe.",
  minorNeedsGuardian:
    "Für Personen unter 18 Jahren füllen die Eltern oder der gesetzliche Vertreter die Anfrage aus. Wir haben Ihr Team informiert und melden uns.",
  next: "Weiter",
  back: "Zurück",
  inquiryConsentLabel: "Ich bin einverstanden, dass meine Angaben zur Bearbeitung meiner Anfrage verarbeitet werden.",
  privacyLink: "Datenschutzhinweise",
  consentGivenAt: (dateTime) => `Zugestimmt am ${dateTime}`,
  consentWithdraw: "Einwilligung widerrufen",
  consentWithdrawConfirm:
    "Einwilligung wirklich widerrufen? Der Widerruf gilt für die Zukunft; wir werden informiert.",
  documentsIntro:
    "Laden Sie ärztliche Unterlagen hoch, die Sie bereits haben (Arztbriefe, Befunde, Bilder, Laborwerte). PDF, JPG oder PNG, bis 25 MB pro Datei. Dieser Schritt ist freiwillig.",
  healthConsentTitle: "Einwilligung zu Gesundheitsdaten",
  healthConsentLabel: "Ich willige ein (Pflicht vor dem ersten Hochladen).",
  uploadButton: "Dateien auswählen",
  uploading: "Wird hochgeladen…",
  uploadNeedsConsent: "Zum Hochladen bitte zuerst die Einwilligung oben bestätigen.",
  fileTooLarge: (name) => `${name} ist größer als 25 MB.`,
  noDocuments: "Noch keine Unterlagen hochgeladen.",
  documentsOptional: "Sie können die Anfrage auch ohne Unterlagen senden.",
  removeDocument: "Entfernen",
  documentTakenOver: "Von uns übernommen",
  maxDocuments: (count) => `Höchstens ${count} Dateien pro Anfrage.`,
  sendTitle: "An Ihren Ansprechpartner senden",
  sendSummaryFields: (filled, total) => `Persönliche Daten: ${filled} von ${total} Angaben`,
  sendSummaryDocuments: (count) => `Unterlagen: ${count}`,
  missingTitle: "Bitte noch ergänzen:",
  inquiryConsentMissing: "Bitte stimmen Sie unter „Daten“ der Verarbeitung Ihrer Angaben zu.",
  sendButton: "An den Manager senden",
  sending: "Wird gesendet…",
  sentTitle: "Vielen Dank!",
  sentBody: (dateTime) => `Ihre Angaben wurden am ${dateTime} gesendet. Wir melden uns bei Ihnen.`,
  sentAgainHint: "Sie haben danach noch etwas geändert? Senden Sie die Angaben einfach erneut.",
  sendAgain: "Erneut senden",
  editData: "Angaben ändern",
  loadFailed: "Die Anfrage konnte nicht geladen werden.",
  retry: "Erneut versuchen",
  noRequest: "Für Ihr Konto ist derzeit keine offene Anfrage vorhanden.",
  requestFor: "Anfrage für",
};

const ru: LeadRequestText = {
  title: "Ваша заявка",
  titleGuardian: "Заявка для вашего ребёнка",
  intro: "Пожалуйста, заполните свои личные данные и загрузите документы. Всё сохраняется автоматически.",
  introGuardian:
    "Пожалуйста, заполните личные данные ребёнка и загрузите документы. Всё сохраняется автоматически.",
  deadline: (date) => `Пожалуйста, заполните до ${date}.`,
  deadlineNote:
    "Из соображений защиты данных заявки, работа по которым к этой дате не продолжена, после неё удаляются автоматически.",
  stepData: "Данные",
  stepDocuments: "Документы",
  stepSend: "Отправка",
  fields: {
    first_name: "Имя",
    middle_name: "Отчество / второе имя",
    last_name: "Фамилия",
    date_of_birth: "Дата рождения",
    legal_sex: "Пол по документам",
    citizenships: "Гражданство",
    street_address: "Улица и дом",
    zip_code: "Почтовый индекс",
    city: "Город",
    country: "Страна проживания",
    phone: "Телефон",
    primary_language: "Предпочитаемый язык",
  },
  legalSexOptions: {
    female: "Женский",
    male: "Мужской",
    diverse: "Другой",
    no_entry: "Без указания",
  },
  choose: "Выберите",
  citizenshipsPlaceholder: "Добавить страну",
  required: "Обязательное поле",
  saving: "Сохраняется…",
  saved: "Сохранено",
  notSaved: "Не сохранено",
  invalidField: "Пожалуйста, проверьте это поле.",
  minorNeedsGuardian:
    "Для лиц младше 18 лет заявку заполняют родители или законный представитель. Мы сообщили вашей команде и свяжемся с вами.",
  next: "Далее",
  back: "Назад",
  inquiryConsentLabel: "Я согласен(на), что мои данные обрабатываются для рассмотрения моего обращения.",
  privacyLink: "Информация о защите данных",
  consentGivenAt: (dateTime) => `Согласие дано ${dateTime}`,
  consentWithdraw: "Отозвать согласие",
  consentWithdrawConfirm: "Отозвать согласие? Отзыв действует на будущее; мы получим уведомление.",
  documentsIntro:
    "Загрузите медицинские документы, которые у вас уже есть (выписки, заключения, снимки, анализы). PDF, JPG или PNG, до 25 МБ на файл. Этот шаг необязателен.",
  healthConsentTitle: "Согласие на обработку данных о здоровье",
  healthConsentLabel: "Я даю согласие (обязательно перед первой загрузкой).",
  uploadButton: "Выбрать файлы",
  uploading: "Загружается…",
  uploadNeedsConsent: "Чтобы загрузить файлы, сначала подтвердите согласие выше.",
  fileTooLarge: (name) => `${name} больше 25 МБ.`,
  noDocuments: "Документы ещё не загружены.",
  documentsOptional: "Заявку можно отправить и без документов.",
  removeDocument: "Удалить",
  documentTakenOver: "Принято в работу",
  maxDocuments: (count) => `Не более ${count} файлов на заявку.`,
  sendTitle: "Отправить вашему менеджеру",
  sendSummaryFields: (filled, total) => `Личные данные: заполнено ${filled} из ${total}`,
  sendSummaryDocuments: (count) => `Документы: ${count}`,
  missingTitle: "Пожалуйста, дополните:",
  inquiryConsentMissing: "Пожалуйста, дайте согласие на обработку данных в разделе «Данные».",
  sendButton: "Отправить менеджеру",
  sending: "Отправляется…",
  sentTitle: "Спасибо!",
  sentBody: (dateTime) => `Ваши данные отправлены ${dateTime}. Мы свяжемся с вами.`,
  sentAgainHint: "Изменили что-то после отправки? Просто отправьте данные ещё раз.",
  sendAgain: "Отправить ещё раз",
  editData: "Изменить данные",
  loadFailed: "Не удалось загрузить заявку.",
  retry: "Повторить",
  noRequest: "Для вашего аккаунта сейчас нет открытой заявки.",
  requestFor: "Заявка для",
};

export function leadRequestText(lang: Lang | string): LeadRequestText {
  return lang === "de" ? de : ru;
}
