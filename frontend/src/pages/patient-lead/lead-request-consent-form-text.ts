import type { ConsentFormChoices, ConsentRecipientRelation } from "./lead-request-api";
import { asLeadCabinetLang } from "./lead-request-text";

/**
 * Texts of the cabinet block where the person chooses the options of the consent form
 * «Einverständniserklärung zur Datenübermittlung» (Anlage 1), 2026-10-12, in the cabinet's four
 * languages. The options follow the printed form; GMED never ticks anything for the person.
 *
 * A parent or guardian of a minor chooses for the child: the child is the data subject, the parent
 * declares and signs (QA 2026-10-12, A2-06), so the texts speak of the child's data.
 */
export type ConsentFormText = {
  title: string;
  intro: string;
  options: Record<keyof ConsentFormChoices, string>;
  channelsTitle: string;
  channelsRisk: string;
  /** Marks the three consents the service runs on. */
  required: string;
  /** Why the three are needed; shown while one of them is not ticked. */
  coreHint: string;
  /** The server refused a choice without the three (`consent_core_required`). */
  coreRequired: string;
  save: string;
  saving: string;
  savedAt: (date: string) => string;
  /** The choice the other parent or guardian saved (QA 2026-10-12, A3-01). */
  savedByOtherAt: (date: string) => string;
  notSaved: string;
  unsaved: string;
  /** The own login of a minor: only a parent or the guardian chooses (QA 2026-10-12, A3-01). */
  byGuardianOnly: string;
  /** The named recipients (owner 2026-10-12), shown while "named recipients" is ticked. */
  recipientsTitle: string;
  recipientsHint: string;
  recipientName: string;
  recipientRelation: string;
  recipientContact: string;
  recipientRelations: Record<ConsentRecipientRelation, string>;
  addRecipient: string;
  removeRecipient: string;
  /** "Named recipients" ticked, nobody named (`consent_recipients_required`). */
  recipientsRequired: string;
  /** A recipient incomplete or too long, or more than five (`consent_recipients_invalid`). */
  recipientsInvalid: string;
};

type ChildTexts = Pick<ConsentFormText, "intro" | "options" | "channelsTitle" | "coreHint" | "recipientsHint">;

const de: ConsentFormText = {
  title: "Einwilligung zur Datenübermittlung (Anlage 1)",
  intro:
    "Wählen Sie selbst, wozu Sie einwilligen. Im Formular, das Sie später elektronisch unterschreiben, ist nur angekreuzt, was Sie hier wählen – GMED kreuzt nichts für Sie an. Ohne Ihre Auswahl unterschreiben Sie das Formular auf Papier und kreuzen dort selbst an.",
  options: {
    agency_processing:
      "GMED und beauftragte Mitarbeitende dürfen meine personenbezogenen und medizinischen Daten und Unterlagen einholen, bearbeiten, speichern und bei Bedarf an behandelnde Ärzte, Kliniken, Labore, Dolmetscher, Übersetzer, Gutachter oder Kostenträger übermitteln.",
    doctors_to_agency:
      "Meine behandelnden Ärzte und medizinischen Einrichtungen dürfen meine Behandlungsunterlagen an GMED übermitteln.",
    data_system: "Meine Unterlagen dürfen im EDV-System von GMED gespeichert und verarbeitet werden.",
    named_recipients:
      "Meine Daten dürfen an die Personen übermittelt werden, die ich unter „Auskunft an Dritte“ nenne.",
    channel_email: "E-Mail",
    channel_threema: "Threema",
    channel_whatsapp: "WhatsApp",
    channel_telegram: "Telegram",
  },
  channelsTitle: "Meine Daten und Unterlagen dürfen über diese Kommunikationswege eingeholt oder übermittelt werden:",
  channelsRisk: "Die Übermittlung sensibler Daten per E-Mail oder Messenger ist mit Risiken verbunden.",
  required: "erforderlich",
  coreHint:
    "Ohne die drei erforderlichen Einwilligungen kann GMED Ihre Anfrage nicht bearbeiten; deshalb lässt sich die Auswahl erst mit ihnen speichern. Möchten Sie sie nicht geben, speichern Sie nichts und sprechen Sie mit uns.",
  coreRequired: "Bitte kreuzen Sie die drei erforderlichen Einwilligungen an.",
  save: "Auswahl speichern",
  saving: "Wird gespeichert …",
  savedAt: (date) =>
    `Ihre Auswahl vom ${date} ist gespeichert. Sie können sie jederzeit ändern; ein schon erstelltes Formular erstellt GMED dann neu.`,
  savedByOtherAt: (date) =>
    `Die Auswahl vom ${date} hat der andere Elternteil bzw. Vertreter gespeichert. Speichern Sie Ihre eigene Auswahl, gilt diese; unterschreiben muss, wer zuletzt gewählt hat.`,
  notSaved: "Noch keine Auswahl gespeichert.",
  unsaved: "Ihre Änderungen sind noch nicht gespeichert.",
  byGuardianOnly:
    "Für Minderjährige wählen die Eltern bzw. der Vormund mit ihrem eigenen Zugang, wozu sie einwilligen. Hier ist nichts auszuwählen.",
  recipientsTitle: "Vertrauenspersonen und Institutionen",
  recipientsHint: "Nennen Sie, an wen GMED Ihre Daten übermitteln darf (höchstens 5). Nur diese Personen stehen im Formular.",
  recipientName: "Name bzw. Name der Institution",
  recipientRelation: "Wer ist das?",
  recipientContact: "Telefon oder E-Mail (optional)",
  recipientRelations: { spouse: "Ehe-/Lebenspartner/in", child: "Kind", relative: "Angehörige/r", friend: "Freund/in / Bekannte/r", family_doctor: "Hausarzt/Hausärztin", clinic: "Klinik/Einrichtung", other: "Sonstige" },
  addRecipient: "Person hinzufügen",
  removeRecipient: "Entfernen",
  recipientsRequired: "Prüfen Sie Ihre Entscheidung und die Personen unter „Auskunft an Dritte“.",
  recipientsInvalid: "Bitte geben Sie bei jeder Person den Namen an und wählen Sie, wer das ist (höchstens 5 Personen).",
};

