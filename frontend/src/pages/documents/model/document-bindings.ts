import { countryNameForGermanDocument } from "@/components/ui/country-select";
import { appDateKey } from "@/lib/app-time-zone";
import type { ServiceDescriptionItem } from "@/lib/service-description";
import {
  parseAssetOriginEvidence,
  serializeAssetOriginEvidence,
} from "@/pages/documents/model/asset-origin-evidence";

export type BindingFieldKind =
  | "text"
  | "country"
  | "date"
  | "number"
  | "textarea"
  | "boolean";
export type BindingFieldDef = {
  key: string;
  label: string;
  labelRu?: string;
  kind: BindingFieldKind;
};

export type DocumentBindingForm = Record<string, string>;

/**
 * Binding of the due-diligence form that holds the uploaded proofs of the
 * origin of assets, as JSON text (the form keeps string values only).
 */
export const ASSET_ORIGIN_EVIDENCE_BINDING_KEY = "assetOriginEvidence";

export type PatientPartyBindingSource = {
  address_city?: string | null;
  address_country?: string | null;
  address_street?: string | null;
  address_zip?: string | null;
  email?: string | null;
  intake_profile?: {
    trusted_contacts?: unknown;
  } | null;
  nationality?: string | null;
  phone_primary?: string | null;
  residence_country?: string | null;
};

export function patientPartyBindingDefaults(
  patient: PatientPartyBindingSource | null | undefined,
): DocumentBindingForm {
  if (!patient) return {};
  const values: DocumentBindingForm = {
    party_street: patient.address_street?.trim() ?? "",
    party_zip: patient.address_zip?.trim() ?? "",
    party_city: patient.address_city?.trim() ?? "",
    party_country:
      patient.address_country?.trim() ||
      patient.residence_country?.trim() ||
      patient.nationality?.trim() ||
      "",
    party_email: patient.email?.trim() ?? "",
    party_phone: patient.phone_primary?.trim() ?? "",
    party_sign_place: patient.address_city?.trim() ?? "",
  };
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value),
  );
}

const PATIENT_PARTY_BINDING_KEYS = new Set([
  "party_street",
  "party_zip",
  "party_city",
  "party_country",
  "party_email",
  "party_phone",
  "party_sign_place",
  "extra_release_recipients",
]);

export function keepPatientPartyBindings(
  bindings: DocumentBindingForm,
): DocumentBindingForm {
  return Object.fromEntries(
    Object.entries(bindings).filter(([key]) =>
      PATIENT_PARTY_BINDING_KEYS.has(key),
    ),
  );
}

const FIXED_LEGAL_TEMPLATE_IDS = new Set([
  "confidentiality_release",
  "privacy_information",
  "privacy_consents",
  "enhanced_due_diligence",
  "gwg_identification",
  // The lead's patient form: filled by the server from the sent request.
  "lead_self_disclosure",
  // The payer's signature package (phase 3b): no free-form overrides.
  "payer_self_disclosure",
  "patient_payer_statement",
  "payer_cost_estimate",
]);

const DESIGNED_AGENCY_TEMPLATE_IDS = new Set([
  ...FIXED_LEGAL_TEMPLATE_IDS,
  "treatment_plan",
  "medication_summary",
  "framework_contract",
  "visa_invitation_letter",
  "patient_sticker_compact",
  "patient_sticker_standard",
  "patient_sticker_sheet",
  "single_order",
  "order_cost_estimate",
  "cost_coverage_declaration",
  "cost_estimate",
  "appointment_confirmation",
  "consent_data_release_child",
  "consent_data_release_single",
]);

/** Templates the server generates only for a lead (it marks them `lead_only`). */
const LEAD_ONLY_TEMPLATE_IDS = new Set([
  "gwg_identification",
  "lead_self_disclosure",
  "payer_self_disclosure",
  "patient_payer_statement",
  "payer_cost_estimate",
]);

/**
 * Whether a template is generated only for a lead: the patient dialogs never
 * offer it, the server would refuse it (QA 2026-10-11 B-19).
 */
export function isLeadOnlyDocumentTemplate(template: { id: string; lead_only?: boolean }) {
  return template.lead_only === true || LEAD_ONLY_TEMPLATE_IDS.has(template.id);
}

export function isFixedLegalDocumentTemplate(templateId: string) {
  return FIXED_LEGAL_TEMPLATE_IDS.has(templateId);
}

export function isDesignedAgencyDocumentTemplate(templateId: string) {
  return DESIGNED_AGENCY_TEMPLATE_IDS.has(templateId);
}

/**
 * Templates whose service lines come from the selected order and its quote.
 * The preliminary cost calculation (`cost_estimate`) is not one of them: it
 * lists medical services only, never the agency's order lines.
 */
export function documentTemplateUsesOrderServices(templateId: string, orderId?: string | null) {
  return Boolean(orderId) && (templateId === "single_order" || templateId === "order_cost_estimate");
}

export function documentBindingFieldLabel(
  field: BindingFieldDef,
  lang: "de" | "ru",
) {
  return lang === "ru" ? (field.labelRu ?? field.label) : field.label;
}

const PATIENT_STICKER_BINDING_FIELDS: BindingFieldDef[] = [
  { key: "kt1", label: "KT1", kind: "text" },
  { key: "kt2", label: "KT2", kind: "text" },
  { key: "cost_code", label: "Kostenstelle / Code", labelRu: "Место затрат / код", kind: "text" },
];

const ENHANCED_DUE_DILIGENCE_BOOLEAN_KEYS = [
  "internalRiskAnalysis",
  "individualReview",
  "pepContractPartner",
  "pepBeneficialOwner",
  "highRiskCountryTransaction",
  "highRiskCountryResident",
  "unusualComplexOrLarge",
  "unusualPattern",
  "noLawfulPurpose",
] as const;

