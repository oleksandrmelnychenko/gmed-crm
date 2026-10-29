import { createContext, useContext } from "react";

/**
 * The client's cabinet form opened by staff from the wizard (owner decision
 * 2026-10-29: «все, що робить пацієнт, ми з візарда також»): staff fill in
 * every step; what the server keeps the patient's own — the consents, the
 * consent options, the trusted persons, the cost-estimate consent and the
 * send — stays read-only here.
 */
export const CabinetStaffModeContext = createContext(false);

export function useCabinetStaffMode(): boolean {
  return useContext(CabinetStaffModeContext);
}

const TEXT = {
  ru: {
    banner: "Вы заполняете анкету за клиента. Всё, что вы вносите, помечено «внёс сотрудник». Согласие клиента записывайте с тем, как он его дал; доверенных лиц и отправку клиент делает сам — в кабинете или подписью на бумаге.",
    clientOnly: "Это делает клиент сам — в кабинете или подписью на бумаге.",
    back: "Вернуться к лиду",
    consentHow: "Как клиент дал согласие",
    channels: { phone: "по телефону", in_person: "лично", email: "по e-mail", paper: "на бумаге" },
    consentNote: "Примечание (необязательно)",
    recordConsent: "Записать согласие",
    recordedBy: (how: string) => `Записал сотрудник · ${how}`,
    withdraw: "Клиент отозвал согласие",
    cancel: "Отмена",
  },
  uk: {
    banner: "Ви заповнюєте анкету за клієнта. Усе, що ви вносите, позначено «вніс співробітник». Згоду клієнта записуйте з тим, як він її дав; довірених осіб і відправку клієнт робить сам — у кабінеті або підписом на папері.",
    clientOnly: "Це робить клієнт сам — у кабінеті або підписом на папері.",
    back: "Повернутися до ліда",
    consentHow: "Як клієнт дав згоду",
    channels: { phone: "телефоном", in_person: "особисто", email: "e-mail", paper: "на папері" },
    consentNote: "Примітка (необов’язково)",
    recordConsent: "Записати згоду",
    recordedBy: (how: string) => `Записав співробітник · ${how}`,
    withdraw: "Клієнт відкликав згоду",
    cancel: "Скасувати",
  },
  de: {
    banner: "Sie füllen das Formular für den Kunden aus. Ihre Angaben sind als «von Mitarbeitenden eingetragen» markiert. Eine Einwilligung des Kunden tragen Sie mit dem Weg ein, auf dem er sie gab; Vertrauenspersonen und das Absenden erledigt der Kunde selbst – im Kundenkabinett oder per Unterschrift auf Papier.",
    clientOnly: "Das erledigt der Kunde selbst – im Kundenkabinett oder per Unterschrift auf Papier.",
    back: "Zurück zum Lead",
    consentHow: "Wie der Kunde eingewilligt hat",
    channels: { phone: "telefonisch", in_person: "persönlich", email: "per E-Mail", paper: "auf Papier" },
    consentNote: "Notiz (optional)",
    recordConsent: "Einwilligung eintragen",
    recordedBy: (how: string) => `Von Mitarbeitenden eingetragen · ${how}`,
    withdraw: "Kunde hat widerrufen",
    cancel: "Abbrechen",
  },
  en: {
    banner: "You are filling in the form for the client. Your entries are marked “entered by staff”. Record a consent of the client with how it was given; trusted persons and sending are done by the client — in the cabinet or by signing on paper.",
    clientOnly: "The client does this — in the cabinet or by signing on paper.",
    back: "Back to the lead",
    consentHow: "How the client consented",
    channels: { phone: "by phone", in_person: "in person", email: "by e-mail", paper: "on paper" },
    consentNote: "Note (optional)",
    recordConsent: "Record the consent",
    recordedBy: (how: string) => `Recorded by staff · ${how}`,
    withdraw: "The client withdrew",
    cancel: "Cancel",
  },
} as const;

export function cabinetStaffText(lang: string) {
  return TEXT[(lang in TEXT ? lang : "ru") as keyof typeof TEXT];
}
