/**
 * Reasons of a DSGVO decision that the data subject reads in the patient
 * portal (Art. 12 Abs. 4 DSGVO). They are written in the patient's language,
 * not in the language of the staff member who decides: a German patient never
 * reads a Russian legal text (QA 2026-10-12 B2-08, E2-05). The language is the
 * first of the patient's languages a text exists for; German otherwise.
 */
export type PatientTextLanguage = "de" | "en" | "ru" | "uk";

const PATIENT_TEXT_LANGUAGES: readonly PatientTextLanguage[] = ["de", "en", "ru", "uk"];

/** The language a text for this patient is written in. */
export function patientTextLanguage(
  languages: readonly string[] | null | undefined,
): PatientTextLanguage {
  for (const value of languages ?? []) {
    const base = value.trim().toLowerCase().split(/[-_]/)[0];
    const code = base === "ua" ? "uk" : base;
    if ((PATIENT_TEXT_LANGUAGES as readonly string[]).includes(code)) {
      return code as PatientTextLanguage;
    }
  }
  return "de";
}

/** The name of a text language, in the staff member's UI language. */
export function patientTextLanguageName(language: PatientTextLanguage, uiLang: string): string {
  const names: Record<PatientTextLanguage, { ru: string; de: string }> = {
    de: { ru: "немецкий", de: "Deutsch" },
    en: { ru: "английский", de: "Englisch" },
    ru: { ru: "русский", de: "Russisch" },
    uk: { ru: "украинский", de: "Ukrainisch" },
  };
  return uiLang === "de" ? names[language].de : names[language].ru;
}

// lawyer review pending (2026-10-22): one form of legal reference per language, as in the lead
// cabinet and the payer link ("Art. 17 Abs. 3 lit. b DSGVO", "ст. 17 абз. 3 лит./літ. b DSGVO", "Art. 17(3)(b) GDPR").
const RETENTION_HOLD_REASON: Record<PatientTextLanguage, string> = {
  de: "Ihre ärztliche Dokumentation müssen wir bis zum {date} aufbewahren (§ 630f Abs. 3 BGB). Bis dahin ist eine Löschung ausgeschlossen (Art. 17 Abs. 3 lit. b DSGVO). Statt der Löschung haben wir die Verarbeitung Ihrer Daten eingeschränkt (Art. 18 DSGVO, § 35 Abs. 3 BDSG). Nach Ablauf der Frist prüfen wir Ihren Löschantrag erneut.",
  en: "We are required to keep your medical records until {date} (Section 630f (3) of the German Civil Code, BGB). Until then, erasure is excluded (Art. 17(3)(b) GDPR). Instead of erasing your data, we have restricted its processing (Art. 18 GDPR, Section 35(3) BDSG). Once this period has ended, we will review your erasure request again.",
  ru: "Вашу медицинскую документацию мы обязаны хранить до {date} (§ 630f абз. 3 BGB). До этой даты удаление исключено (ст. 17 абз. 3 лит. b DSGVO). Вместо удаления мы ограничили обработку ваших данных (ст. 18 DSGVO, § 35 абз. 3 BDSG). После окончания срока мы повторно рассмотрим ваш запрос на удаление.",
  uk: "Вашу медичну документацію ми зобов’язані зберігати до {date} (§ 630f абз. 3 BGB). До цієї дати видалення виключене (ст. 17 абз. 3 літ. b DSGVO). Замість видалення ми обмежили обробку ваших даних (ст. 18 DSGVO, § 35 абз. 3 BDSG). Після закінчення строку ми повторно розглянемо ваш запит на видалення.",
};

const OPEN_BUSINESS_HOLD_REASON: Record<PatientTextLanguage, string> = {
  de: "Ihr Löschantrag wird nach Abschluss laufender Aufträge ausgeführt. Solange noch ein Auftrag oder eine Rechnung offen ist, benötigen wir Ihre Daten, um ihn abzuwickeln. Danach prüfen wir Ihren Antrag sofort erneut.",
  en: "Your erasure request will be carried out once your current orders are completed. As long as an order or an invoice is still open, we need your data to handle it. We will then review your request again straight away.",
  ru: "Ваш запрос на удаление будет исполнен после завершения текущих заказов. Пока заказ или счёт ещё открыт, ваши данные нужны нам для его исполнения. После этого мы сразу повторно рассмотрим ваш запрос.",
  uk: "Ваш запит на видалення буде виконано після завершення поточних замовлень. Поки замовлення або рахунок ще відкриті, ваші дані потрібні нам для їх виконання. Після цього ми одразу повторно розглянемо ваш запит.",
};

/** Why an erasure waits for the end of the medical documentation's retention. */
export function retentionHoldReasonText(language: PatientTextLanguage, date: string): string {
  return RETENTION_HOLD_REASON[language].replace("{date}", date);
}

/** Why an erasure waits for open orders and invoices (no restriction implied). */
export function openBusinessHoldReasonText(language: PatientTextLanguage): string {
  return OPEN_BUSINESS_HOLD_REASON[language];
}