export const ENHANCED_DUE_DILIGENCE_BINDING_FIELDS: BindingFieldDef[] = [
  { key: "riskTier", label: "Risikostufe", labelRu: "Уровень риска", kind: "text" },
  { key: "triggeredCountries", label: "Auslösende Länder", labelRu: "Страны риска", kind: "text" },
  { key: "internalRiskAnalysis", label: "Interne Risikoanalyse", labelRu: "Внутренний анализ рисков", kind: "boolean" },
  { key: "individualReview", label: "Individuelle Prüfung des konkreten Einzelfalls", labelRu: "Индивидуальная оценка конкретного случая", kind: "boolean" },
  { key: "riskReason", label: "Begründung des erhöhten Risikos", labelRu: "Обоснование повышенного риска", kind: "textarea" },
  { key: "assetOrigin", label: "Herkunft der eingesetzten Vermögenswerte", labelRu: "Происхождение задействованных активов", kind: "textarea" },
  { key: "pepContractPartner", label: "Vertragspartner ist eine PeP", labelRu: "Контрагент является PEP", kind: "boolean" },
  { key: "pepBeneficialOwner", label: "Wirtschaftlich Berechtigter ist eine PeP", labelRu: "Бенефициарный владелец является PEP", kind: "boolean" },
  { key: "pepOfficeFunction", label: "Amt / Funktion", labelRu: "Должность / функция", kind: "text" },
  { key: "pepAssetOrigin", label: "Herkunft der Vermögenswerte der PeP", labelRu: "Происхождение активов PEP", kind: "text" },
  { key: "sanctionsLinks", label: "Angaben zu Verbindungen zu sanktionierten Personen", labelRu: "Сведения о связях с лицами под санкциями", kind: "textarea" },
  { key: "highRiskCountryTransaction", label: "Transaktion mit Bezug zu einem Drittstaat mit hohem Risiko", labelRu: "Операция связана с третьей страной высокого риска", kind: "boolean" },
  { key: "highRiskCountryResident", label: "Vertragspartner ist dort niedergelassen oder wohnhaft", labelRu: "Контрагент проживает или зарегистрирован в такой стране", kind: "boolean" },
  { key: "affectedThirdCountry", label: "Betroffener Drittstaat", labelRu: "Затронутая третья страна", kind: "text" },
  { key: "additionalContractPartnerInfo", label: "Zusätzliche Informationen zum Vertragspartner", labelRu: "Дополнительная информация о контрагенте", kind: "textarea" },
  { key: "additionalBeneficialOwnerInfo", label: "Zusätzliche Informationen zum wirtschaftlich Berechtigten", labelRu: "Дополнительная информация о бенефициаре", kind: "textarea" },
  { key: "intendedBusinessRelationshipInfo", label: "Angestrebte Art der Geschäftsbeziehung", labelRu: "Планируемый характер деловых отношений", kind: "textarea" },
  { key: "contractPartnerAssetInfo", label: "Vermögenswerte des Vertragspartners", labelRu: "Активы контрагента", kind: "textarea" },
  { key: "beneficialOwnerAssetInfo", label: "Vermögenswerte des wirtschaftlich Berechtigten", labelRu: "Активы бенефициарного владельца", kind: "textarea" },
  { key: "transactionReasons", label: "Gründe der konkreten Transaktion", labelRu: "Причины конкретной операции", kind: "textarea" },
  { key: "plannedAssetUse", label: "Geplante Verwendung der eingesetzten Vermögenswerte", labelRu: "Планируемое использование активов", kind: "textarea" },
  { key: "managerApprovalName", label: "Zustimmende Führungskraft", labelRu: "Согласовавший руководитель", kind: "text" },
  { key: "unusualComplexOrLarge", label: "Komplexe oder ungewöhnlich große Transaktion", labelRu: "Сложная или необычно крупная операция", kind: "boolean" },
  { key: "unusualPattern", label: "Ungewöhnliches Transaktionsmuster", labelRu: "Необычная схема операции", kind: "boolean" },
  { key: "noLawfulPurpose", label: "Kein offensichtlicher rechtmäßiger Zweck", labelRu: "Нет очевидной законной цели", kind: "boolean" },
  { key: "investigationResults", label: "Ergebnisse der Untersuchung", labelRu: "Результаты проверки", kind: "textarea" },
  { key: "continuousMonitoring", label: "Maßnahmen der kontinuierlichen Überwachung", labelRu: "Меры постоянного мониторинга", kind: "textarea" },
  { key: "additionalMeasures", label: "Zusätzlich getroffene Maßnahmen", labelRu: "Принятые дополнительные меры", kind: "textarea" },
  { key: "reviewerName", label: "Bearbeiter/in", labelRu: "Проверил", kind: "text" },
  { key: "reviewDate", label: "Prüfdatum", labelRu: "Дата проверки", kind: "date" },
];

/**
 * Risk tiers whose check the owner's rule requires (2026-10-07: a black-list
 * country or a confirmed sanctions hit). Only for them the higher risk is the
 * finding of the internal risk analysis; a high-risk country, a PEP or a
 * voluntary check ("Einzelfallprüfung") is the individual review's.
 */
export function enhancedDueDiligenceTierRequiresCheck(tier: string | null | undefined): boolean {
  return tier === "blacklist" || tier === "sanctions";
}

export function enhancedDueDiligenceBindingDefaults(): DocumentBindingForm {
  return {
    // Ticked with a required risk tier only (QA 2026-10-11), see
    // `enhancedDueDiligenceTierRequiresCheck`.
    internalRiskAnalysis: "false",
    individualReview: "false",
    pepContractPartner: "false",
    pepBeneficialOwner: "false",
    highRiskCountryTransaction: "false",
    highRiskCountryResident: "false",
    unusualComplexOrLarge: "false",
    unusualPattern: "false",
    noLawfulPurpose: "false",
    reviewDate: appDateKey(),
  };
}

