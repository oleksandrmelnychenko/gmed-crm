import type { Lang } from "@/lib/i18n";

import type { PersonalField } from "./lead-request-model";

/**
 * Texts of the lead cabinet in DE, EN, UA and RU (the rest of the patient
 * portal speaks DE and RU; owner request 2026-10-04 for UA and EN).
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
  language: string;
  sectionPerson: string;
  sectionAddress: string;
  sectionContact: string;
  sectionConsent: string;
  sectionUpload: string;
  stepOf: (index: number, total: number) => string;
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
  language: "Sprache",
  sectionPerson: "Persönliche Daten",
  sectionAddress: "Adresse",
  sectionContact: "Kontakt",
  sectionConsent: "Einwilligung",
  sectionUpload: "Ihre Unterlagen",
  stepOf: (index, total) => `Schritt ${index} von ${total}`,
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
  language: "Язык",
  sectionPerson: "Личные данные",
  sectionAddress: "Адрес",
  sectionContact: "Контакт",
  sectionConsent: "Согласие",
  sectionUpload: "Ваши документы",
  stepOf: (index, total) => `Шаг ${index} из ${total}`,
};

const uk: LeadRequestText = {
  title: "Ваша заявка",
  titleGuardian: "Заявка для вашої дитини",
  intro: "Будь ласка, заповніть свої особисті дані та завантажте документи. Усе зберігається автоматично.",
  introGuardian:
    "Будь ласка, заповніть особисті дані дитини та завантажте документи. Усе зберігається автоматично.",
  deadline: (date) => `Будь ласка, заповніть до ${date}.`,
  deadlineNote:
    "З міркувань захисту даних заявки, робота над якими до цієї дати не продовжена, після неї видаляються автоматично.",
  stepData: "Дані",
  stepDocuments: "Документи",
  stepSend: "Надсилання",
  fields: {
    first_name: "Ім'я",
    middle_name: "По батькові / друге ім'я",
    last_name: "Прізвище",
    date_of_birth: "Дата народження",
    legal_sex: "Стать за документами",
    citizenships: "Громадянство",
    street_address: "Вулиця і будинок",
    zip_code: "Поштовий індекс",
    city: "Місто",
    country: "Країна проживання",
    phone: "Телефон",
    primary_language: "Бажана мова",
  },
  legalSexOptions: {
    female: "Жіноча",
    male: "Чоловіча",
    diverse: "Інша",
    no_entry: "Без зазначення",
  },
  choose: "Виберіть",
  citizenshipsPlaceholder: "Додати країну",
  required: "Обов'язкове поле",
  saving: "Зберігається…",
  saved: "Збережено",
  notSaved: "Не збережено",
  invalidField: "Будь ласка, перевірте це поле.",
  minorNeedsGuardian:
    "Для осіб, молодших 18 років, заявку заповнюють батьки або законний представник. Ми повідомили вашу команду і зв'яжемося з вами.",
  next: "Далі",
  back: "Назад",
  inquiryConsentLabel: "Я погоджуюся, що мої дані обробляються для розгляду мого звернення.",
  privacyLink: "Інформація про захист даних",
  consentGivenAt: (dateTime) => `Згоду надано ${dateTime}`,
  consentWithdraw: "Відкликати згоду",
  consentWithdrawConfirm: "Відкликати згоду? Відкликання діє на майбутнє; ми отримаємо повідомлення.",
  documentsIntro:
    "Завантажте медичні документи, які у вас уже є (виписки, висновки, знімки, аналізи). PDF, JPG або PNG, до 25 МБ на файл. Цей крок необов'язковий.",
  healthConsentTitle: "Згода на обробку даних про здоров'я",
  healthConsentLabel: "Я даю згоду (обов'язково перед першим завантаженням).",
  uploadButton: "Вибрати файли",
  uploading: "Завантажується…",
  uploadNeedsConsent: "Щоб завантажити файли, спершу підтвердьте згоду вище.",
  fileTooLarge: (name) => `${name} більший за 25 МБ.`,
  noDocuments: "Документи ще не завантажено.",
  documentsOptional: "Заявку можна надіслати і без документів.",
  removeDocument: "Видалити",
  documentTakenOver: "Прийнято в роботу",
  maxDocuments: (count) => `Не більше ${count} файлів на заявку.`,
  sendTitle: "Надіслати вашому менеджеру",
  sendSummaryFields: (filled, total) => `Особисті дані: заповнено ${filled} з ${total}`,
  sendSummaryDocuments: (count) => `Документи: ${count}`,
  missingTitle: "Будь ласка, доповніть:",
  inquiryConsentMissing: "Будь ласка, надайте згоду на обробку даних у розділі «Дані».",
  sendButton: "Надіслати менеджеру",
  sending: "Надсилається…",
  sentTitle: "Дякуємо!",
  sentBody: (dateTime) => `Ваші дані надіслано ${dateTime}. Ми зв'яжемося з вами.`,
  sentAgainHint: "Змінили щось після надсилання? Просто надішліть дані ще раз.",
  sendAgain: "Надіслати ще раз",
  editData: "Змінити дані",
  loadFailed: "Не вдалося завантажити заявку.",
  retry: "Спробувати ще раз",
  noRequest: "Для вашого акаунта зараз немає відкритої заявки.",
  requestFor: "Заявка для",
  language: "Мова",
  sectionPerson: "Особисті дані",
  sectionAddress: "Адреса",
  sectionContact: "Контакт",
  sectionConsent: "Згода",
  sectionUpload: "Ваші документи",
  stepOf: (index, total) => `Крок ${index} з ${total}`,
};

const en: LeadRequestText = {
  title: "Your request",
  titleGuardian: "Request for your child",
  intro: "Please enter your personal details and upload your documents. Everything is saved automatically.",
  introGuardian:
    "Please enter your child's personal details and upload the documents. Everything is saved automatically.",
  deadline: (date) => `Please complete by ${date}.`,
  deadlineNote:
    "For data protection reasons, requests that are not taken further by then are deleted automatically after this date.",
  stepData: "Details",
  stepDocuments: "Documents",
  stepSend: "Send",
  fields: {
    first_name: "First name",
    middle_name: "Middle name",
    last_name: "Last name",
    date_of_birth: "Date of birth",
    legal_sex: "Sex as in your ID",
    citizenships: "Citizenship(s)",
    street_address: "Street and number",
    zip_code: "Postcode",
    city: "City",
    country: "Country of residence",
    phone: "Phone",
    primary_language: "Preferred language",
  },
  legalSexOptions: {
    female: "Female",
    male: "Male",
    diverse: "Diverse",
    no_entry: "Not specified",
  },
  choose: "Select",
  citizenshipsPlaceholder: "Add country",
  required: "Required",
  saving: "Saving…",
  saved: "Saved",
  notSaved: "Not saved",
  invalidField: "Please check this entry.",
  minorNeedsGuardian:
    "For persons under 18 the parents or the legal guardian fill in the request. We have informed your team and will get in touch.",
  next: "Next",
  back: "Back",
  inquiryConsentLabel: "I agree that my details are processed to handle my request.",
  privacyLink: "Privacy information",
  consentGivenAt: (dateTime) => `Agreed on ${dateTime}`,
  consentWithdraw: "Withdraw consent",
  consentWithdrawConfirm: "Withdraw your consent? The withdrawal applies to the future; we will be informed.",
  documentsIntro:
    "Upload medical documents you already have (doctors' letters, findings, images, lab results). PDF, JPG or PNG, up to 25 MB per file. This step is optional.",
  healthConsentTitle: "Consent to health data processing",
  healthConsentLabel: "I consent (required before the first upload).",
  uploadButton: "Choose files",
  uploading: "Uploading…",
  uploadNeedsConsent: "To upload files, first confirm the consent above.",
  fileTooLarge: (name) => `${name} is larger than 25 MB.`,
  noDocuments: "No documents uploaded yet.",
  documentsOptional: "You can also send the request without documents.",
  removeDocument: "Remove",
  documentTakenOver: "Taken over by us",
  maxDocuments: (count) => `At most ${count} files per request.`,
  sendTitle: "Send to your contact person",
  sendSummaryFields: (filled, total) => `Personal details: ${filled} of ${total}`,
  sendSummaryDocuments: (count) => `Documents: ${count}`,
  missingTitle: "Please add:",
  inquiryConsentMissing: "Please agree to the processing of your details under \"Details\".",
  sendButton: "Send to the manager",
  sending: "Sending…",
  sentTitle: "Thank you!",
  sentBody: (dateTime) => `Your details were sent on ${dateTime}. We will get in touch.`,
  sentAgainHint: "Changed something afterwards? Just send your details again.",
  sendAgain: "Send again",
  editData: "Edit details",
  loadFailed: "The request could not be loaded.",
  retry: "Try again",
  noRequest: "There is no open request for your account at the moment.",
  requestFor: "Request for",
  language: "Language",
  sectionPerson: "Personal details",
  sectionAddress: "Address",
  sectionContact: "Contact",
  sectionConsent: "Consent",
  sectionUpload: "Your documents",
  stepOf: (index, total) => `Step ${index} of ${total}`,
};

/** Languages of the lead cabinet: the portal's DE/RU plus UA and EN. */
export type LeadCabinetLang = "de" | "en" | "uk" | "ru";