const deChild: ChildTexts = {
  intro:
    "Wählen Sie selbst, wozu Sie für Ihr Kind einwilligen. Im Formular, das Sie später als Sorgeberechtigte/r elektronisch unterschreiben, ist nur angekreuzt, was Sie hier wählen – GMED kreuzt nichts für Sie an. Ohne Ihre Auswahl unterschreiben Sie das Formular auf Papier und kreuzen dort selbst an.",
  options: {
    agency_processing:
      "GMED und beauftragte Mitarbeitende dürfen die personenbezogenen und medizinischen Daten und Unterlagen meines Kindes einholen, bearbeiten, speichern und bei Bedarf an behandelnde Ärzte, Kliniken, Labore, Dolmetscher, Übersetzer, Gutachter oder Kostenträger übermitteln.",
    doctors_to_agency:
      "Die behandelnden Ärzte und medizinischen Einrichtungen meines Kindes dürfen seine Behandlungsunterlagen an GMED übermitteln.",
    data_system: "Die Unterlagen meines Kindes dürfen im EDV-System von GMED gespeichert und verarbeitet werden.",
    named_recipients:
      "Die Daten meines Kindes dürfen an die Personen übermittelt werden, die ich unter „Auskunft an Dritte“ nenne.",
    channel_email: "E-Mail",
    channel_threema: "Threema",
    channel_whatsapp: "WhatsApp",
    channel_telegram: "Telegram",
  },
  channelsTitle: "Die Daten und Unterlagen meines Kindes dürfen über diese Kommunikationswege eingeholt oder übermittelt werden:",
  coreHint:
    "Ohne die drei erforderlichen Einwilligungen kann GMED die Anfrage für Ihr Kind nicht bearbeiten; deshalb lässt sich die Auswahl erst mit ihnen speichern. Möchten Sie sie nicht geben, speichern Sie nichts und sprechen Sie mit uns.",
  recipientsHint: "Nennen Sie, an wen GMED die Daten Ihres Kindes übermitteln darf (höchstens 5). Sich selbst als Eltern bzw. Vormund müssen Sie hier nicht nennen.",
};