export function parseEnhancedDueDiligenceCountries(value?: string) {
  return Array.from(
    new Set(
      (value ?? "")
        .split(/[\s,;]+/)
        .map((country) => country.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

function enhancedDueDiligencePayload(bindings: DocumentBindingForm) {
  const aml: Record<string, unknown> = {
    triggeredCountries: parseEnhancedDueDiligenceCountries(
      bindings.triggeredCountries,
    ),
  };
  for (const key of ENHANCED_DUE_DILIGENCE_BOOLEAN_KEYS) {
    aml[key] = bindings[key] === "true";
  }
  for (const field of ENHANCED_DUE_DILIGENCE_BINDING_FIELDS) {
    if (
      field.kind === "boolean" ||
      field.key === "triggeredCountries"
    ) {
      continue;
    }
    const value = bindings[field.key]?.trim();
    if (value) aml[field.key] = value;
  }
  const evidence = parseAssetOriginEvidence(bindings[ASSET_ORIGIN_EVIDENCE_BINDING_KEY]);
  if (evidence.length > 0) aml[ASSET_ORIGIN_EVIDENCE_BINDING_KEY] = evidence;
  return { aml_enhanced_due_diligence: aml };
}

export function validateEnhancedDueDiligenceBindings(
  bindings: DocumentBindingForm,
  lang: "de" | "ru",
) {
  const missing: string[] = [];
  const labels = new Map(
    ENHANCED_DUE_DILIGENCE_BINDING_FIELDS.map((field) => [
      field.key,
      documentBindingFieldLabel(field, lang),
    ]),
  );
  const requireFields = (keys: string[]) => {
    for (const key of keys) {
      if (!bindings[key]?.trim()) missing.push(labels.get(key) ?? key);
    }
  };
  const riskTier = bindings.riskTier?.trim();
  // Owner rule 2026-10-07: a confirmed sanctions match, or a check staff
  // carry out without any trigger, are tiers of their own.
  if (!["pep", "high_risk", "blacklist", "sanctions", "individual"].includes(riskTier ?? "")) {
    missing.push(labels.get("riskTier") ?? "Risikostufe");
  }
  requireFields([
    "riskReason",
    "managerApprovalName",
    "continuousMonitoring",
    "reviewerName",
    "reviewDate",
  ]);
  const countryRisk =
    riskTier === "high_risk" ||
    riskTier === "blacklist" ||
    parseEnhancedDueDiligenceCountries(bindings.triggeredCountries).length > 0;
  if (countryRisk) {
    requireFields([
      "affectedThirdCountry",
      "additionalContractPartnerInfo",
      "intendedBusinessRelationshipInfo",
      "contractPartnerAssetInfo",
      "transactionReasons",
      "plannedAssetUse",
    ]);
  }
  if (
    bindings.pepContractPartner === "true" ||
    bindings.pepBeneficialOwner === "true"
  ) {
    requireFields(["pepOfficeFunction", "pepAssetOrigin"]);
  }
  if (missing.length === 0) return "";
  return lang === "de"
    ? `Pflichtfelder der AML-Prüfung ausfüllen: ${missing.join(", ")}.`
    : `Заполните обязательные поля AML-проверки: ${missing.join(", ")}.`;
}

export function formatEnhancedDueDiligenceError(
  error: unknown,
  lang: "de" | "ru",
) {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("Enhanced due diligence data is required") ||
    message.includes("Required enhanced due diligence fields are missing")
  ) {
    return lang === "de"
      ? "Die Pflichtfelder der AML-Prüfung sind unvollständig. Prüfen Sie die eingegebenen Daten."
      : "Обязательные поля AML-проверки заполнены не полностью. Проверьте введённые данные.";
  }
  return message;
}

/** Server refusals for a preliminary cost calculation without medical services. */
export function formatCostEstimateGenerationError(
  error: unknown,
  lang: "de" | "ru",
): string | null {
  const message = error instanceof Error ? error.message : "";
  if (message === "Select medical work types before creating the preliminary cost calculation") {
    return lang === "de"
      ? "Wählen Sie zuerst in der Auftragsvorbereitung die medizinischen Leistungsarten aus. Agenturleistungen gehören nicht in die vorläufige Kostenkalkulation."
      : "Сначала выберите медицинские виды работ при оформлении заказа. Услуги агентства в предварительный расчёт не входят.";
  }
  if (message === "Enter the medical services before creating the preliminary cost calculation") {
    return lang === "de"
      ? "Tragen Sie die medizinischen Leistungen mit ihren Preisspannen ein. Agenturleistungen aus dem Auftrag werden nicht übernommen."
      : "Укажите медицинские услуги и диапазоны их стоимости. Услуги агентства из заказа не переносятся.";
  }
  return null;
}

/**
 * The server's refusals of `POST /documents/generate` (crates/server/src/
 * routes/documents.rs `generate_document` and its helpers), in the user's
 * language. A stable error code wins over the message (`lead_document_only`
 * and the other codes of the lead's documents).
 */
const DOCUMENT_GENERATION_ERRORS: Array<{
  match: string[];
  ru: string;
  de: string;
}> = [
  {
    match: ["lead_document_only", "is generated for a lead"],
    ru: "Этот документ создаётся только для лида (обращения), не для пациента.",
    de: "Dieses Dokument wird nur für eine Anfrage erstellt, nicht für einen Patienten.",
  },
  {
    match: ["payer_declaration_not_third_party", "names no third-party payer", "has no third-party payer"],
    ru: "В декларации плательщика не указан третий плательщик.",
    de: "Die Zahlererklärung nennt keine dritte zahlende Person.",
  },
  {
    match: ["payer_not_submitted", "has not sent its answers"],
    ru: "Плательщик ещё не отправил свои ответы.",
    de: "Die zahlende Person hat ihre Angaben noch nicht gesendet.",
  },
  {
    match: ["Treatment plan template requires at least one appointment"],
    ru: "Для плана лечения нужен хотя бы один термин пациента: выберите заказ или термин с назначенными приёмами.",
    de: "Für den Behandlungsplan ist mindestens ein Termin erforderlich: Wählen Sie einen Auftrag oder Termin mit geplanten Terminen.",
  },
  {
    match: ["Medication summary template requires at least one case"],
    ru: "Для обзора медикаментов нужен хотя бы один кейс пациента.",
    de: "Für die Medikamentenübersicht ist mindestens ein Fall des Patienten erforderlich.",
  },
  {
    match: ["Medication summary template requires recorded medication"],
    ru: "Для обзора медикаментов у пациента должна быть записана медикация.",
    de: "Für die Medikamentenübersicht muss beim Patienten eine Medikation erfasst sein.",
  },
  {
    match: ["Framework contract template requires an existing framework contract"],
    ru: "Сначала создайте рамочный договор пациента.",
    de: "Erstellen Sie zuerst einen Rahmenvertrag für den Patienten.",
  },
  {
    match: ["Order context is required"],
    ru: "Выберите заказ для этого документа.",
    de: "Wählen Sie einen Auftrag für dieses Dokument aus.",
  },
  {
    match: ["Free text document requires document text"],
    ru: "Введите текст документа.",
    de: "Geben Sie den Dokumenttext ein.",
  },
  {
    match: ["do not support free-form text overrides"],
    ru: "Текст этого шаблона нельзя заменить свободным текстом.",
    de: "Der Text dieser Vorlage kann nicht durch freien Text ersetzt werden.",
  },
  {
    match: ["Generated document text is too long"],
    ru: "Текст документа слишком длинный.",
    de: "Der Dokumenttext ist zu lang.",
  },
  {
    match: ["This template is only available after patient conversion"],
    ru: "Этот шаблон доступен только после создания пациента.",
    de: "Diese Vorlage ist erst nach der Umwandlung in einen Patienten verfügbar.",
  },
  {
    match: ["Generated documents must be linked to a patient", "Provider templates require a patient context"],
    ru: "Документ должен относиться к пациенту.",
    de: "Das Dokument muss einem Patienten zugeordnet sein.",
  },
  {
    match: ["Language is not supported by the selected template", "Unknown document language"],
    ru: "Этот язык шаблон не поддерживает.",
    de: "Diese Sprache wird von der Vorlage nicht unterstützt.",
  },
  {
    match: ["Patient birth date is required for a patient sticker"],
    ru: "Для наклейки нужна дата рождения пациента.",
    de: "Für das Patientenetikett ist das Geburtsdatum erforderlich.",
  },
  {
    match: ["Unknown patient sticker format"],
    ru: "Неизвестный формат наклейки.",
    de: "Unbekanntes Etikettenformat.",
  },
  {
    match: ["before generating its documents"],
    ru: "Сначала заполните оформление заказа, затем создавайте его документы.",
    de: "Bearbeiten Sie zuerst die Auftragsvorbereitung und erstellen Sie dann die Dokumente.",
  },
  {
    match: ["Order changed during document generation"],
    ru: "Заказ изменился во время создания документа. Создайте новую версию.",
    de: "Der Auftrag wurde während der Erstellung geändert. Erstellen Sie eine neue Version.",
  },
  {
    match: ["text block key"],
    ru: "Выбранный текстовый блок недоступен для этого шаблона.",
    de: "Der gewählte Textbaustein ist für diese Vorlage nicht verfügbar.",
  },
  {
    match: ["Provider template must match", "Provider template doctor must match"],
    ru: "Шаблон провайдера не подходит к выбранному термину.",
    de: "Die Provider-Vorlage passt nicht zum gewählten Termin.",
  },
  {
    match: ["context do not match", "cannot use lead context", "cannot use patient and lead context", "must use its patient context"],
    ru: "Заказ или термин не относится к этому пациенту.",
    de: "Auftrag oder Termin gehört nicht zu diesem Patienten.",
  },
  {
    match: ["Replacement document already has a newer version"],
    ru: "У документа уже есть более новая версия.",
    de: "Das Dokument hat bereits eine neuere Version.",
  },
  {
    match: ["Archived documents cannot be replaced again"],
    ru: "Архивный документ нельзя заменить новой версией.",
    de: "Ein archiviertes Dokument kann nicht durch eine neue Version ersetzt werden.",
  },
  {
    match: ["Replacement document must"],
    ru: "Новая версия должна сохранить пациента, заказ, термин и шаблон документа.",
    de: "Die neue Version muss Patient, Auftrag, Termin und Vorlage des Dokuments beibehalten.",
  },
  {
    match: ["Unknown document template"],
    ru: "Шаблон не найден.",
    de: "Vorlage nicht gefunden.",
  },
  {
    match: ["Patient not found", "Lead not found", "Order not found", "Appointment not found", "Replacement document not found"],
    ru: "Пациент, лид, заказ, термин или документ не найден.",
    de: "Patient, Anfrage, Auftrag, Termin oder Dokument nicht gefunden.",
  },
  {
    match: ["Invalid document status", "Invalid document visibility"],
    ru: "Недопустимый статус или видимость документа.",
    de: "Ungültiger Status oder ungültige Sichtbarkeit des Dokuments.",
  },
  {
    match: ["You are not assigned to this patient", "Insufficient permissions"],
    ru: "Нет прав создавать документы для этого пациента.",
    de: "Keine Berechtigung, für diesen Patienten Dokumente zu erstellen.",
  },
  {
    match: ["specialization work type"],
    ru: "Выбранные виды работ больше недоступны. Обновите выбор.",
    de: "Die gewählten Leistungsarten sind nicht mehr verfügbar. Bitte aktualisieren Sie die Auswahl.",
  },
  {
    match: ["cost estimate cannot be copied"],
    ru: "Смету клиента нельзя перенести в документ плательщика.",
    de: "Der Kostenvoranschlag des Kunden kann nicht übernommen werden.",
  },
];

const ALREADY_LOCALIZED_ERROR_CODES = new Set([
  "signature_pending",
  "sanctions_confirmed",
  "sanctions_review_pending",
  "blocked_country",
  "rate_limited",
  "network",
  "timeout",
  "aborted",
]);

/**
 * A refusal of document generation in the user's language (QA 2026-10-11
 * B-19): the cost estimate and AML messages, then the known refusals, else
 * a localized fallback that keeps the server's text for support.
 */
export function formatDocumentGenerationError(
  error: unknown,
  lang: "de" | "ru",
): string {
  const message = error instanceof Error ? error.message : "";
  const code =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
  // Messages the API client already put into the user's language.
  if (ALREADY_LOCALIZED_ERROR_CODES.has(code) && message) return message;
  const costEstimate = formatCostEstimateGenerationError(error, lang);
  if (costEstimate) return costEstimate;
  const aml = formatEnhancedDueDiligenceError(error, lang);
  if (aml !== message) return aml;
  const known = DOCUMENT_GENERATION_ERRORS.find((entry) =>
    entry.match.some((pattern) => pattern === code || (message && message.includes(pattern))),
  );
  if (known) return lang === "de" ? known.de : known.ru;
  const fallback =
    lang === "de" ? "Das Dokument konnte nicht erstellt werden." : "Не удалось создать документ.";
  return message ? `${fallback} (${message})` : fallback;
}

const PATIENT_PARTY_BINDING_FIELDS: BindingFieldDef[] = [
  { key: "party_street", label: "Patient Straße", labelRu: "Улица пациента", kind: "text" },
  { key: "party_zip", label: "Patient PLZ", labelRu: "Индекс пациента", kind: "text" },
  { key: "party_city", label: "Patient Ort", labelRu: "Город пациента", kind: "text" },
  { key: "party_country", label: "Patient Land", labelRu: "Страна пациента", kind: "country" },
  { key: "party_email", label: "Patient E-Mail", labelRu: "E-mail пациента", kind: "text" },
  { key: "party_phone", label: "Patient Telefon", labelRu: "Телефон пациента", kind: "text" },
];

const PARTY_SIGNATURE_BINDING_FIELDS: BindingFieldDef[] = [
  { key: "party_sign_place", label: "Auftraggeber Unterzeichnungsort", labelRu: "Место подписи клиента", kind: "text" },
  { key: "party_sign_date", label: "Auftraggeber Unterzeichnungsdatum", labelRu: "Дата подписи клиента", kind: "date" },
];

const AGENCY_SIGNATURE_BINDING_FIELDS: BindingFieldDef[] = [
  { key: "agency_sign_place", label: "Auftragnehmer Unterzeichnungsort", labelRu: "Место подписи агентства", kind: "text" },
  { key: "agency_sign_date", label: "Auftragnehmer Unterzeichnungsdatum", labelRu: "Дата подписи агентства", kind: "date" },
];

const PAYER_SIGNATURE_BINDING_FIELDS: BindingFieldDef[] = [
  { key: "payer_sign_place", label: "Kostenübernehmer Unterzeichnungsort", labelRu: "Место подписи плательщика", kind: "text" },
  { key: "payer_sign_date", label: "Kostenübernehmer Unterzeichnungsdatum", labelRu: "Дата подписи плательщика", kind: "date" },
];

// Manual "binding socket" fields per generated template id. Field keys match
// the backend `bindings` field names; `*_text` keys are parsed into arrays.
export const DOCUMENT_BINDING_FIELDS: Record<string, BindingFieldDef[]> = {
  enhanced_due_diligence: ENHANCED_DUE_DILIGENCE_BINDING_FIELDS,
  framework_contract: [
    { key: "contract_date", label: "Rahmenvertrag vom / Inkrafttreten", labelRu: "Дата начала действия договора", kind: "date" },
    ...PATIENT_PARTY_BINDING_FIELDS,
    { key: "order_sequence", label: "Laufende Nr. des Einzelauftrags", labelRu: "Порядковый номер отдельного заказа", kind: "number" },
    { key: "cost_threshold", label: "Mehrkosten-Freigabegrenze", labelRu: "Граница согласования превышения бюджета", kind: "text" },
    ...PARTY_SIGNATURE_BINDING_FIELDS,
    ...AGENCY_SIGNATURE_BINDING_FIELDS,
  ],
  single_order: [
    { key: "order_sequence", label: "Laufende Nr. des Einzelauftrags", labelRu: "Порядковый номер отдельного заказа", kind: "number" },
    { key: "order_number", label: "Auftragsnummer", labelRu: "Номер заказа", kind: "text" },
    { key: "order_date", label: "Einzelauftrag vom", labelRu: "Дата отдельного заказа", kind: "date" },
    { key: "contract_date", label: "Rahmenvertrag vom", labelRu: "Дата рамочного договора", kind: "date" },
    ...PATIENT_PARTY_BINDING_FIELDS,
    { key: "specialties", label: "Fachbereiche", labelRu: "Специализации", kind: "text" },
    { key: "examination_purpose", label: "Untersuchungszweck", labelRu: "Цель обследования", kind: "text" },
    { key: "treatment_purpose", label: "Behandlungszweck", labelRu: "Цель лечения", kind: "text" },
    { key: "period_from", label: "Zeitraum von", labelRu: "Период с", kind: "date" },
    { key: "period_to", label: "Zeitraum bis", labelRu: "Период до", kind: "date" },
    { key: "payer_salutation", label: "Kostenübernehmer Anrede", labelRu: "Обращение к плательщику", kind: "text" },
    { key: "payer_name", label: "Kostenübernehmer (Name)", labelRu: "Имя плательщика", kind: "text" },
    { key: "payer_birth_date", label: "Kostenübernehmer (geb. am)", labelRu: "Дата рождения плательщика", kind: "date" },
    {
      key: "order_components",
      label: "Bestandteile / Rangfolge",
      labelRu: "Состав и порядок документов",
      kind: "textarea",
    },
    { key: "quote_number", label: "Kostenvoranschlag-Nr.", labelRu: "Номер сметы", kind: "text" },
    {
      key: "service_lines_text",
      label: "Leistungen (Beschreibung | Honorar | Menge | Summe | Anmerkung)",
      labelRu: "Услуги заказа",
      kind: "textarea",
    },
    { key: "bank_holder", label: "Kontoinhaber", labelRu: "Владелец счёта", kind: "text" },
    { key: "bank_name", label: "Bank", labelRu: "Банк", kind: "text" },
    { key: "bank_swift", label: "SWIFT/BIC", kind: "text" },
    { key: "bank_iban", label: "IBAN", kind: "text" },
    ...PARTY_SIGNATURE_BINDING_FIELDS,
    ...AGENCY_SIGNATURE_BINDING_FIELDS,
  ],
  order_cost_estimate: [
    { key: "order_sequence", label: "Laufende Nr. des Einzelauftrags", labelRu: "Порядковый номер отдельного заказа", kind: "number" },
    { key: "order_number", label: "Auftragsnummer", labelRu: "Номер заказа", kind: "text" },
    { key: "order_date", label: "Einzelauftrag vom", labelRu: "Дата отдельного заказа", kind: "date" },
    { key: "contract_date", label: "Rahmenvertrag vom", labelRu: "Дата рамочного договора", kind: "date" },
    { key: "quote_number", label: "Kostenvoranschlag-Nr.", labelRu: "Номер сметы", kind: "text" },
    ...PATIENT_PARTY_BINDING_FIELDS,
    {
      key: "service_lines_text",
      label: "Leistungen (Beschreibung | Einzelpreis | Menge | Summe | Anmerkung)",
      labelRu: "Услуги сметы",
      kind: "textarea",
    },
    { key: "bank_holder", label: "Kontoinhaber", labelRu: "Владелец счёта", kind: "text" },
    { key: "bank_name", label: "Bank", labelRu: "Банк", kind: "text" },
    { key: "bank_swift", label: "SWIFT/BIC", kind: "text" },
    { key: "bank_iban", label: "IBAN", kind: "text" },
    ...PARTY_SIGNATURE_BINDING_FIELDS,
    ...AGENCY_SIGNATURE_BINDING_FIELDS,
  ],
  cost_coverage_declaration: [
    { key: "order_sequence", label: "Laufende Nr. des Einzelauftrags", labelRu: "Порядковый номер отдельного заказа", kind: "number" },
    { key: "order_date", label: "Einzelauftrag vom", labelRu: "Дата отдельного заказа", kind: "date" },
    { key: "contract_date", label: "Rahmenvertrag vom", labelRu: "Дата рамочного договора", kind: "date" },
    { key: "quote_number", label: "Kostenvoranschlag-Nr.", labelRu: "Номер сметы", kind: "text" },
    { key: "payer_salutation", label: "Kostenübernehmer Anrede", labelRu: "Обращение к плательщику", kind: "text" },
    { key: "payer_name", label: "Kostenübernehmer (Name)", labelRu: "Имя плательщика", kind: "text" },
    { key: "payer_birth_date", label: "Kostenübernehmer (geb. am)", labelRu: "Дата рождения плательщика", kind: "date" },
    { key: "payer_street", label: "Kostenübernehmer Straße", labelRu: "Улица плательщика", kind: "text" },
    { key: "payer_zip", label: "Kostenübernehmer PLZ", labelRu: "Индекс плательщика", kind: "text" },
    { key: "payer_city", label: "Kostenübernehmer Ort", labelRu: "Город плательщика", kind: "text" },
    { key: "payer_country", label: "Kostenübernehmer Land", labelRu: "Страна плательщика", kind: "country" },
    { key: "payer_email", label: "Kostenübernehmer E-Mail", labelRu: "E-mail плательщика", kind: "text" },
    { key: "bank_holder", label: "Kontoinhaber", labelRu: "Владелец счёта", kind: "text" },
    { key: "bank_name", label: "Bank", labelRu: "Банк", kind: "text" },
    { key: "bank_swift", label: "SWIFT/BIC", kind: "text" },
    { key: "bank_iban", label: "IBAN", kind: "text" },
    {
      key: "service_lines_text",
      label: "Leistungen (eine pro Zeile: Beschreibung | Honorar | Menge | Summe)",
      labelRu: "Услуги (по одной в строке: описание | гонорар | количество | сумма)",
      kind: "textarea",
    },
    ...PAYER_SIGNATURE_BINDING_FIELDS,
    ...AGENCY_SIGNATURE_BINDING_FIELDS,
  ],
  cost_estimate: [
    { key: "order_date", label: "Datum", labelRu: "Дата расчёта", kind: "date" },
    {
      key: "service_lines_text",
      label: "Medizinische Leistungen (eine pro Zeile: Beschreibung | Preis/Spanne)",
      labelRu: "Медицинские услуги и ориентировочные диапазоны стоимости",
      kind: "textarea",
    },
    { key: "estimate_total", label: "Gesamt (Spanne)", labelRu: "Ориентировочный итог / диапазон", kind: "text" },
  ],
  appointment_confirmation: [
    { key: "passport_number", label: "Reisepass-Nr.", labelRu: "Номер паспорта", kind: "text" },
    { key: "passport_valid_until", label: "Reisepass gültig bis", labelRu: "Паспорт действителен до", kind: "date" },
    { key: "period_from", label: "Erste Untersuchung am", labelRu: "Первое обследование", kind: "date" },
    { key: "examination_weeks", label: "Weitere Kalenderwochen", labelRu: "Следующие календарные недели", kind: "text" },
    {
      key: "clinics_text",
      label: "Kliniken (eine pro Zeile: Name | Adresse)",
      labelRu: "Клиники (по одной в строке: название | адрес)",
      kind: "textarea",
    },
    { key: "recipient_block", label: "Empfänger (Adressblock)", labelRu: "Получатель (блок адреса)", kind: "textarea" },
    { key: "contact_phones", label: "Rückfragen-Telefon(e)", labelRu: "Телефон(ы) для вопросов", kind: "text" },
    {
      key: "continuation_statement",
      label: "Hinweis zur Fortsetzung der Behandlung",
      labelRu: "Примечание о продолжении лечения",
      kind: "textarea",
    },
    { key: "sign_place", label: "Ort", labelRu: "Место", kind: "text" },
    { key: "sign_date", label: "Datum", labelRu: "Дата", kind: "date" },
  ],
  visa_invitation_letter: [
    { key: "passport_number", label: "Reisepass-Nr.", labelRu: "Номер паспорта", kind: "text" },
    { key: "passport_valid_until", label: "Reisepass gültig bis", labelRu: "Паспорт действителен до", kind: "date" },
    {
      key: "clinics_text",
      label: "Kliniken (eine pro Zeile: Name | Adresse)",
      labelRu: "Клиники (по одной в строке: название | адрес)",
      kind: "textarea",
    },
    { key: "recipient_block", label: "Empfänger (Adressblock)", labelRu: "Получатель (блок адреса)", kind: "textarea" },
    { key: "contact_phones", label: "Rückfragen-Telefon(e)", labelRu: "Телефон(ы) для вопросов", kind: "text" },
    { key: "sign_place", label: "Ort", labelRu: "Место", kind: "text" },
    { key: "sign_date", label: "Datum", labelRu: "Дата", kind: "date" },
  ],
  patient_sticker_compact: PATIENT_STICKER_BINDING_FIELDS,
  patient_sticker_standard: PATIENT_STICKER_BINDING_FIELDS,
  patient_sticker_sheet: PATIENT_STICKER_BINDING_FIELDS,
  confidentiality_release: [
    {
      key: "party_sign_place",
      label: "Unterzeichnungsort",
      labelRu: "Место подписания",
      kind: "text",
    },
    {
      key: "party_sign_date",
      label: "Unterzeichnungsdatum",
      labelRu: "Дата подписания",
      kind: "date",
    },
  ],
  // The consent options (core consents, channels) are no staff bindings: the form ticks only
  // what the person chose in the cabinet, else it prints empty boxes (2026-10-11/12).
  privacy_consents: [
    {
      key: "extra_release_recipients",
      label: "Zusätzliche Empfänger der Daten",
      labelRu: "Дополнительные получатели данных",
      kind: "textarea",
    },
    {
      key: "party_sign_place",
      label: "Unterzeichnungsort",
      labelRu: "Место подписания",
      kind: "text",
    },
    {
      key: "party_sign_date",
      label: "Unterzeichnungsdatum",
      labelRu: "Дата подписания",
      kind: "date",
    },
  ],
  consent_data_release_child: [
    { key: "child_name", label: "Kind (Name)", labelRu: "Ребёнок (имя)", kind: "text" },
    { key: "child_birth_date", label: "Kind (geb. am)", labelRu: "Дата рождения ребёнка", kind: "date" },
    { key: "child_address", label: "Adresse des Kindes", labelRu: "Адрес ребёнка", kind: "text" },
    { key: "guardian_name", label: "Sorgeberechtigte/r 1 (Name)", labelRu: "Законный представитель 1 (имя)", kind: "text" },
    { key: "guardian_birth_date", label: "Sorgeberechtigte/r 1 (geb. am)", labelRu: "Дата рождения представителя 1", kind: "date" },
    { key: "guardian_label", label: "Rolle Sorgeberechtigte/r 1", labelRu: "Роль представителя 1", kind: "text" },
    { key: "guardian2_name", label: "Sorgeberechtigte/r 2 (Name)", labelRu: "Законный представитель 2 (имя)", kind: "text" },
    { key: "guardian2_birth_date", label: "Sorgeberechtigte/r 2 (geb. am)", labelRu: "Дата рождения представителя 2", kind: "date" },
    { key: "guardian2_label", label: "Rolle Sorgeberechtigte/r 2", labelRu: "Роль представителя 2", kind: "text" },
    {
      key: "extra_release_recipients",
      label: "Zusätzliche Entbindung gegenüber",
      labelRu: "Дополнительно освободить от тайны перед",
      kind: "textarea",
    },
  ],
  consent_data_release_single: [
    { key: "child_name", label: "Kind (Name)", labelRu: "Ребёнок (имя)", kind: "text" },
    { key: "child_birth_date", label: "Kind (geb. am)", labelRu: "Дата рождения ребёнка", kind: "date" },
    { key: "child_address", label: "Adresse des Kindes", labelRu: "Адрес ребёнка", kind: "text" },
    { key: "guardian_name", label: "Sorgeberechtigte/r (Name)", labelRu: "Законный представитель (имя)", kind: "text" },
    { key: "guardian_birth_date", label: "Sorgeberechtigte/r (geb. am)", labelRu: "Дата рождения представителя", kind: "date" },
    { key: "guardian_address", label: "Adresse der/des Sorgeberechtigten", labelRu: "Адрес представителя", kind: "text" },
    {
      key: "extra_release_recipients",
      label: "Zusätzliche Entbindung gegenüber",
      labelRu: "Дополнительно освободить от тайны перед",
      kind: "textarea",
    },
  ],
};

export type BindingServiceLine = {
  description: string;
  fee?: string;
  quantity?: string;
  line_total?: string;
  vat_rate?: string;
  is_cost_passthrough?: boolean;
  note?: string;
  description_items?: ServiceDescriptionItem[];
};

export function parseBindingServiceLines(text: string, templateId: string): BindingServiceLine[] {
  if (text.trim().startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.filter((line): line is BindingServiceLine =>
        !!line && typeof line === "object" && typeof line.description === "string");
    } catch { /* Older bindings use one pipe-separated service per line. */ }
  }
  const isCostEstimate = templateId === "cost_estimate";
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [description, fee, quantity, lineTotal, note] = line
        .split("|")
        .map((part) => part.trim());
      return {
        description: description ?? "",
        fee: isCostEstimate ? undefined : fee || undefined,
        quantity: quantity || undefined,
        line_total: (isCostEstimate ? fee : lineTotal) || undefined,
        note: note || undefined,
      };
    })
    .filter((item) => item.description);
}