export const LEAD_CABINET_LANGS: readonly { value: LeadCabinetLang; label: string; name: string }[] = [
  { value: "de", label: "DE", name: "Deutsch" },
  { value: "en", label: "EN", name: "English" },
  { value: "uk", label: "UA", name: "Українська" },
  { value: "ru", label: "RU", name: "Русский" },
];

/** A stored or preferred language as a cabinet language, if it is one. */
export function asLeadCabinetLang(value: string | null | undefined): LeadCabinetLang | null {
  const code = (value ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (code === "ua") return "uk";
  return code === "de" || code === "en" || code === "uk" || code === "ru" ? code : null;
}

/**
 * The language the cabinet shows. UA and EN exist only here, so they stay
 * until the person picks another one. DE and RU are the portal's languages:
 * the cabinet then follows the portal, so its language button in the top bar
 * and the switch above the title never disagree. Without a choice the
 * language of the request applies if it is UA or EN; a DE/RU request language
 * is taken over into the portal once, for an account without a language of
 * its own (see `LeadRequestPage`).
 */
export function resolveLeadCabinetLang(
  chosen: LeadCabinetLang | null,
  requestLang: LeadCabinetLang | null,
  portalLang: Lang,
): LeadCabinetLang {
  if (chosen === "en" || chosen === "uk") return chosen;
  if (chosen) return portalLang;
  return requestLang === "en" || requestLang === "uk" ? requestLang : portalLang;
}

export function leadRequestText(lang: Lang | LeadCabinetLang | string): LeadRequestText {
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
