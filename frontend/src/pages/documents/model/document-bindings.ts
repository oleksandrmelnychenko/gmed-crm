export type BindingFieldKind =
  | "text"
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

const FIXED_LEGAL_TEMPLATE_IDS = new Set([
  "confidentiality_release",
  "privacy_consents",
]);

export function isFixedLegalDocumentTemplate(templateId: string) {
  return FIXED_LEGAL_TEMPLATE_IDS.has(templateId);
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
  { key: "cost_code", label: "Kostenstelle / Code", kind: "text" },
];

const PATIENT_PARTY_BINDING_FIELDS: BindingFieldDef[] = [
  { key: "party_street", label: "Patient Straße", kind: "text" },
  { key: "party_zip", label: "Patient PLZ", kind: "text" },
  { key: "party_city", label: "Patient Ort", kind: "text" },
  { key: "party_country", label: "Patient Land", kind: "text" },
  { key: "party_email", label: "Patient E-Mail", kind: "text" },
  { key: "party_phone", label: "Patient Telefon", kind: "text" },
];

const PARTY_SIGNATURE_BINDING_FIELDS: BindingFieldDef[] = [
  { key: "party_sign_place", label: "Auftraggeber Unterzeichnungsort", kind: "text" },
  { key: "party_sign_date", label: "Auftraggeber Unterzeichnungsdatum", kind: "date" },
];

const AGENCY_SIGNATURE_BINDING_FIELDS: BindingFieldDef[] = [
  { key: "agency_sign_place", label: "Auftragnehmer Unterzeichnungsort", kind: "text" },
  { key: "agency_sign_date", label: "Auftragnehmer Unterzeichnungsdatum", kind: "date" },
];

const PAYER_SIGNATURE_BINDING_FIELDS: BindingFieldDef[] = [
  { key: "payer_sign_place", label: "Kostenübernehmer Unterzeichnungsort", kind: "text" },
  { key: "payer_sign_date", label: "Kostenübernehmer Unterzeichnungsdatum", kind: "date" },
];