function parseBindingClinics(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, address] = line.split("|").map((part) => part.trim());
      return { name: name ?? "", address: address || undefined };
    })
    .filter((item) => item.name);
}

export function buildBindingsPayload(
  templateId: string,
  bindings: DocumentBindingForm,
): Record<string, unknown> | null {
  if (templateId === "enhanced_due_diligence") {
    return enhancedDueDiligencePayload(bindings);
  }
  const out: Record<string, unknown> = {};
  const fieldDefs = DOCUMENT_BINDING_FIELDS[templateId] ?? [];
  const fieldDefsByKey = new Map(fieldDefs.map((field) => [field.key, field]));
  const fieldKeys = new Set(fieldDefs.map((field) => field.key));
  for (const [key, value] of Object.entries(bindings)) {
    if (
      !fieldKeys.has(key) ||
      key === "service_lines_text" ||
      key === "clinics_text"
    ) {
      continue;
    }
    const field = fieldDefsByKey.get(key);
    if (field?.kind === "boolean") {
      out[key] = value === "true";
      continue;
    }
    const trimmed = (value ?? "").trim();
    if (!trimmed) continue;
    if (field?.kind === "number") {
      const parsed = Number(trimmed);
      if (Number.isInteger(parsed) && parsed >= 1) out[key] = parsed;
      continue;
    }
    if (field?.kind === "country") {
      out[key] = countryNameForGermanDocument(trimmed);
      continue;
    }
    out[key] = trimmed;
  }
  for (const field of fieldDefs) {
    if (field.kind === "boolean" && !(field.key in out)) {
      out[field.key] = bindings[field.key] === "true";
    }
  }
  if (fieldKeys.has("service_lines_text")) {
    const serviceLines = parseBindingServiceLines(
      bindings.service_lines_text ?? "",
      templateId,
    );
    const populatedLines = serviceLines.filter((line) => line.description.trim()).map((line) => ({
      ...line,
      ...(line.description_items ? {
        description_items: line.description_items.map((item) => ({ ...item, text: item.text.trim() })).filter((item) => item.text),
      } : {}),
    }));
    if (populatedLines.length) out.service_lines = populatedLines;
  }
  if (fieldKeys.has("clinics_text")) {
    const clinics = parseBindingClinics(bindings.clinics_text ?? "");
    if (clinics.length) out.clinics = clinics;
  }
  return Object.keys(out).length ? out : null;
}