const en: ConsentFormText = {
  title: "Consent to data transfer (Annex 1)",
  intro:
    "Choose yourself what you consent to. The form you later sign electronically shows ticked only what you choose here – GMED ticks nothing for you. Without your choice you sign the form on paper and tick the boxes there yourself.",
  options: {
    agency_processing:
      "GMED and the staff it instructs may obtain, process and store my personal and medical data and documents and, where needed, pass them on to treating doctors, clinics, laboratories, interpreters, translators, assessors or payers.",
    doctors_to_agency: "My treating doctors and medical institutions may send my treatment records to GMED.",
    data_system: "My documents may be stored and processed in GMED's IT system.",
    named_recipients:
      "My data may be passed on to the people I list under “Information for third parties”.",
    channel_email: "E-mail",
    channel_threema: "Threema",
    channel_whatsapp: "WhatsApp",
    channel_telegram: "Telegram",
  },
  channelsTitle: "My data and documents may be obtained or passed on through these channels:",
  channelsRisk: "Sending sensitive data by e-mail or messenger carries risks.",
  required: "required",
  coreHint:
    "Without the three required consents GMED cannot handle your request, so your choice can be saved only with them. If you do not want to give them, save nothing and talk to us.",
  coreRequired: "Please tick the three required consents.",
  save: "Save my choice",
  saving: "Saving …",
  savedAt: (date) =>
    `Your choice of ${date} is saved. You can change it at any time; GMED staff then prepare a form already made anew.`,
  savedByOtherAt: (date) =>
    `The choice of ${date} was saved by the other parent or representative. If you save your own choice, yours counts; whoever chose last signs.`,
  notSaved: "No choice saved yet.",
  unsaved: "Your changes are not saved yet.",
  byGuardianOnly:
    "For a minor, the parents or the guardian choose what they consent to with their own access. There is nothing to choose here.",
  recipientsTitle: "Trusted persons and institutions",
  recipientsHint: "Name who GMED may pass your data on to (at most 5). Only these persons appear on the form.",
  recipientName: "Name or name of the institution",
  recipientRelation: "Who is this?",
  recipientContact: "Phone or e-mail (optional)",
  recipientRelations: { spouse: "Spouse / partner", child: "Child", relative: "Relative", friend: "Friend / acquaintance", family_doctor: "Family doctor", clinic: "Clinic / institution", other: "Other" },
  addRecipient: "Add a person",
  removeRecipient: "Remove",
  recipientsRequired: "Review your decision and the people on the “Information for third parties” page.",
  recipientsInvalid: "Please give each person a name and choose who they are (at most 5 persons).",
};

const enChild: ChildTexts = {
  intro:
    "Choose yourself what you consent to for your child. The form you later sign electronically as the parent or guardian shows ticked only what you choose here – GMED ticks nothing for you. Without your choice you sign the form on paper and tick the boxes there yourself.",
  options: {
    agency_processing:
      "GMED and the staff it instructs may obtain, process and store my child's personal and medical data and documents and, where needed, pass them on to treating doctors, clinics, laboratories, interpreters, translators, assessors or payers.",
    doctors_to_agency: "My child's treating doctors and medical institutions may send my child's treatment records to GMED.",
    data_system: "My child's documents may be stored and processed in GMED's IT system.",
    named_recipients: "My child's data may be passed on to the people I list under “Information for third parties”.",
    channel_email: "E-mail",
    channel_threema: "Threema",
    channel_whatsapp: "WhatsApp",
    channel_telegram: "Telegram",
  },
  channelsTitle: "My child's data and documents may be obtained or passed on through these channels:",
  coreHint:
    "Without the three required consents GMED cannot handle the request for your child, so your choice can be saved only with them. If you do not want to give them, save nothing and talk to us.",
  recipientsHint: "Name who GMED may pass your child's data on to (at most 5). You need not name yourself as parent or guardian.",
};

