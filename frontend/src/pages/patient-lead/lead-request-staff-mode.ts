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
    banner: "Вы заполняете анкету за клиента. Всё, что вы вносите, помечено «внёс сотрудник». Согласия, доверенных лиц и отправку клиент делает сам — в кабинете или подписью на бумаге.",
    clientOnly: "Это делает клиент сам — в кабинете или подписью на бумаге.",
    back: "Вернуться к лиду",
  },
  uk: {
    banner: "Ви заповнюєте анкету за клієнта. Усе, що ви вносите, позначено «вніс співробітник». Згоди, довірених осіб і відправку клієнт робить сам — у кабінеті або підписом на папері.",
    clientOnly: "Це робить клієнт сам — у кабінеті або підписом на папері.",
    back: "Повернутися до ліда",
  },
  de: {
    banner: "Sie füllen das Formular für den Kunden aus. Ihre Angaben sind als «von Mitarbeitenden eingetragen» markiert. Einwilligungen, Vertrauenspersonen und das Absenden erledigt der Kunde selbst – im Kundenkabinett oder per Unterschrift auf Papier.",
    clientOnly: "Das erledigt der Kunde selbst – im Kundenkabinett oder per Unterschrift auf Papier.",
    back: "Zurück zum Lead",
  },
  en: {
    banner: "You are filling in the form for the client. Your entries are marked “entered by staff”. Consents, trusted persons and sending are done by the client — in the cabinet or by signing on paper.",
    clientOnly: "The client does this — in the cabinet or by signing on paper.",
    back: "Back to the lead",
  },
} as const;

export function cabinetStaffText(lang: string) {
  return TEXT[(lang in TEXT ? lang : "ru") as keyof typeof TEXT];
}
