import type { Lang } from "@/lib/i18n";

import type {
  ContactChannel,
  IdentificationField,
  LegalQuestion,
  PayerField,
  PersonalField,
  SubmitField,
} from "./lead-request-model";

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
  missingTitle: string;
  inquiryConsentMissing: string;
  sendButton: string;
  sending: string;
  sentTitle: string;
  sentBody: (dateTime: string) => string;
  /** After sending: what the person can expect, in order. */
  nextTitle: string;
  nextSteps: readonly string[];
  sentSummaryTitle: string;
  sendAgain: string;
  editData: string;
  addDocuments: string;
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
  sectionInsurance: string;
  notStated: string;
  insuranceAnswerOptions: { yes: string; no: string };
  insuranceTypeOptions: { private: string; public: string; foreign: string };
  insuranceCoverageOptions: { yes: string; no: string; not_sure: string };
  /** After sending, when the request was changed: why to send again. */
  changedAfterSend: string;
  /** "Who pays" (owner request 2026-10-05). */
  sectionPayer: string;
  payerQuestion: string;
  payerOptions: { self: string; third_party: string };
  /** The same answers when a parent fills in the request of a child. */
  payerOptionsGuardian: { self: string; third_party: string };
  payerIntro: string;
  payerInformHint: string;
  /** Prefix of a payer field in the list of what is still missing. */
  payerPerson: string;
  payerRelationship: string;
  payerEmail: string;
  /** Own economic interest (GwG), part of "who pays". */
  ownAccountQuestion: string;
  beneficialOwner: string;
  /** The same two when a parent fills in the request of a child. */
  ownAccountQuestionGuardian: string;
  beneficialOwnerGuardian: string;
  /** The statements for the GwG identification (owner spec 2026-10-05). */
  identificationFields: Record<IdentificationField, string>;
  /** Questions that say "you", for a parent who fills in the request of a child. */
  identificationFieldsGuardian: Record<"pep_self" | "pep_related" | "high_risk_country", string>;
  /** Short names of the legal questions for the list of what is still missing. */
  legalTopics: Record<LegalQuestion, string>;
  yesNo: { yes: string; no: string };
  salutationOptions: { mr: string; ms: string; none: string };
  contactChannelOptions: Record<ContactChannel, string>;
  idDocumentTypeOptions: { passport: string; id_card: string; residence_permit: string };
  sectionIdentity: string;
  identityUploadButton: string;
  identityUploadHint: string;
  identityUploadNeedsConsent: string;
  identityNote: string;
  noIdentityDocuments: string;
  /** The uploaded copies in the summary and, when none is there, in the missing list. */
  identityFiles: string;
  idDocumentExpired: string;
  sectionLegal: string;
  legalIntro: string;
  /** Prefix of a legal question in the list of what is still missing. */
  legalShort: string;
  /** Step "send": what will be sent, and the confirmation. */
  summaryIntro: string;
  summaryEmpty: string;
  declarationTitle: string;
  declarationLabel: string;
  declarationRequired: string;
  declarationGivenAt: (dateTime: string) => string;
};

/** Label of a payer field; identity and address reuse the patient's labels. */
export function payerFieldLabel(text: LeadRequestText, field: PayerField, guardian = false): string {
  switch (field) {
    case "payer_kind":
      return text.payerQuestion;
    case "payer_first_name":
      return text.fields.first_name;
    case "payer_last_name":
      return text.fields.last_name;
    case "payer_date_of_birth":
      return text.fields.date_of_birth;
    case "payer_citizenships":
      return text.fields.citizenships;
    case "payer_relationship":
      return text.payerRelationship;
    case "payer_street":
      return text.fields.street_address;
    case "payer_zip":
      return text.fields.zip_code;
    case "payer_city":
      return text.fields.city;
    case "payer_country":
      return text.fields.country;
    case "payer_phone":
      return text.fields.phone;
    case "payer_email":
      return text.payerEmail;
    // The own economic interest is asked about the patient: a parent reads it so.
    case "payer_own_account":
      return guardian ? text.ownAccountQuestionGuardian : text.ownAccountQuestion;
    case "payer_beneficial_owner":
      return guardian ? text.beneficialOwnerGuardian : text.beneficialOwner;
  }
}

/**
 * Label of a statement for the identification. A parent who fills in the
 * request of a child reads the questions about the patient, not about "you".
 */