const uk: ConsentFormText = {
  title: "Згода на передачу даних (додаток 1)",
  intro:
    "Оберіть самі, на що ви погоджуєтеся. У формі, яку ви згодом підпишете електронно, позначено лише те, що ви оберете тут, — GMED нічого не позначає за вас. Без вашого вибору ви підписуєте форму на папері й позначаєте там самі.",
  options: {
    agency_processing:
      "GMED і уповноважені працівники можуть отримувати, обробляти, зберігати мої персональні й медичні дані та документи і за потреби передавати їх лікарям, клінікам, лабораторіям, перекладачам, експертам або платникам.",
    doctors_to_agency: "Мої лікарі та медичні заклади можуть передавати GMED мої медичні документи.",
    data_system: "Мої документи можуть зберігатися й оброблятися в ІТ-системі GMED.",
    named_recipients:
      "Мої дані можуть передаватися особам, яких я вказую в розділі «Надання інформації третім особам».",
    channel_email: "Електронна пошта",
    channel_threema: "Threema",
    channel_whatsapp: "WhatsApp",
    channel_telegram: "Telegram",
  },
  channelsTitle: "Мої дані та документи можна отримувати або передавати цими каналами:",
  channelsRisk: "Передача чутливих даних електронною поштою чи месенджером пов'язана з ризиками.",
  required: "обов'язково",
  coreHint:
    "Без трьох обов'язкових згод GMED не може опрацювати ваш запит, тому вибір можна зберегти лише з ними. Якщо ви не хочете їх давати, нічого не зберігайте й зв'яжіться з нами.",
  coreRequired: "Позначте, будь ласка, три обов'язкові згоди.",
  save: "Зберегти вибір",
  saving: "Зберігаємо …",
  savedAt: (date) =>
    `Ваш вибір від ${date} збережено. Ви можете змінити його будь-коли; уже створену форму працівник GMED тоді створить заново.`,
  savedByOtherAt: (date) =>
    `Вибір від ${date} зберіг інший з батьків або представник. Якщо ви збережете власний вибір, діятиме ваш; підписує той, хто обрав останнім.`,
  notSaved: "Вибір ще не збережено.",
  unsaved: "Зміни ще не збережено.",
  byGuardianOnly:
    "За неповнолітнього батьки або опікун обирають, на що погоджуються, через свій власний доступ. Тут нічого обирати не потрібно.",
  recipientsTitle: "Довірені особи та установи",
  recipientsHint: "Вкажіть, кому GMED може передавати ваші дані (не більше 5). У формі будуть лише ці особи.",
  recipientName: "Ім’я та прізвище або назва установи",
  recipientRelation: "Хто це?",
  recipientContact: "Телефон або e-mail (необов’язково)",
  recipientRelations: { spouse: "Чоловік / дружина, партнер", child: "Дитина", relative: "Родич", friend: "Друг / знайомий", family_doctor: "Сімейний лікар", clinic: "Клініка / установа", other: "Інше" },
  addRecipient: "Додати особу",
  removeRecipient: "Видалити",
  recipientsRequired: "Перевірте рішення та перелік осіб у розділі «Надання інформації третім особам».",
  recipientsInvalid: "Для кожної особи вкажіть ім’я та оберіть, хто це (не більше 5 осіб).",
};

const ukChild: ChildTexts = {
  intro:
    "Оберіть самі, на що ви погоджуєтеся за свою дитину. У формі, яку ви згодом підпишете електронно як батько, мати чи опікун, позначено лише те, що ви оберете тут, — GMED нічого не позначає за вас. Без вашого вибору ви підписуєте форму на папері й позначаєте там самі.",
  options: {
    agency_processing:
      "GMED і уповноважені працівники можуть отримувати, обробляти, зберігати персональні й медичні дані та документи моєї дитини і за потреби передавати їх лікарям, клінікам, лабораторіям, перекладачам, експертам або платникам.",
    doctors_to_agency: "Лікарі та медичні заклади моєї дитини можуть передавати GMED її медичні документи.",
    data_system: "Документи моєї дитини можуть зберігатися й оброблятися в ІТ-системі GMED.",
    named_recipients: "Дані моєї дитини можуть передаватися особам, яких я вказую в розділі «Надання інформації третім особам».",
    channel_email: "Електронна пошта",
    channel_threema: "Threema",
    channel_whatsapp: "WhatsApp",
    channel_telegram: "Telegram",
  },
  channelsTitle: "Дані та документи моєї дитини можна отримувати або передавати цими каналами:",
  coreHint:
    "Без трьох обов'язкових згод GMED не може опрацювати запит для вашої дитини, тому вибір можна зберегти лише з ними. Якщо ви не хочете їх давати, нічого не зберігайте й зв'яжіться з нами.",
  recipientsHint: "Вкажіть, кому GMED може передавати дані вашої дитини (не більше 5). Себе як батька, матір чи опікуна вказувати не потрібно.",
};