function cleanSocketValue(value: string | undefined) {
  const trimmed = (value ?? "").trim().replace(/[.,;:]+$/, "").trim();
  if (!trimmed || /^_+$/.test(trimmed)) return "";
  return trimmed;
}

function germanDateToInputDate(value: string | undefined) {
  const trimmed = cleanSocketValue(value);
  const match = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

const PASSPORT_PREFILL_TEMPLATE_IDS = new Set([
  "appointment_confirmation",
  "visa_invitation_letter",
]);

function prefillPassportBindingsFromText(text: string): DocumentBindingForm {
  const normalized = text.replace(/\s+/g, " ").trim();
  const passportMatch = normalized.match(
    /Reisepass\s+Nr\.?:\s*([^,]+?)(?:,\s*g(?:ü|u)ltig\s+bis\s+([^,]+))?(?=,|\s|$)/i,
  );
  if (!passportMatch) return {};

  const bindings: DocumentBindingForm = {};
  const passportNumber = cleanSocketValue(passportMatch[1]);
  const passportValidUntil = germanDateToInputDate(passportMatch[2]);
  if (passportNumber) bindings.passport_number = passportNumber;
  if (passportValidUntil) bindings.passport_valid_until = passportValidUntil;
  return bindings;
}

export function prefillDocumentBindingsFromText(
  templateId: string,
  text: string | null | undefined,
): DocumentBindingForm {
  if (!text?.trim()) return {};
  if (PASSPORT_PREFILL_TEMPLATE_IDS.has(templateId)) {
    return prefillPassportBindingsFromText(text);
  }
  return {};
}

function pipeRow(values: unknown[]) {
  const parts = values.map((value) =>
    typeof value === "string" || typeof value === "number" ? String(value).trim() : "",
  );
  while (parts.at(-1) === "") parts.pop();
  return parts.join(" | ");
}

function persistedStructuredBindings(value: Record<string, unknown>) {
  const bindings: DocumentBindingForm = {};
  if (Array.isArray(value.service_lines)) {
    const needsStructuredEncoding = value.service_lines.some((line) =>
      line && typeof line === "object" && (
        "description_items" in line || "vat_rate" in line || "is_cost_passthrough" in line ||
        Object.values(line).some((field) => typeof field === "string" && /[\n\r|]/u.test(field))
      ));
    const rows = value.service_lines
      .map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
        const line = entry as Record<string, unknown>;
        return pipeRow([
          line.description,
          line.fee,
          line.quantity,
          line.line_total,
          line.note,
        ]);
      })
      .filter(Boolean);
    if (rows.length) bindings.service_lines_text = needsStructuredEncoding
      ? JSON.stringify(value.service_lines)
      : rows.join("\n");
  }
  if (Array.isArray(value.clinics)) {
    const rows = value.clinics
      .map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
        const clinic = entry as Record<string, unknown>;
        return pipeRow([clinic.name, clinic.address]);
      })
      .filter(Boolean);
    if (rows.length) bindings.clinics_text = rows.join("\n");
  }
  return bindings;
}

