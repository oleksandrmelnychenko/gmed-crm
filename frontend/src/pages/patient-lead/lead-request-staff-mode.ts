import { createContext, useContext } from "react";

/**
 * The client's cabinet form opened by staff from the wizard (owner decision
 * 2026-10-29: «все, що робить пацієнт, ми з візарда також»): staff fill in
 * every step. What the client consents to — the consents, the consent form
 * options, the trusted persons and the cost-estimate consent — staff record
 * with how the client gave it (and a note); only the send stays the client's.
 * The prompts name the client «или его представитель» (owner 2026-10-30): a
 * parent or another representative often answers for the client.
 */
export const CabinetStaffModeContext = createContext(false);

export function useCabinetStaffMode(): boolean {
  return useContext(CabinetStaffModeContext);
}

const TEXT = {
  ru: {
    banner: "Вы заполняете анкету за клиента. Всё, что вы вносите, помечено «внёс сотрудник». Согласия клиента, его выбор в форме согласия и доверенных лиц записывайте с тем, как он их дал; отправить анкету за клиента можно на последнем шаге, указав, как он подтвердил данные.",
    sendHint: "Как клиент или его представитель подтвердил, что данные полны и верны",
    sendForClient: "Отправить за клиента",
    sendTitle: "Подтверждение клиента",
    clientOnly: "Это делает клиент сам — в кабинете или подписью на бумаге.",
    back: "Вернуться к лиду",
    consentHow: "Как клиент или его представитель дал согласие",
    recordPending: "Укажите, как клиент дал согласие, и нажмите «Записать согласие» — до этого согласие не сохранено.",
    channels: { phone: "по телефону", in_person: "лично", email: "по e-mail", paper: "на бумаге" },
    consentNote: "Примечание (необязательно)",
    recordConsent: "Записать согласие",
    recordChanges: "Изменения сохранятся, когда вы укажете, как клиент или его представитель дал согласие, и запишете его.",
    recordDefaultNo: "Ответ «Нет» ещё не записан — укажите, как клиент ответил, и запишите.",
    recordFirst: "Укажите, как клиент или его представитель дал согласие, и запишите его — или верните прежний выбор.",
    recordedBy: (how: string) => `Записал сотрудник · ${how}`,
    withdraw: "Клиент отозвал согласие",
    cancel: "Отмена",
  },
  uk: {
    banner: "Ви заповнюєте анкету за клієнта. Усе, що ви вносите, позначено «вніс співробітник». Згоди клієнта, його вибір у формі згоди та довірених осіб записуйте з тим, як він їх дав; надіслати анкету за клієнта можна на останньому кроці, вказавши, як він підтвердив дані.",
    sendHint: "Як клієнт або його представник підтвердив, що дані повні й правильні",
    sendForClient: "Надіслати за клієнта",
    sendTitle: "Підтвердження клієнта",
    clientOnly: "Це робить клієнт сам — у кабінеті або підписом на папері.",
    back: "Повернутися до ліда",
    consentHow: "Як клієнт або його представник дав згоду",
    recordPending: "Вкажіть, як клієнт дав згоду, і натисніть «Записати згоду» — доти згоду не збережено.",
    channels: { phone: "телефоном", in_person: "особисто", email: "e-mail", paper: "на папері" },
    consentNote: "Примітка (необов’язково)",
    recordConsent: "Записати згоду",
    recordChanges: "Зміни збережуться, коли ви вкажете, як клієнт або його представник дав згоду, і запишете її.",
    recordDefaultNo: "Відповідь «Ні» ще не записано — вкажіть, як клієнт відповів, і запишіть.",
    recordFirst: "Вкажіть, як клієнт або його представник дав згоду, і запишіть її — або поверніть попередній вибір.",
    recordedBy: (how: string) => `Записав співробітник · ${how}`,
    withdraw: "Клієнт відкликав згоду",
    cancel: "Скасувати",
  },
  de: {
    banner: "Sie füllen das Formular für den Kunden aus. Ihre Angaben sind als «von Mitarbeitenden eingetragen» markiert. Einwilligungen des Kunden, seine Auswahl in der Einwilligungserklärung und Vertrauenspersonen tragen Sie mit dem Weg ein, auf dem er sie gab; das Formular senden Sie für den Kunden im letzten Schritt ab, mit dem Weg, auf dem er die Angaben bestätigt hat.",
    sendHint: "Wie der Kunde oder seine Vertretung bestätigt hat, dass die Angaben vollständig und richtig sind",
    sendForClient: "Für den Kunden absenden",
    sendTitle: "Bestätigung des Kunden",
    clientOnly: "Das erledigt der Kunde selbst – im Kundenkabinett oder per Unterschrift auf Papier.",
    back: "Zurück zum Lead",
    consentHow: "Wie der Kunde oder seine Vertretung eingewilligt hat",
    recordPending: "Geben Sie an, wie der Kunde eingewilligt hat, und klicken Sie auf «Einwilligung eintragen» – bis dahin ist nichts gespeichert.",
    channels: { phone: "telefonisch", in_person: "persönlich", email: "per E-Mail", paper: "auf Papier" },
    consentNote: "Notiz (optional)",
    recordConsent: "Einwilligung eintragen",
    recordChanges: "Die Änderungen werden gespeichert, sobald Sie angeben, wie der Kunde oder seine Vertretung eingewilligt hat, und die Einwilligung eintragen.",
    recordDefaultNo: "Die Antwort «Nein» ist noch nicht eingetragen – geben Sie an, wie der Kunde geantwortet hat, und tragen Sie sie ein.",
    recordFirst: "Geben Sie an, wie der Kunde oder seine Vertretung eingewilligt hat, und tragen Sie die Einwilligung ein – oder stellen Sie die vorige Auswahl wieder her.",
    recordedBy: (how: string) => `Von Mitarbeitenden eingetragen · ${how}`,
    withdraw: "Kunde hat widerrufen",
    cancel: "Abbrechen",
  },
  en: {
    banner: "You are filling in the form for the client. Your entries are marked “entered by staff”. Record the client's consents, their consent form options and trusted persons with how they were given; send the form for the client on the last step, saying how they confirmed the details.",
    sendHint: "How the client or their representative confirmed the details are complete and true",
    sendForClient: "Send for the client",
    sendTitle: "The client's confirmation",
    clientOnly: "The client does this — in the cabinet or by signing on paper.",
    back: "Back to the lead",
    consentHow: "How the client or their representative consented",
    recordPending: "Say how the client consented and click «Record the consent» — nothing is saved until then.",
    channels: { phone: "by phone", in_person: "in person", email: "by e-mail", paper: "on paper" },
    consentNote: "Note (optional)",
    recordConsent: "Record the consent",
    recordChanges: "The changes are saved once you say how the client or their representative consented and record it.",
    recordDefaultNo: "The answer «No» is not recorded yet — say how the client answered and record it.",
    recordFirst: "Say how the client or their representative consented and record it — or restore the previous choice.",
    recordedBy: (how: string) => `Recorded by staff · ${how}`,
    withdraw: "The client withdrew",
    cancel: "Cancel",
  },
} as const;

export function cabinetStaffText(lang: string) {
  return TEXT[(lang in TEXT ? lang : "ru") as keyof typeof TEXT];
}
