export type BindingFieldKind = "text" | "date" | "number" | "textarea";
export type BindingFieldDef = {
  key: string;
  label: string;
  kind: BindingFieldKind;
};

export type DocumentBindingForm = Record<string, string>;

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
    { key: "sign_place", label: "Unterzeichnungsort", kind: "text" },
    { key: "sign_date", label: "Unterzeichnungsdatum", kind: "date" },
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
    { key: "sign_place", label: "Unterzeichnungsort", kind: "text" },
    { key: "sign_date", label: "Unterzeichnungsdatum", kind: "date" },
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
    { key: "sign_place", label: "Unterzeichnungsort", kind: "text" },
    { key: "sign_date", label: "Unterzeichnungsdatum", kind: "date" },
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
  consent_data_release_child: [
    { key: "child_name", label: "Kind (Name)", kind: "text" },
    { key: "child_birth_date", label: "Kind (geb. am)", kind: "date" },
    { key: "child_address", label: "Adresse des Kindes", kind: "text" },
    { key: "guardian_name", label: "Mutter (Name)", kind: "text" },
    { key: "guardian_birth_date", label: "Mutter (geb. am)", kind: "date" },
    { key: "guardian2_name", label: "Vater (Name)", kind: "text" },
    { key: "guardian2_birth_date", label: "Vater (geb. am)", kind: "date" },
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
    const trimmed = (value ?? "").trim();
    if (!trimmed) continue;
    const field = fieldDefsByKey.get(key);
    if (field?.kind === "number") {
      const parsed = Number(trimmed);
      if (Number.isInteger(parsed)) out[key] = parsed;
      continue;
    }
    out[key] = trimmed;
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

function prefillAppointmentConfirmationBindingsFromText(
  text: string,
): DocumentBindingForm {
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
  if (templateId === "appointment_confirmation") {
    return prefillAppointmentConfirmationBindingsFromText(text);
  }
  return {};
}