// Manual "binding socket" fields per generated template id. Field keys match
// the backend `bindings` field names; `*_text` keys are parsed into arrays.
export const DOCUMENT_BINDING_FIELDS: Record<string, BindingFieldDef[]> = {
  framework_contract: [
    { key: "contract_date", label: "Rahmenvertrag vom / Inkrafttreten", kind: "date" },
    ...PATIENT_PARTY_BINDING_FIELDS,
    { key: "order_sequence", label: "Laufende Nr. des Einzelauftrags", kind: "number" },
    { key: "cost_threshold", label: "Mehrkosten-Freigabegrenze", kind: "text" },
    {
      key: "extra_release_recipients",
      label: "Zusätzliche Datenempfänger / Entbindung",
      kind: "textarea",
    },
    ...PARTY_SIGNATURE_BINDING_FIELDS,
    ...AGENCY_SIGNATURE_BINDING_FIELDS,
  ],
  single_order: [
    { key: "order_sequence", label: "Laufende Nr. des Einzelauftrags", kind: "number" },
    { key: "order_number", label: "Auftragsnummer", kind: "text" },
    { key: "order_date", label: "Einzelauftrag vom", kind: "date" },
    { key: "contract_date", label: "Rahmenvertrag vom", kind: "date" },
    ...PATIENT_PARTY_BINDING_FIELDS,
    { key: "specialties", label: "Fachbereiche", kind: "text" },
    { key: "examination_purpose", label: "Untersuchungszweck", kind: "text" },
    { key: "treatment_purpose", label: "Behandlungszweck", kind: "text" },
    { key: "period_from", label: "Zeitraum von", kind: "date" },
    { key: "period_to", label: "Zeitraum bis", kind: "date" },
    { key: "payer_salutation", label: "Kostenübernehmer Anrede", kind: "text" },
    { key: "payer_name", label: "Kostenübernehmer (Name)", kind: "text" },
    { key: "payer_birth_date", label: "Kostenübernehmer (geb. am)", kind: "date" },
    {
      key: "order_components",
      label: "Bestandteile / Rangfolge",
      kind: "textarea",
    },
    { key: "quote_number", label: "Kostenvoranschlag-Nr.", kind: "text" },
    {
      key: "service_lines_text",
      label: "Leistungen (Beschreibung | Honorar | Menge | Summe | Anmerkung)",
      kind: "textarea",
    },
    { key: "bank_holder", label: "Kontoinhaber", kind: "text" },
    { key: "bank_name", label: "Bank", kind: "text" },
    { key: "bank_swift", label: "SWIFT/BIC", kind: "text" },
    { key: "bank_iban", label: "IBAN", kind: "text" },
    ...PARTY_SIGNATURE_BINDING_FIELDS,
    ...AGENCY_SIGNATURE_BINDING_FIELDS,
  ],
  cost_coverage_declaration: [
    { key: "order_sequence", label: "Laufende Nr. des Einzelauftrags", kind: "number" },
    { key: "order_date", label: "Einzelauftrag vom", kind: "date" },
    { key: "contract_date", label: "Rahmenvertrag vom", kind: "date" },
    { key: "quote_number", label: "Kostenvoranschlag-Nr.", kind: "text" },
    { key: "payer_salutation", label: "Kostenübernehmer Anrede", kind: "text" },
    { key: "payer_name", label: "Kostenübernehmer (Name)", kind: "text" },
    { key: "payer_birth_date", label: "Kostenübernehmer (geb. am)", kind: "date" },
    { key: "payer_street", label: "Kostenübernehmer Straße", kind: "text" },
    { key: "payer_zip", label: "Kostenübernehmer PLZ", kind: "text" },
    { key: "payer_city", label: "Kostenübernehmer Ort", kind: "text" },
    { key: "payer_country", label: "Kostenübernehmer Land", kind: "text" },
    { key: "payer_email", label: "Kostenübernehmer E-Mail", kind: "text" },
    { key: "bank_holder", label: "Kontoinhaber", kind: "text" },
    { key: "bank_name", label: "Bank", kind: "text" },
    { key: "bank_swift", label: "SWIFT/BIC", kind: "text" },
    { key: "bank_iban", label: "IBAN", kind: "text" },
    {
      key: "service_lines_text",
      label: "Leistungen (eine pro Zeile: Beschreibung | Honorar | Menge | Summe)",
      kind: "textarea",
    },
    ...PAYER_SIGNATURE_BINDING_FIELDS,
    ...AGENCY_SIGNATURE_BINDING_FIELDS,
  ],
  cost_estimate: [
    { key: "order_date", label: "Datum", kind: "date" },
    {
      key: "service_lines_text",
      label: "Leistungen (eine pro Zeile: Beschreibung | Preis/Spanne)",
      kind: "textarea",
    },
    { key: "estimate_total", label: "Gesamt (Spanne)", kind: "text" },
  ],
  appointment_confirmation: [
    { key: "passport_number", label: "Reisepass-Nr.", kind: "text" },
    { key: "passport_valid_until", label: "Reisepass gültig bis", kind: "date" },
    { key: "period_from", label: "Erste Untersuchung am", kind: "date" },
    { key: "examination_weeks", label: "Weitere Kalenderwochen", kind: "text" },
    {
      key: "clinics_text",
      label: "Kliniken (eine pro Zeile: Name | Adresse)",
      kind: "textarea",
    },
    { key: "recipient_block", label: "Empfänger (Adressblock)", kind: "textarea" },
    { key: "contact_phones", label: "Rückfragen-Telefon(e)", kind: "text" },
    {
      key: "continuation_statement",
      label: "Hinweis zur Fortsetzung der Behandlung",
      kind: "textarea",
    },
    { key: "sign_place", label: "Ort", kind: "text" },
    { key: "sign_date", label: "Datum", kind: "date" },
  ],
  visa_invitation_letter: [
    { key: "passport_number", label: "Reisepass-Nr.", kind: "text" },
    { key: "passport_valid_until", label: "Reisepass gültig bis", kind: "date" },
    {
      key: "clinics_text",
      label: "Kliniken (eine pro Zeile: Name | Adresse)",
      kind: "textarea",
    },
    { key: "recipient_block", label: "Empfänger (Adressblock)", kind: "textarea" },
    { key: "contact_phones", label: "Rückfragen-Telefon(e)", kind: "text" },
    { key: "sign_place", label: "Ort", kind: "text" },
    { key: "sign_date", label: "Datum", kind: "date" },
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
  privacy_consents: [
    {
      key: "consent_healthcare",
      label: "Erhebung, Verarbeitung und Übermittlung medizinischer Daten",
      labelRu: "Сбор, обработка и передача медицинских данных",
      kind: "boolean",
    },
    {
      key: "consent_provider_release",
      label: "Übermittlung der Behandlungsunterlagen durch Ärzte und Einrichtungen",
      labelRu: "Получение медицинских данных от врачей и клиник",
      kind: "boolean",
    },
    {
      key: "consent_privacy",
      label: "Speicherung und Verarbeitung im GMED-CRM-System",
      labelRu: "Хранение и обработка данных в GMED-CRM",
      kind: "boolean",
    },
    {
      key: "extra_release_recipients",
      label: "Zusätzliche Empfänger der Daten",
      labelRu: "Дополнительные получатели данных",
      kind: "textarea",
    },
    {
      key: "consent_email",
      label: "E-mail",
      labelRu: "E-mail",
      kind: "boolean",
    },
    {
      key: "consent_threema",
      label: "Threema-Messenger",
      labelRu: "Threema",
      kind: "boolean",
    },
    {
      key: "consent_whatsapp",
      label: "WhatsApp-Messenger",
      labelRu: "WhatsApp",
      kind: "boolean",
    },
    {
      key: "consent_telegram",
      label: "Telegram-Messenger",
      labelRu: "Telegram",
      kind: "boolean",
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
    { key: "child_name", label: "Kind (Name)", kind: "text" },
    { key: "child_birth_date", label: "Kind (geb. am)", kind: "date" },
    { key: "child_address", label: "Adresse des Kindes", kind: "text" },
    { key: "guardian_name", label: "Sorgeberechtigte/r 1 (Name)", kind: "text" },
    { key: "guardian_birth_date", label: "Sorgeberechtigte/r 1 (geb. am)", kind: "date" },
    { key: "guardian_label", label: "Rolle Sorgeberechtigte/r 1", kind: "text" },
    { key: "guardian2_name", label: "Sorgeberechtigte/r 2 (Name)", kind: "text" },
    { key: "guardian2_birth_date", label: "Sorgeberechtigte/r 2 (geb. am)", kind: "date" },
    { key: "guardian2_label", label: "Rolle Sorgeberechtigte/r 2", kind: "text" },
    {
      key: "extra_release_recipients",
      label: "Zusätzliche Entbindung gegenüber",
      kind: "textarea",
    },
  ],
  consent_data_release_single: [
    { key: "child_name", label: "Kind (Name)", kind: "text" },
    { key: "child_birth_date", label: "Kind (geb. am)", kind: "date" },
    { key: "child_address", label: "Adresse des Kindes", kind: "text" },
    { key: "guardian_name", label: "Sorgeberechtigte/r (Name)", kind: "text" },
    { key: "guardian_birth_date", label: "Sorgeberechtigte/r (geb. am)", kind: "date" },
    { key: "guardian_address", label: "Adresse der/des Sorgeberechtigten", kind: "text" },
    {
      key: "extra_release_recipients",
      label: "Zusätzliche Entbindung gegenüber",
      kind: "textarea",
    },
  ],
};

function parseBindingServiceLines(text: string, templateId: string) {
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
    if (serviceLines.length) out.service_lines = serviceLines;
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
    if (rows.length) bindings.service_lines_text = rows.join("\n");
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
  if (templateId === "framework_contract" || templateId === "single_order") {
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