function legacySignatureBindings(templateId: string, value: Record<string, unknown>) {
  const place = typeof value.sign_place === "string" ? value.sign_place.trim() : "";
  const date = typeof value.sign_date === "string" ? value.sign_date.trim() : "";
  if (!place && !date) return {};
  if (templateId === "cost_coverage_declaration") {
    return {
      ...(place ? { payer_sign_place: place } : {}),
      ...(date ? { payer_sign_date: date } : {}),
    };
  }
  if (
    templateId === "framework_contract" ||
    templateId === "single_order" ||
    templateId === "order_cost_estimate"
  ) {
    return {
      ...(place ? { party_sign_place: place } : {}),
      ...(date ? { party_sign_date: date } : {}),
    };
  }
  return {};
}

export function hydrateDocumentBindings(
  templateId: string,
  persisted: Record<string, unknown> | null | undefined,
  extractedText: string | null | undefined,
): DocumentBindingForm {
  const extracted = prefillDocumentBindingsFromText(templateId, extractedText);
  if (!persisted) return extracted;

  if (templateId === "enhanced_due_diligence") {
    const nested = persisted.aml_enhanced_due_diligence;
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
      return extracted;
    }
    const source = nested as Record<string, unknown>;
    const hydrated: DocumentBindingForm = { ...extracted };
    for (const field of ENHANCED_DUE_DILIGENCE_BINDING_FIELDS) {
      const value = source[field.key];
      if (field.key === "triggeredCountries") {
        if (Array.isArray(value)) {
          hydrated[field.key] = value
            .filter((country): country is string => typeof country === "string")
            .join(",");
        }
        continue;
      }
      if (field.kind === "boolean" && typeof value === "boolean") {
        hydrated[field.key] = String(value);
        continue;
      }
      if (typeof value === "string" || typeof value === "number") {
        hydrated[field.key] = String(value).trim();
      }
    }
    const evidence = serializeAssetOriginEvidence(
      parseAssetOriginEvidence(source[ASSET_ORIGIN_EVIDENCE_BINDING_KEY]),
    );
    if (evidence) hydrated[ASSET_ORIGIN_EVIDENCE_BINDING_KEY] = evidence;
    return hydrated;
  }

  const allowed = new Set((DOCUMENT_BINDING_FIELDS[templateId] ?? []).map((field) => field.key));
  const hydrated: DocumentBindingForm = { ...extracted };
  for (const [key, value] of Object.entries(persisted)) {
    if (!allowed.has(key) || key === "service_lines_text" || key === "clinics_text") continue;
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      continue;
    }
    const normalized = String(value).trim();
    if (normalized || typeof value === "boolean") hydrated[key] = normalized;
  }
  for (const [key, value] of Object.entries(legacySignatureBindings(templateId, persisted))) {
    if (!hydrated[key]) hydrated[key] = value;
  }
  Object.assign(hydrated, persistedStructuredBindings(persisted));
  return hydrated;
}