const ru: ConsentFormText = {
  title: "Согласие на передачу данных (приложение 1)",
  intro:
    "Выберите сами, на что вы соглашаетесь. В форме, которую вы позже подпишете электронно, отмечено только то, что вы выберете здесь, — GMED ничего не отмечает за вас. Без вашего выбора вы подписываете форму на бумаге и отмечаете там сами.",
  options: {
    agency_processing:
      "GMED и уполномоченные сотрудники могут получать, обрабатывать, хранить мои персональные и медицинские данные и документы и при необходимости передавать их лечащим врачам, клиникам, лабораториям, переводчикам, экспертам или плательщикам.",
    doctors_to_agency: "Мои лечащие врачи и медицинские учреждения могут передавать GMED мои медицинские документы.",
    data_system: "Мои документы могут храниться и обрабатываться в ИТ-системе GMED.",
    named_recipients:
      "Мои данные могут передаваться лицам, которых я указываю в разделе «Предоставление информации третьим лицам».",
    channel_email: "Электронная почта",
    channel_threema: "Threema",
    channel_whatsapp: "WhatsApp",
    channel_telegram: "Telegram",
  },
  channelsTitle: "Мои данные и документы можно получать или передавать по этим каналам:",
  channelsRisk: "Передача чувствительных данных по электронной почте или в мессенджере связана с рисками.",
  required: "обязательно",
  coreHint:
    "Без трёх обязательных согласий GMED не может обработать ваше обращение, поэтому выбор можно сохранить только с ними. Если вы не хотите их давать, ничего не сохраняйте и свяжитесь с нами.",
  coreRequired: "Отметьте, пожалуйста, три обязательных согласия.",
  save: "Сохранить выбор",
  saving: "Сохраняем …",
  savedAt: (date) =>
    `Ваш выбор от ${date} сохранён. Вы можете изменить его в любой момент; уже созданную форму сотрудник GMED тогда создаст заново.`,
  savedByOtherAt: (date) =>
    `Выбор от ${date} сохранил другой родитель или представитель. Если вы сохраните свой выбор, будет действовать ваш; подписывает тот, кто выбрал последним.`,
  notSaved: "Выбор ещё не сохранён.",
  unsaved: "Изменения ещё не сохранены.",
  byGuardianOnly:
    "За несовершеннолетнего родители или опекун выбирают, на что они соглашаются, через свой собственный доступ. Здесь ничего выбирать не нужно.",
  recipientsTitle: "Доверенные лица и учреждения",
  recipientsHint: "Укажите, кому GMED может передавать ваши данные (не более 5). В форме будут только эти лица.",
  recipientName: "Имя и фамилия или название учреждения",
  recipientRelation: "Кто это?",
  recipientContact: "Телефон или e-mail (необязательно)",
  recipientRelations: { spouse: "Супруг(а) / партнёр", child: "Ребёнок", relative: "Родственник", friend: "Друг / знакомый", family_doctor: "Семейный врач", clinic: "Клиника / учреждение", other: "Другое" },
  addRecipient: "Добавить лицо",
  removeRecipient: "Удалить",
  recipientsRequired: "Проверьте решение и список лиц в разделе «Предоставление информации третьим лицам».",
  recipientsInvalid: "Для каждого лица укажите имя и выберите, кто это (не более 5 лиц).",
};

const ruChild: ChildTexts = {
  intro:
    "Выберите сами, на что вы соглашаетесь за своего ребёнка. В форме, которую вы позже подпишете электронно как родитель или опекун, отмечено только то, что вы выберете здесь, — GMED ничего не отмечает за вас. Без вашего выбора вы подписываете форму на бумаге и отмечаете там сами.",
  options: {
    agency_processing:
      "GMED и уполномоченные сотрудники могут получать, обрабатывать, хранить персональные и медицинские данные и документы моего ребёнка и при необходимости передавать их лечащим врачам, клиникам, лабораториям, переводчикам, экспертам или плательщикам.",
    doctors_to_agency: "Лечащие врачи и медицинские учреждения моего ребёнка могут передавать GMED его медицинские документы.",
    data_system: "Документы моего ребёнка могут храниться и обрабатываться в ИТ-системе GMED.",
    named_recipients: "Данные моего ребёнка могут передаваться лицам, которых я указываю в разделе «Предоставление информации третьим лицам».",
    channel_email: "Электронная почта",
    channel_threema: "Threema",
    channel_whatsapp: "WhatsApp",
    channel_telegram: "Telegram",
  },
  channelsTitle: "Данные и документы моего ребёнка можно получать или передавать по этим каналам:",
  coreHint:
    "Без трёх обязательных согласий GMED не может обработать обращение для вашего ребёнка, поэтому выбор можно сохранить только с ними. Если вы не хотите их давать, ничего не сохраняйте и свяжитесь с нами.",
  recipientsHint: "Укажите, кому GMED может передавать данные вашего ребёнка (не более 5). Себя как родителя или опекуна указывать не нужно.",
};

/**
 * The texts in the cabinet language; `forChild` when a parent or guardian chooses for a minor
 * (the child's data, the parent declares).
 */
export function consentFormText(lang: string, forChild = false): ConsentFormText {
  const [base, child] = (() => {
    switch (asLeadCabinetLang(lang)) {
      case "de":
        return [de, deChild] as const;
      case "en":
        return [en, enChild] as const;
      case "uk":
        return [uk, ukChild] as const;
      default:
        return [ru, ruChild] as const;
    }
  })();
  return forChild ? { ...base, ...child } : base;
}
