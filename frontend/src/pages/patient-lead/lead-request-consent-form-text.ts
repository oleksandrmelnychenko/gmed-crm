import type { ConsentFormChoices } from "./lead-request-api";
import { asLeadCabinetLang } from "./lead-request-text";

/**
 * Texts of the cabinet block where the person chooses the options of the consent form
 * «Einverständniserklärung zur Datenübermittlung» (Anlage 1), 2026-10-12, in the cabinet's four
 * languages. The options follow the printed form; GMED never ticks anything for the person.
 */
export type ConsentFormText = {
  title: string;
  intro: string;
  options: Record<keyof ConsentFormChoices, string>;
  channelsTitle: string;
  channelsRisk: string;
  save: string;
  saving: string;
  savedAt: (date: string) => string;
  notSaved: string;
  unsaved: string;
};

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
      "Meine Daten dürfen an die Personen oder Institutionen übermittelt werden, die im Formular genannt sind (z. B. meine Vertrauenspersonen).",
    channel_email: "E-Mail",
    channel_threema: "Threema",
    channel_whatsapp: "WhatsApp",
    channel_telegram: "Telegram",
  },
  channelsTitle: "Meine Daten und Unterlagen dürfen über diese Kommunikationswege eingeholt oder übermittelt werden:",
  channelsRisk: "Die Übermittlung sensibler Daten per E-Mail oder Messenger ist mit Risiken verbunden.",
  save: "Auswahl speichern",
  saving: "Wird gespeichert …",
  savedAt: (date) =>
    `Ihre Auswahl vom ${date} ist gespeichert. Sie können sie jederzeit ändern; ein schon erstelltes Formular wird dann neu erstellt.`,
  notSaved: "Noch keine Auswahl gespeichert.",
  unsaved: "Ihre Änderungen sind noch nicht gespeichert.",
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
      "My data may be passed on to the persons or institutions named in the form (for example my trusted persons).",
    channel_email: "E-mail",
    channel_threema: "Threema",
    channel_whatsapp: "WhatsApp",
    channel_telegram: "Telegram",
  },
  channelsTitle: "My data and documents may be obtained or passed on through these channels:",
  channelsRisk: "Sending sensitive data by e-mail or messenger carries risks.",
  save: "Save my choice",
  saving: "Saving …",
  savedAt: (date) =>
    `Your choice of ${date} is saved. You can change it at any time; a form already prepared is then prepared again.`,
  notSaved: "No choice saved yet.",
  unsaved: "Your changes are not saved yet.",
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
      "Мої дані можуть передаватися особам або установам, названим у формі (наприклад, моїм довіреним особам).",
    channel_email: "Електронна пошта",
    channel_threema: "Threema",
    channel_whatsapp: "WhatsApp",
    channel_telegram: "Telegram",
  },
  channelsTitle: "Мої дані та документи можна отримувати або передавати цими каналами:",
  channelsRisk: "Передача чутливих даних електронною поштою чи месенджером пов'язана з ризиками.",
  save: "Зберегти вибір",
  saving: "Зберігаємо …",
  savedAt: (date) =>
    `Ваш вибір від ${date} збережено. Ви можете змінити його будь-коли; уже створену форму тоді буде створено заново.`,
  notSaved: "Вибір ще не збережено.",
  unsaved: "Зміни ще не збережено.",
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
      "Мои данные могут передаваться лицам или учреждениям, названным в форме (например, моим доверенным лицам).",
    channel_email: "Электронная почта",
    channel_threema: "Threema",
    channel_whatsapp: "WhatsApp",
    channel_telegram: "Telegram",
  },
  channelsTitle: "Мои данные и документы можно получать или передавать по этим каналам:",
  channelsRisk: "Передача чувствительных данных по электронной почте или в мессенджере связана с рисками.",
  save: "Сохранить выбор",
  saving: "Сохраняем …",
  savedAt: (date) =>
    `Ваш выбор от ${date} сохранён. Вы можете изменить его в любой момент; уже созданная форма тогда будет создана заново.`,
  notSaved: "Выбор ещё не сохранён.",
  unsaved: "Изменения ещё не сохранены.",
};

export function consentFormText(lang: string): ConsentFormText {
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