export function identificationFieldLabel(text: LeadRequestText, field: IdentificationField, guardian = false): string {
  const forGuardian: Partial<Record<IdentificationField, string>> = text.identificationFieldsGuardian;
  return (guardian ? forGuardian[field] : undefined) ?? text.identificationFields[field];
}

const LEGAL_TOPIC_OF: Partial<Record<SubmitField, LegalQuestion>> = {
  pep_self: "pep_self",
  pep_self_details: "pep_self",
  pep_related: "pep_related",
  pep_related_details: "pep_related",
  high_risk_country: "high_risk_country",
  high_risk_country_code: "high_risk_country",
  sanctions_links: "sanctions_links",
  sanctions_links_details: "sanctions_links",
};

/**
 * A field in the list of what is still missing before sending. Fields of a
 * section whose labels do not speak for themselves carry the section's name.
 */
export function submitFieldLabel(text: LeadRequestText, field: SubmitField, guardian = false): string {
  if (field in text.fields) return text.fields[field as PersonalField];
  if (field === "payer_kind" || field === "payer_own_account" || field === "payer_beneficial_owner") {
    return payerFieldLabel(text, field, guardian);
  }
  if (field.startsWith("payer_")) return `${text.payerPerson}: ${payerFieldLabel(text, field as PayerField)}`;
  if (field === "payment_background") return `${text.payerPerson}: ${text.identificationFields.payment_background}`;
  if (field === "id_document_upload") return `${text.sectionIdentity}: ${text.identityFiles}`;
  const topic = LEGAL_TOPIC_OF[field];
  if (topic) {
    // A missing answer names the question; missing details name what a "yes" asks for.
    const label = field === topic ? text.legalTopics[topic] : `${text.legalTopics[topic]} – ${text.identificationFields[field as IdentificationField]}`;
    return `${text.legalShort}: ${label}`;
  }
  const label = text.identificationFields[field as IdentificationField];
  return field.startsWith("id_") ? `${text.sectionIdentity}: ${label}` : label;
}

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
    has_insurance: "Krankenversicherung vorhanden?",
    insurance_type: "Versicherungsart",
    insurance_provider: "Versicherer",
    insurance_number: "Versicherungsnummer",
    insurance_covers_germany: "Deckt Behandlung in Deutschland",
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
  missingTitle: "Bitte noch ergänzen:",
  inquiryConsentMissing: "Bitte stimmen Sie unter „Daten“ der Verarbeitung Ihrer Angaben zu.",
  sendButton: "An den Manager senden",
  sending: "Wird gesendet…",
  sentTitle: "Vielen Dank!",
  sentBody: (dateTime) => `Ihre Angaben wurden am ${dateTime} gesendet. Wir melden uns bei Ihnen.`,
  nextTitle: "So geht es weiter",
  nextSteps: [
    "Ihre Ansprechperson prüft Ihre Angaben und Unterlagen.",
    "Wir melden uns bei Ihnen und besprechen die nächsten Schritte.",
    "Bis dahin müssen Sie nichts weiter tun. Hat sich etwas geändert oder haben Sie neue Unterlagen, ergänzen Sie Ihre Anfrage und senden Sie sie erneut.",
  ],
  sentSummaryTitle: "Das haben wir erhalten",
  sendAgain: "Erneut senden",
  editData: "Angaben ändern",
  addDocuments: "Unterlagen ergänzen",
  loadFailed: "Die Anfrage konnte nicht geladen werden.",
  retry: "Erneut versuchen",
  noRequest: "Für Ihr Konto ist derzeit keine offene Anfrage vorhanden.",
  requestFor: "Anfrage für",
  language: "Sprache",
  sectionPerson: "Persönliche Daten",
  sectionAddress: "Adresse",
  sectionContact: "Kontakt",
  sectionConsent: "Datenschutz und Einwilligung",
  sectionUpload: "Ihre Unterlagen",
  stepOf: (index, total) => `Schritt ${index} von ${total}`,
  sectionInsurance: "Versicherung",
  notStated: "Keine Angabe",
  insuranceAnswerOptions: { yes: "Ja", no: "Nein" },
  insuranceTypeOptions: { private: "Privat", public: "Gesetzlich", foreign: "Ausländische Versicherung" },
  insuranceCoverageOptions: { yes: "Ja", no: "Nein", not_sure: "Weiß ich nicht" },
  changedAfterSend:
    "Sie haben Ihre Anfrage nach dem Senden geändert. Senden Sie sie erneut, damit Ihre Ansprechperson die Änderungen erhält.",
  sectionPayer: "Wer zahlt",
  payerQuestion: "Wer übernimmt die Kosten der Behandlung?",
  payerOptions: { self: "Ich selbst", third_party: "Eine andere Person" },
  payerOptionsGuardian: { self: "Die Patientin / der Patient selbst", third_party: "Eine andere Person (zum Beispiel ein Elternteil)" },
  payerIntro: "Bitte nennen Sie die Person, die die Kosten übernimmt. Wir sind gesetzlich verpflichtet zu wissen, wer zahlt.",
  payerInformHint:
    "Bitte sagen Sie dieser Person, dass Sie uns ihre Daten für die Kostenübernahme mitgeteilt haben.",
  payerPerson: "Zahlende Person",
  payerRelationship: "Beziehung zur Patientin / zum Patienten",
  payerEmail: "E-Mail",
  ownAccountQuestion: "Handeln Sie im eigenen wirtschaftlichen Interesse?",
  beneficialOwner: "In wessen Interesse handeln Sie? (Name, Geburtsdatum, Geburtsort, Anschrift)",
  ownAccountQuestionGuardian: "Handelt die Patientin / der Patient im eigenen wirtschaftlichen Interesse?",
  beneficialOwnerGuardian:
    "In wessen Interesse handelt die Patientin / der Patient? (Name, Geburtsdatum, Geburtsort, Anschrift)",
  identificationFields: {
    salutation: "Anrede",
    former_names: "Frühere Namen (z. B. Geburtsname)",
    birth_place: "Geburtsort",
    birth_country: "Geburtsland",
    habitual_residence_country: "Land des gewöhnlichen Aufenthalts (falls abweichend)",
    contact_channels: "Wie dürfen wir Sie kontaktieren?",
    id_document_type: "Art des Dokuments",
    id_document_number: "Dokumentnummer",
    id_issuing_authority: "Ausstellende Behörde",
    id_issuing_country: "Ausstellungsland",
    id_issued_on: "Ausgestellt am",
    id_valid_until: "Gültig bis",
    payment_background: "Warum zahlt diese Person?",
    pep_self: "Üben Sie ein hochrangiges öffentliches Amt aus oder haben Sie es in den letzten 12 Monaten ausgeübt?",
    pep_self_details: "Amt, Land und Zeitraum",
    pep_related: "Ist ein unmittelbares Familienmitglied oder eine Ihnen nahestehende Person politisch exponiert?",
    pep_related_details: "Name der Person, Beziehung, Amt und Land",
    high_risk_country:
      "Haben Sie oder eine beteiligte Person Wohnsitz oder Sitz in einem Land, das die EU-Kommission als Drittstaat mit hohem Risiko führt?",
    high_risk_country_code: "Welches Land?",
    sanctions_links: "Bestehen Verbindungen zu Personen oder Unternehmen, die Sanktionen unterliegen?",
    sanctions_links_details: "Zu wem besteht die Verbindung und welcher Art ist sie?",
  },
  identificationFieldsGuardian: {
    pep_self:
      "Übt die Patientin / der Patient ein hochrangiges öffentliches Amt aus oder hat sie / er es in den letzten 12 Monaten ausgeübt?",
    pep_related:
      "Ist ein unmittelbares Familienmitglied der Patientin / des Patienten oder eine ihr / ihm nahestehende Person politisch exponiert?",
    high_risk_country:
      "Hat die Patientin / der Patient oder eine beteiligte Person Wohnsitz oder Sitz in einem Land, das die EU-Kommission als Drittstaat mit hohem Risiko führt?",
  },
  legalTopics: {
    pep_self: "Öffentliches Amt",
    pep_related: "Politisch exponierte nahestehende Person",
    high_risk_country: "Land mit hohem Risiko",
    sanctions_links: "Sanktionen",
  },
  yesNo: { yes: "Ja", no: "Nein" },
  salutationOptions: { mr: "Herr", ms: "Frau", none: "Keine Angabe" },
  contactChannelOptions: { email: "E-Mail", phone: "Telefon", messenger: "Messenger" },
  idDocumentTypeOptions: { passport: "Reisepass", id_card: "Personalausweis", residence_permit: "Aufenthaltstitel" },
  sectionIdentity: "Ausweisdokument",
  identityUploadButton: "Foto oder Scan des Ausweises hochladen",
  identityUploadHint: "PDF, JPG oder PNG, bis 25 MB pro Datei.",
  identityUploadNeedsConsent: "Zum Hochladen bitte zuerst oben der Verarbeitung Ihrer Angaben zustimmen.",
  identityNote:
    "Eine Kopie allein reicht möglicherweise nicht aus, wenn die Person nicht persönlich anwesend ist. Wir melden uns bei Ihnen wegen der Identifizierung.",
  noIdentityDocuments: "Noch kein Ausweis hochgeladen.",
  identityFiles: "Foto oder Scan des Ausweises",
  idDocumentExpired: "Das Dokument ist abgelaufen. Bitte geben Sie ein gültiges Dokument an.",
  sectionLegal: "Gesetzliche Fragen (Geldwäscheprävention)",
  legalIntro: "Diese Fragen schreibt das Geldwäschegesetz vor. Bitte beantworten Sie jede mit Ja oder Nein.",
  legalShort: "Gesetzliche Fragen",
  summaryIntro: "Bitte prüfen Sie Ihre Angaben, bevor Sie sie senden.",
  summaryEmpty: "Noch keine Angaben",
  declarationTitle: "Bestätigung",
  declarationLabel:
    "Ich bestätige, dass meine Angaben vollständig und wahrheitsgemäß sind und dass ich Änderungen mitteile.",
  declarationRequired: "Bitte bestätigen Sie Ihre Angaben, bevor Sie die Anfrage senden.",
  declarationGivenAt: (dateTime) => `Bestätigt am ${dateTime}`,
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
    has_insurance: "Есть страхование?",
    insurance_type: "Тип страхования",
    insurance_provider: "Страховая компания",
    insurance_number: "Номер полиса",
    insurance_covers_germany: "Покрывает лечение в Германии",
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
  missingTitle: "Пожалуйста, дополните:",
  inquiryConsentMissing: "Пожалуйста, дайте согласие на обработку данных в разделе «Данные».",
  sendButton: "Отправить менеджеру",
  sending: "Отправляется…",
  sentTitle: "Спасибо!",
  sentBody: (dateTime) => `Ваши данные отправлены ${dateTime}. Мы свяжемся с вами.`,
  nextTitle: "Что дальше",
  nextSteps: [
    "Ваш менеджер проверит данные и документы.",
    "Мы свяжемся с вами и обсудим следующие шаги.",
    "До этого от вас ничего не требуется. Если что-то изменилось или появились новые документы, дополните заявку и отправьте её ещё раз.",
  ],
  sentSummaryTitle: "Что мы получили",
  sendAgain: "Отправить ещё раз",
  editData: "Изменить данные",
  addDocuments: "Добавить документы",
  loadFailed: "Не удалось загрузить заявку.",
  retry: "Повторить",
  noRequest: "Для вашего аккаунта сейчас нет открытой заявки.",
  requestFor: "Заявка для",
  language: "Язык",
  sectionPerson: "Личные данные",
  sectionAddress: "Адрес",
  sectionContact: "Контакт",
  sectionConsent: "Защита данных и согласие",
  sectionUpload: "Ваши документы",
  stepOf: (index, total) => `Шаг ${index} из ${total}`,
  sectionInsurance: "Страхование",
  notStated: "Не указано",
  insuranceAnswerOptions: { yes: "Да", no: "Нет" },
  insuranceTypeOptions: { private: "Частное", public: "Государственное", foreign: "Иностранное" },
  insuranceCoverageOptions: { yes: "Да", no: "Нет", not_sure: "Не знаю" },
  changedAfterSend:
    "После отправки вы изменили заявку. Отправьте её ещё раз, чтобы менеджер получил изменения.",
  sectionPayer: "Кто оплачивает",
  payerQuestion: "Кто оплачивает лечение?",
  payerOptions: { self: "Я сам(а)", third_party: "Другой человек" },
  payerOptionsGuardian: { self: "Сам пациент", third_party: "Другой человек (например, один из родителей)" },
  payerIntro: "Укажите, пожалуйста, человека, который оплачивает лечение. По закону мы обязаны знать, кто платит.",
  payerInformHint: "Пожалуйста, сообщите этому человеку, что вы передали нам его данные для оформления оплаты.",
  payerPerson: "Плательщик",
  payerRelationship: "Кем приходится пациенту",
  payerEmail: "E-mail",
  ownAccountQuestion: "Вы действуете в собственных экономических интересах?",
  beneficialOwner: "В чьих интересах вы действуете? (имя, дата рождения, место рождения, адрес)",
  ownAccountQuestionGuardian: "Пациент действует в собственных экономических интересах?",
  beneficialOwnerGuardian: "В чьих интересах действует пациент? (имя, дата рождения, место рождения, адрес)",
  identificationFields: {
    salutation: "Обращение",
    former_names: "Прежние имена и фамилии (например, фамилия при рождении)",
    birth_place: "Место рождения",
    birth_country: "Страна рождения",
    habitual_residence_country: "Страна постоянного пребывания (если другая)",
    contact_channels: "Как мы можем с вами связаться?",
    id_document_type: "Вид документа",
    id_document_number: "Номер документа",
    id_issuing_authority: "Кем выдан",
    id_issuing_country: "Страна выдачи",
    id_issued_on: "Дата выдачи",
    id_valid_until: "Действителен до",
    payment_background: "Почему платит этот человек?",
    pep_self: "Занимаете ли вы высокую государственную должность или занимали её в последние 12 месяцев?",
    pep_self_details: "Должность, страна и период",
    pep_related:
      "Является ли кто-то из ближайших членов вашей семьи или близкий вам человек политически значимым лицом?",
    pep_related_details: "Имя человека, кем приходится, должность и страна",
    high_risk_country:
      "Проживаете ли вы или участвующее лицо в стране (или зарегистрированы в ней), которую Европейская комиссия относит к третьим странам высокого риска?",
    high_risk_country_code: "Какая страна?",
    sanctions_links: "Есть ли связи с лицами или компаниями, на которые наложены санкции?",
    sanctions_links_details: "С кем есть связь и какая именно?",
  },
  identificationFieldsGuardian: {
    pep_self: "Занимает ли пациент высокую государственную должность или занимал её в последние 12 месяцев?",
    pep_related:
      "Является ли кто-то из ближайших членов семьи пациента или близкий ему человек политически значимым лицом?",
    high_risk_country:
      "Проживает ли пациент или участвующее лицо в стране (или зарегистрированы в ней), которую Европейская комиссия относит к третьим странам высокого риска?",
  },
  legalTopics: {
    pep_self: "Государственная должность",
    pep_related: "Политически значимое близкое лицо",
    high_risk_country: "Страна высокого риска",
    sanctions_links: "Санкции",
  },
  yesNo: { yes: "Да", no: "Нет" },
  salutationOptions: { mr: "Господин", ms: "Госпожа", none: "Без указания" },
  contactChannelOptions: { email: "E-mail", phone: "Телефон", messenger: "Мессенджер" },
  idDocumentTypeOptions: {
    passport: "Паспорт (заграничный)",
    id_card: "Удостоверение личности (ID-карта)",
    residence_permit: "Вид на жительство",
  },
  sectionIdentity: "Документ, удостоверяющий личность",
  identityUploadButton: "Загрузить фото или скан документа",
  identityUploadHint: "PDF, JPG или PNG, до 25 МБ на файл.",
  identityUploadNeedsConsent: "Чтобы загрузить, сначала дайте вверху согласие на обработку данных.",
  identityNote:
    "Одной копии может быть недостаточно, если человек не присутствует лично. Мы свяжемся с вами по поводу идентификации.",
  noIdentityDocuments: "Документ ещё не загружен.",
  identityFiles: "Фото или скан документа",
  idDocumentExpired: "Срок действия документа истёк. Пожалуйста, укажите действующий документ.",
  sectionLegal: "Вопросы по закону (противодействие отмыванию денег)",
  legalIntro:
    "Эти вопросы требует немецкий закон о противодействии отмыванию денег. Пожалуйста, ответьте на каждый «да» или «нет».",
  legalShort: "Вопросы по закону",
  summaryIntro: "Пожалуйста, проверьте данные перед отправкой.",
  summaryEmpty: "Пока ничего не указано",
  declarationTitle: "Подтверждение",
  declarationLabel: "Я подтверждаю, что мои данные полные и достоверные и что я сообщу об изменениях.",
  declarationRequired: "Пожалуйста, подтвердите свои данные перед отправкой заявки.",
  declarationGivenAt: (dateTime) => `Подтверждено ${dateTime}`,
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
    has_insurance: "Є страхування?",
    insurance_type: "Тип страхування",
    insurance_provider: "Страхова компанія",
    insurance_number: "Номер поліса",
    insurance_covers_germany: "Покриває лікування в Німеччині",
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
  missingTitle: "Будь ласка, доповніть:",
  inquiryConsentMissing: "Будь ласка, надайте згоду на обробку даних у розділі «Дані».",
  sendButton: "Надіслати менеджеру",
  sending: "Надсилається…",
  sentTitle: "Дякуємо!",
  sentBody: (dateTime) => `Ваші дані надіслано ${dateTime}. Ми зв'яжемося з вами.`,
  nextTitle: "Що далі",
  nextSteps: [
    "Ваш менеджер перевірить дані та документи.",
    "Ми зв'яжемося з вами й обговоримо наступні кроки.",
    "До того від вас нічого не потрібно. Якщо щось змінилося або з'явилися нові документи, доповніть заявку й надішліть її ще раз.",
  ],
  sentSummaryTitle: "Що ми отримали",
  sendAgain: "Надіслати ще раз",
  editData: "Змінити дані",
  addDocuments: "Додати документи",
  loadFailed: "Не вдалося завантажити заявку.",
  retry: "Спробувати ще раз",
  noRequest: "Для вашого акаунта зараз немає відкритої заявки.",
  requestFor: "Заявка для",
  language: "Мова",
  sectionPerson: "Особисті дані",
  sectionAddress: "Адреса",
  sectionContact: "Контакт",
  sectionConsent: "Захист даних і згода",
  sectionUpload: "Ваші документи",
  stepOf: (index, total) => `Крок ${index} з ${total}`,
  sectionInsurance: "Страхування",
  notStated: "Не вказано",
  insuranceAnswerOptions: { yes: "Так", no: "Ні" },
  insuranceTypeOptions: { private: "Приватне", public: "Державне", foreign: "Іноземне" },
  insuranceCoverageOptions: { yes: "Так", no: "Ні", not_sure: "Не знаю" },
  changedAfterSend:
    "Після надсилання ви змінили заявку. Надішліть її ще раз, щоб менеджер отримав зміни.",
  sectionPayer: "Хто оплачує",
  payerQuestion: "Хто оплачує лікування?",
  payerOptions: { self: "Я сам(а)", third_party: "Інша людина" },
  payerOptionsGuardian: { self: "Сам пацієнт", third_party: "Інша людина (наприклад, хтось із батьків)" },
  payerIntro: "Вкажіть, будь ласка, людину, яка оплачує лікування. За законом ми зобов'язані знати, хто платить.",
  payerInformHint: "Будь ласка, повідомте цій людині, що ви передали нам її дані для оформлення оплати.",
  payerPerson: "Платник",
  payerRelationship: "Ким доводиться пацієнту",
  payerEmail: "E-mail",
  ownAccountQuestion: "Ви дієте у власних економічних інтересах?",
  beneficialOwner: "В чиїх інтересах ви дієте? (ім'я, дата народження, місце народження, адреса)",
  ownAccountQuestionGuardian: "Пацієнт діє у власних економічних інтересах?",
  beneficialOwnerGuardian: "В чиїх інтересах діє пацієнт? (ім'я, дата народження, місце народження, адреса)",
  identificationFields: {
    salutation: "Звертання",
    former_names: "Попередні імена та прізвища (наприклад, прізвище при народженні)",
    birth_place: "Місце народження",
    birth_country: "Країна народження",
    habitual_residence_country: "Країна постійного перебування (якщо інша)",
    contact_channels: "Як ми можемо з вами зв'язатися?",
    id_document_type: "Вид документа",
    id_document_number: "Номер документа",
    id_issuing_authority: "Ким виданий",
    id_issuing_country: "Країна видачі",
    id_issued_on: "Дата видачі",
    id_valid_until: "Дійсний до",
    payment_background: "Чому платить ця людина?",
    pep_self: "Чи обіймаєте ви високу державну посаду або обіймали її протягом останніх 12 місяців?",
    pep_self_details: "Посада, країна і період",
    pep_related:
      "Чи є хтось із найближчих членів вашої родини або близька вам людина політично значущою особою?",
    pep_related_details: "Ім'я людини, ким доводиться, посада і країна",
    high_risk_country:
      "Чи проживаєте ви або залучена особа в країні (або зареєстровані в ній), яку Європейська комісія відносить до третіх країн високого ризику?",
    high_risk_country_code: "Яка країна?",
    sanctions_links: "Чи є зв'язки з особами або компаніями, на які накладено санкції?",
    sanctions_links_details: "З ким є зв'язок і який саме?",
  },
  identificationFieldsGuardian: {
    pep_self: "Чи обіймає пацієнт високу державну посаду або обіймав її протягом останніх 12 місяців?",
    pep_related:
      "Чи є хтось із найближчих членів родини пацієнта або близька йому людина політично значущою особою?",
    high_risk_country:
      "Чи проживає пацієнт або залучена особа в країні (або зареєстровані в ній), яку Європейська комісія відносить до третіх країн високого ризику?",
  },
  legalTopics: {
    pep_self: "Державна посада",
    pep_related: "Політично значуща близька особа",
    high_risk_country: "Країна високого ризику",
    sanctions_links: "Санкції",
  },
  yesNo: { yes: "Так", no: "Ні" },
  salutationOptions: { mr: "Пан", ms: "Пані", none: "Без зазначення" },
  contactChannelOptions: { email: "E-mail", phone: "Телефон", messenger: "Месенджер" },
  idDocumentTypeOptions: {
    passport: "Паспорт (закордонний)",
    id_card: "Посвідчення особи (ID-картка)",
    residence_permit: "Посвідка на проживання",
  },
  sectionIdentity: "Документ, що посвідчує особу",
  identityUploadButton: "Завантажити фото або скан документа",
  identityUploadHint: "PDF, JPG або PNG, до 25 МБ на файл.",
  identityUploadNeedsConsent: "Щоб завантажити, спершу надайте вгорі згоду на обробку даних.",
  identityNote:
    "Самої копії може бути недостатньо, якщо людина не присутня особисто. Ми зв'яжемося з вами щодо ідентифікації.",
  noIdentityDocuments: "Документ ще не завантажено.",
  identityFiles: "Фото або скан документа",
  idDocumentExpired: "Термін дії документа минув. Будь ласка, вкажіть дійсний документ.",
  sectionLegal: "Запитання за законом (запобігання відмиванню коштів)",
  legalIntro:
    "Ці запитання вимагає німецький закон про запобігання відмиванню коштів. Будь ласка, дайте на кожне відповідь «так» або «ні».",
  legalShort: "Запитання за законом",
  summaryIntro: "Будь ласка, перевірте дані перед надсиланням.",
  summaryEmpty: "Ще нічого не вказано",
  declarationTitle: "Підтвердження",
  declarationLabel: "Я підтверджую, що мої дані повні й правдиві та що я повідомлю про зміни.",
  declarationRequired: "Будь ласка, підтвердьте свої дані перед надсиланням заявки.",
  declarationGivenAt: (dateTime) => `Підтверджено ${dateTime}`,
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
    has_insurance: "Do you have health insurance?",
    insurance_type: "Type of insurance",
    insurance_provider: "Insurer",
    insurance_number: "Policy number",
    insurance_covers_germany: "Covers treatment in Germany",
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
  missingTitle: "Please add:",
  inquiryConsentMissing: "Please agree to the processing of your details under \"Details\".",
  sendButton: "Send to the manager",
  sending: "Sending…",
  sentTitle: "Thank you!",
  sentBody: (dateTime) => `Your details were sent on ${dateTime}. We will get in touch.`,
  nextTitle: "What happens next",
  nextSteps: [
    "Your contact person reviews your details and documents.",
    "We will get in touch and discuss the next steps.",
    "Until then there is nothing more to do. If something has changed or you have new documents, add them to your request and send it again.",
  ],
  sentSummaryTitle: "What we received",
  sendAgain: "Send again",
  editData: "Edit details",
  addDocuments: "Add documents",
  loadFailed: "The request could not be loaded.",
  retry: "Try again",
  noRequest: "There is no open request for your account at the moment.",
  requestFor: "Request for",
  language: "Language",
  sectionPerson: "Personal details",
  sectionAddress: "Address",
  sectionContact: "Contact",
  sectionConsent: "Privacy and consent",
  sectionUpload: "Your documents",
  stepOf: (index, total) => `Step ${index} of ${total}`,
  sectionInsurance: "Insurance",
  notStated: "Not specified",
  insuranceAnswerOptions: { yes: "Yes", no: "No" },
  insuranceTypeOptions: { private: "Private", public: "Statutory (public)", foreign: "Foreign" },
  insuranceCoverageOptions: { yes: "Yes", no: "No", not_sure: "Not sure" },
  changedAfterSend:
    "You changed your request after sending it. Send it again so that your contact person receives the changes.",
  sectionPayer: "Who pays",
  payerQuestion: "Who pays for the treatment?",
  payerOptions: { self: "I do", third_party: "Another person" },
  payerOptionsGuardian: { self: "The patient", third_party: "Another person (for example a parent)" },
  payerIntro: "Please name the person who pays for the treatment. We are required by law to know who pays.",
  payerInformHint: "Please let this person know that you gave us their details for the payment arrangements.",
  payerPerson: "Payer",
  payerRelationship: "Relationship to the patient",
  payerEmail: "E-mail",
  ownAccountQuestion: "Are you acting in your own economic interest?",
  beneficialOwner: "In whose interest are you acting? (name, date of birth, place of birth, address)",
  ownAccountQuestionGuardian: "Is the patient acting in their own economic interest?",
  beneficialOwnerGuardian: "In whose interest is the patient acting? (name, date of birth, place of birth, address)",
  identificationFields: {
    salutation: "Title",
    former_names: "Former names (e.g. name at birth)",
    birth_place: "Place of birth",
    birth_country: "Country of birth",
    habitual_residence_country: "Country of habitual residence (if different)",
    contact_channels: "How may we contact you?",
    id_document_type: "Type of document",
    id_document_number: "Document number",
    id_issuing_authority: "Issuing authority",
    id_issuing_country: "Country of issue",
    id_issued_on: "Date of issue",
    id_valid_until: "Valid until",
    payment_background: "Why is this person paying?",
    pep_self: "Do you hold a prominent public office, or have you held one in the last 12 months?",
    pep_self_details: "Office, country and period",
    pep_related: "Is an immediate family member or a person close to you politically exposed?",
    pep_related_details: "Name of the person, relationship, office and country",
    high_risk_country:
      "Do you or a person involved live or have a registered office in a country that the EU Commission lists as a high-risk third country?",
    high_risk_country_code: "Which country?",
    sanctions_links: "Are there any links to persons or companies that are subject to sanctions?",
    sanctions_links_details: "Who is the link to, and what kind of link is it?",
  },
  identificationFieldsGuardian: {
    pep_self: "Does the patient hold a prominent public office, or have they held one in the last 12 months?",
    pep_related: "Is an immediate family member of the patient or a person close to the patient politically exposed?",
    high_risk_country:
      "Does the patient or a person involved live or have a registered office in a country that the EU Commission lists as a high-risk third country?",
  },
  legalTopics: {
    pep_self: "Public office",
    pep_related: "Politically exposed close person",
    high_risk_country: "High-risk country",
    sanctions_links: "Sanctions",
  },
  yesNo: { yes: "Yes", no: "No" },
  salutationOptions: { mr: "Mr", ms: "Ms", none: "Not specified" },
  contactChannelOptions: { email: "E-mail", phone: "Phone", messenger: "Messenger" },
  idDocumentTypeOptions: { passport: "Passport", id_card: "Identity card", residence_permit: "Residence permit" },
  sectionIdentity: "Identity document",
  identityUploadButton: "Upload a photo or scan of the document",
  identityUploadHint: "PDF, JPG or PNG, up to 25 MB per file.",
  identityUploadNeedsConsent: "To upload, first agree to the processing of your details at the top.",
  identityNote:
    "A copy alone may not be enough if the person is not present in person. We will get in touch about the identification.",
  noIdentityDocuments: "No identity document uploaded yet.",
  identityFiles: "Photo or scan of the document",
  idDocumentExpired: "The document has expired. Please enter a valid document.",
  sectionLegal: "Legal questions (anti-money laundering)",
  legalIntro: "German anti-money laundering law requires these questions. Please answer each with yes or no.",
  legalShort: "Legal questions",
  summaryIntro: "Please check your details before you send them.",
  summaryEmpty: "Nothing entered yet",
  declarationTitle: "Confirmation",
  declarationLabel: "I confirm that my details are complete and true and that I will report any changes.",
  declarationRequired: "Please confirm your details before you send the request.",
  declarationGivenAt: (dateTime) => `Confirmed on ${dateTime}`,
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
