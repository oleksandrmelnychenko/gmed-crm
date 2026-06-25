import type {
  AppointmentOption,
  DocumentAccessCategory,
  DocumentItem,
  DocumentStatus,
  DocumentTemplate,
  DocumentVisibility,
  EditFormState,
  FiltersState,
  GenerateFormState,
  PatientOption,
  TemplateTextBlock,
  UploadFormState,
} from "./types";
import { formatUnknownValue, type Lang, type Translations } from "@/lib/i18n";
import {
  DOCUMENT_BINDING_FIELDS,
  buildBindingsPayload,
} from "./document-bindings";
import { localizeTextBlock } from "./text-block-labels";

export const STATUS_OPTIONS: DocumentStatus[] = ["draft", "active", "archived"];
export const VISIBILITY_OPTIONS: DocumentVisibility[] = [
  "internal",
  "released_internal",
  "released_external",
  "patient_visible",
];

export function canManageDocuments(role?: string) {
  return role === "ceo" || role === "patient_manager" || role === "it_admin";
}

export function canUploadDocuments(role?: string) {
  return [
    "ceo",
    "patient_manager",
    "teamlead_interpreter",
    "interpreter",
    "it_admin",
  ].includes(role ?? "");
}

export function canManageDocumentIntake(role?: string) {
  return ["ceo", "patient_manager", "teamlead_interpreter", "it_admin"].includes(
    role ?? "",
  );
}

export function canViewDocuments(role?: string) {
  return [
    "ceo",
    "ceo_assistant",
    "patient_manager",
    "teamlead_interpreter",
    "interpreter",
    "concierge",
    "billing",
    "it_admin",
  ].includes(role ?? "");
}

export function canRequestTranslations(role?: string) {
  return [
    "ceo",
    "patient_manager",
    "teamlead_interpreter",
    "interpreter",
    "concierge",
    "it_admin",
  ].includes(role ?? "");
}

export function canUpdateTranslations(role?: string) {
  return [
    "ceo",
    "patient_manager",
    "teamlead_interpreter",
    "concierge",
    "it_admin",
  ].includes(role ?? "");
}

export function canViewDocumentShares(role?: string) {
  return ["ceo", "ceo_assistant", "patient_manager", "it_admin"].includes(role ?? "");
}

export function buildDocumentsPath(filters: FiltersState) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.patientId) params.set("patient_id", filters.patientId);
  if (filters.orderId) params.set("order_id", filters.orderId);
  if (filters.appointmentId) params.set("appointment_id", filters.appointmentId);
  if (filters.status) params.set("status", filters.status);
  if (filters.visibility) params.set("visibility", filters.visibility);
  if (filters.art.trim()) params.set("art", filters.art.trim());
  if (filters.category) params.set("category", filters.category);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  if (filters.klinik.trim()) params.set("klinik", filters.klinik.trim());
  if (filters.ursprung.trim()) params.set("ursprung", filters.ursprung.trim());
  if (filters.documentDirection)
    params.set("document_direction", filters.documentDirection);
  if (filters.documentVariant) params.set("document_variant", filters.documentVariant);
  if (filters.accessCategory) params.set("access_category", filters.accessCategory);
  if (filters.financialStatus) params.set("financial_status", filters.financialStatus);
  return params.size ? `/documents?${params.toString()}` : "/documents";
}

export function patientOptionLabel(patient: PatientOption) {
  return `${patient.patient_id} · ${[patient.first_name, patient.last_name].filter(Boolean).join(" ")}`;
}

export function patientDocumentAddresseeLabel(
  patientId: string,
  patients: PatientOption[],
) {
  const patient = patients.find((item) => item.id === patientId);
  if (!patient) return "";
  const patientName = [patient.first_name, patient.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return patientName || patient.patient_id || "";
}

export type StandardDocumentNameInput = {
  category?: string | null;
  art?: string | null;
  isMedical?: boolean | null;
  documentDate?: string | Date | null;
  source?: string | null;
  addressee?: string | null;
};

export type StandardDocumentNameMetadataInput = Omit<
  StandardDocumentNameInput,
  "documentDate" | "source" | "addressee"
> & {
  documentDate?: string | Date | null;
  fallbackDocumentDate?: string | Date | null;
  sourcePerson?: string | null;
  sourceInstitution?: string | null;
  legacySource?: string | null;
  legacySourceInstitution?: string | null;
  addresseePerson?: string | null;
  addresseeInstitution?: string | null;
  patientAddressee?: string | null;
};

const DOCUMENT_ART_LABELS: Record<string, string> = {
  appointment_confirmation: "Terminbestätigung",
  consent_data_release: "Einverständniserklärung",
  consent_data_release_child: "Einverständniserklärung (Kind)",
  consent_data_release_single: "Einverständniserklärung (alleiniges Sorgerecht)",
  cost_coverage_declaration: "Kostenübernahmeerklärung",
  cost_estimate: "Kostenschätzung",
  framework_contract: "Rahmendienstleistungsvertrag",
  medication_summary: "Medikamentenübersicht",
  patient_sticker: "Patientenetikett",
  single_order: "Einzelauftrag",
  treatment_plan: "Behandlungsplan",
  visa_invitation: "Einladungsschreiben (Visum)",
  visa_invitation_letter: "Einladungsschreiben (Visum)",
};

function normalizeDocumentLookup(value?: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function compactDocumentParty(...parts: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(", ");
}

function cleanDocumentNamePart(value?: string | null) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-")
    .trim();
}

function formatDocumentDate(value?: string | Date | null) {
  if (!value) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return [
      String(value.getDate()).padStart(2, "0"),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getFullYear()).padStart(4, "0"),
    ].join(".");
  }
  const trimmed = value.trim();
  if (!trimmed) return "";
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`;
  const localMatch = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (localMatch) {
    const year =
      localMatch[3].length === 2 ? `20${localMatch[3]}` : localMatch[3];
    return `${localMatch[1].padStart(2, "0")}.${localMatch[2].padStart(2, "0")}.${year}`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return "";
  return formatDocumentDate(parsed);
}

function medicalDocumentCode(input: StandardDocumentNameInput) {
  const haystack = normalizeDocumentLookup(
    [input.category, input.art, input.source].filter(Boolean).join(" "),
  );
  if (haystack.match(/\b(kardio|cardio|kardiol|cardiol|herz)/)) {
    return "KARDIO";
  }
  if (haystack.match(/\b(gastro|gastroenterolog|magen|darm)\b/)) {
    return "GASTRO";
  }
  if (haystack.match(/\b(uro|urolog)\b/)) return "URO";
  if (haystack.match(/\b(lab|labor|laborergebnis|laboranalyse)\b/)) return "LAB";
  if (haystack.match(/\b(patho|patholog|histo|histolog)\b/)) {
    return "PATHO-HISTO";
  }
  if (haystack.match(/\b(radio|radiolog|sono|sonographie|ct|mrt|rontgen|pet)\b/)) {
    return "RAD";
  }
  return "MED";
}

function standardDocumentCategoryCode(input: StandardDocumentNameInput) {
  const category = normalizeDocumentLookup(input.category);
  const art = normalizeDocumentLookup(input.art);
  if (
    input.isMedical ||
    category.startsWith("medical") ||
    [
      "medical",
      "medical_report",
      "lab_analysis",
      "conclusion",
      "treatment_plan",
      "medication_summary",
    ].includes(category)
  ) {
    return medicalDocumentCode(input);
  }
  if (art.match(/\b(visa|invitation|einladung|behoerde|amt)\b/)) return "AMT";
  if (art.match(/\b(cost|kosten|invoice|rechnung|coverage|uebernahme)\b/)) {
    return "FIN";
  }
  if (art.match(/\b(contract|vertrag|order|auftrag)\b/)) return "VERTRAG";
  if (
    category.startsWith("finance") ||
    ["finance", "financial", "invoice"].includes(category)
  ) {
    return "FIN";
  }
  if (
    category.startsWith("personal") ||
    ["identity", "personal", "personlich"].includes(category)
  ) {
    return "PERS";
  }
  if (["insurance", "versicherung"].includes(category)) return "VERS";
  if (["other", "sonstige"].includes(category)) return "SONST";
  if (category === "administrative_single_order") return "VERTRAG";
  if (
    category.startsWith("administrative") ||
    [
      "administrative",
      "admin",
      "clinic_correspondence",
      "clinic_form",
      "consent",
      "portal_upload",
    ].includes(category)
  ) {
    return "ADMIN";
  }
  if (
    category.startsWith("official") ||
    [
      "official",
      "agency",
      "behoerde",
      "amtlich",
      "vedomstvennye",
      "visa_invitation_letter",
    ].includes(category)
  ) {
    return "AMT";
  }
  if (category === "contract") return "VERTRAG";
  if (category === "translation") return "UEB";
  if (category === "generated") return "GEN";
  const compact = (input.category ?? "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .slice(0, 8)
    .toUpperCase();
  return compact || "DOK";
}

function formatDocumentArt(value?: string | null) {
  const trimmed = cleanDocumentNamePart(value);
  if (!trimmed) return "";
  const normalizedKey = normalizeDocumentLookup(trimmed).replace(/[^a-z0-9]+/g, "_");
  const mapped = DOCUMENT_ART_LABELS[normalizedKey];
  if (mapped) return mapped;
  if (trimmed.includes("_")) {
    return trimmed
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  return trimmed;
}

export function buildStandardDocumentName(input: StandardDocumentNameInput) {
  const categoryCode = standardDocumentCategoryCode(input);
  const date = formatDocumentDate(input.documentDate);
  const documentType = formatDocumentArt(input.art);
  const typeAndDate = cleanDocumentNamePart(
    [documentType, date ? `vom ${date}` : ""].filter(Boolean).join(" "),
  );
  return [
    categoryCode,
    typeAndDate,
    cleanDocumentNamePart(input.source),
    cleanDocumentNamePart(input.addressee),
  ]
    .filter(Boolean)
    .join("-");
}

export function buildStandardDocumentNameFromMetadata(
  input: StandardDocumentNameMetadataInput,
) {
  const source =
    compactDocumentParty(input.sourcePerson, input.sourceInstitution) ||
    compactDocumentParty(input.legacySource, input.legacySourceInstitution);
  const addressee =
    compactDocumentParty(input.addresseePerson, input.addresseeInstitution) ||
    cleanDocumentNamePart(input.patientAddressee);

  return buildStandardDocumentName({
    category: input.category,
    art: input.art,
    isMedical: input.isMedical,
    documentDate: input.documentDate || input.fallbackDocumentDate,
    source,
    addressee,
  });
}

type DraftFormatDate = (value?: string | null) => string;

function fallbackDraftFormatDate(value?: string | null) {
  return formatDocumentDate(value) || value || "";
}

function draftValue(value: string | null | undefined) {
  return (value ?? "").trim();
}

function draftBinding(
  form: GenerateFormState,
  key: string,
  fallback = "____________",
) {
  return draftValue(form.bindings[key]) || fallback;
}

function draftDate(
  value: string | null | undefined,
  formatDisplayDate: DraftFormatDate,
  fallback = "____________",
) {
  const raw = draftValue(value);
  return raw ? formatDisplayDate(raw) : fallback;
}

function draftMultiline(value: string | null | undefined) {
  return draftValue(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function draftPipeRows(value: string | null | undefined) {
  return draftMultiline(value).map((line) =>
    line.split("|").map((part) => part.trim()).filter(Boolean),
  );
}

function joinDraftLines(lines: Array<string | false | null | undefined>) {
  return lines
    .filter((line): line is string => line !== false && line !== null && line !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildKnownGeneratedDocumentDraft(
  input: {
    template: DocumentTemplate;
    form: GenerateFormState;
    patientLabel: string;
    patientAddressee?: string;
    orderNumber?: string | null;
    appointment?: AppointmentOption | null;
  },
  formatDisplayDate: DraftFormatDate,
) {
  const { template, form, patientLabel, patientAddressee, orderNumber, appointment } = input;
  const title = form.titleOverride.trim() || template.label;
  const patient = patientAddressee?.trim() || patientLabel || "____________";
  const signPlace = draftBinding(form, "sign_place", "München");
  const signDate = draftDate(form.bindings.sign_date || form.documentDate, formatDisplayDate);
  const recipient =
    draftMultiline(form.bindings.recipient_block).join("\n") ||
    "An die Bundespolizei / Grenzschutz";
  const clinics = draftPipeRows(form.bindings.clinics_text);
  const clinicText = clinics.length
    ? clinics.map(([name, address]) => [name, address].filter(Boolean).join(", ")).join("; ")
    : "den vereinbarten Kliniken";
  const contactPhones = draftValue(form.bindings.contact_phones);
  const passportNumber = draftValue(form.bindings.passport_number);
  const passportValidUntil = draftValue(form.bindings.passport_valid_until);
  const orderDate = draftDate(form.bindings.order_date || form.documentDate, formatDisplayDate);
  const contractDate = draftDate(form.bindings.contract_date, formatDisplayDate);
  const payerName = draftBinding(form, "payer_name", "____________");
  const serviceRows = draftPipeRows(form.bindings.service_lines_text);

  switch (template.id) {
    case "appointment_confirmation": {
      const firstExamination = draftDate(form.bindings.period_from, formatDisplayDate, "in Kürze");
      const passportLine = passportNumber
        ? `Reisepass-Nr.: ${passportNumber}${
            passportValidUntil
              ? `, gültig bis ${draftDate(passportValidUntil, formatDisplayDate)}`
              : ""
          }`
        : "";
      return joinDraftLines([
        `Datum: ${signDate}`,
        "Seiten: 1",
        "Doc.-ID: automatisch",
        "Ersteller: GMED",
        `Für: ${patient}`,
        "Project: TB-V2",
        "",
        recipient,
        "",
        `${signPlace}, ${signDate}`,
        "",
        `Terminbestätigung für ${patient}`,
        passportLine,
        "",
        "Sehr geehrte Damen und Herren,",
        `hiermit bestätigen wir, dass ${patient} sämtliche Termine für Diagnostik und Behandlung in ${clinicText} wahrnehmen wird.`,
        `Die ersten Untersuchungen finden am ${firstExamination} statt.`,
        "Die Behandlung wurde in Deutschland begonnen und soll nun fortgesetzt werden. Dolmetscher und Transfer sind organisiert.",
        "Die Kostenfrage wurde mit dem Patienten geklärt. Es fallen keine Kosten für die Bundesrepublik Deutschland an.",
        contactPhones
          ? `Für Rückfragen stehen wir Ihnen gerne unter ${contactPhones} zur Verfügung.`
          : "Für Rückfragen stehen wir Ihnen gerne zur Verfügung.",
        "",
        "Mit freundlichen Grüßen,",
        "",
        "c/o GMED",
        "Geschäftsführer",
      ]);
    }
    case "visa_invitation_letter": {
      const appointmentText = appointment
        ? `Geplanter Termin: ${formatDisplayDate(appointment.date)}${
            appointment.time_start ? ` um ${appointment.time_start}` : ""
          }${appointment.title ? `, ${appointment.title}` : ""}.`
        : "";
      const passportClause = passportNumber
        ? `, Reisepass-Nr. ${passportNumber}${
            passportValidUntil
              ? `, gültig bis ${draftDate(passportValidUntil, formatDisplayDate)}`
              : ""
          }`
        : "";
      return joinDraftLines([
        title,
        "",
        recipient,
        "",
        `${signPlace}, ${signDate}`,
        "",
        `Hiermit bestätigen wir, dass ${patient}${passportClause} zur medizinischen Koordination und Vorstellung eingeladen ist.`,
        appointmentText,
        `Vorgesehene Einrichtung(en): ${clinicText}.`,
        orderNumber ? `Interne Koordinationsnummer: ${orderNumber}.` : "",
        "Dieses Schreiben dient zur Vorlage bei Botschaft oder Konsulat im Rahmen des Visumantrags.",
        contactPhones
          ? `Für Rückfragen stehen wir Ihnen gerne unter ${contactPhones} zur Verfügung.`
          : "Für Rückfragen stehen wir Ihnen gerne zur Verfügung.",
      ]);
    }
    case "single_order": {
      const specialties = draftBinding(form, "specialties", "den vereinbarten Fachbereichen");
      const purpose =
        draftValue(form.bindings.examination_purpose) ||
        "ausführliche medizinische Untersuchung";
      return joinDraftLines([
        title,
        orderNumber || draftValue(form.bindings.order_number)
          ? `Auftragsnummer: ${orderNumber || form.bindings.order_number}`
          : "",
        "",
        `Einzelauftrag vom ${orderDate} zum Rahmendienstleistungsvertrag vom ${contractDate}.`,
        "",
        "zwischen",
        patient,
        "und",
        "GMED",
        "",
        "§ 1 Leistungsumfang",
        `Individuelle Beratung und Informationsvermittlung für ${specialties} mit dem Zweck, sich einer ${purpose} zu unterziehen.`,
        "Administrative Unterstützung bei der Zusammenstellung und Übermittlung medizinischer Unterlagen.",
        "Koordination von Terminen, Dolmetschern, Transfer und nachgelagerten Prozessen.",
        draftValue(form.bindings.order_components),
      ]);
    }
    case "cost_coverage_declaration": {
      const services = serviceRows.map(([description, fee, quantity, total]) =>
        [description, fee, quantity, total].filter(Boolean).join(" | "),
      );
      return joinDraftLines([
        title,
        "",
        `Kostenübernehmer: ${payerName}`,
        `Auftraggeber: ${patient}`,
        `Einzelauftrag vom: ${orderDate}`,
        `Rahmendienstleistungsvertrag vom: ${contractDate}`,
        "",
        "Der Kostenübernehmer erklärt sich bereit, sämtliche im Zusammenhang mit dem genannten Einzelauftrag entstehenden Kosten gegenüber GMED zu übernehmen.",
        services.length ? "Leistungen:" : "",
        ...services.map((line) => `- ${line}`),
        "",
        `${signPlace}, ${signDate}`,
      ]);
    }
    case "cost_estimate": {
      const services = serviceRows.map(([description, range]) =>
        [description, range].filter(Boolean).join(" | "),
      );
      return joinDraftLines([
        title,
        "",
        `Patient: ${patient}`,
        `Datum: ${orderDate}`,
        services.length ? "Voraussichtliche Leistungen:" : "",
        ...services.map((line) => `- ${line}`),
        draftValue(form.bindings.estimate_total)
          ? `Gesamt: ${form.bindings.estimate_total}`
          : "",
      ]);
    }
    default:
      return null;
  }
}

export type GeneratedDocumentDraftLabels = {
  documentDate: string;
  sourceInstitution: string;
  addresseePerson: string;
  ordersPatient: string;
  ordersTitle: string;
  appointmentsTitle: string;
  sectionBindings: string;
  textBlocks: string;
};

export function buildGeneratedDocumentManualTextDraft(input: {
  template: DocumentTemplate;
  form: GenerateFormState;
  patientLabel?: string;
  patientAddressee?: string;
  orderNumber?: string | null;
  appointment?: AppointmentOption | null;
  availableTemplateBlocks?: TemplateTextBlock[];
  lang: Lang;
  labels: GeneratedDocumentDraftLabels;
  formatDisplayDate?: DraftFormatDate;
}) {
  const formatDisplayDate = input.formatDisplayDate ?? fallbackDraftFormatDate;
  const patientLabel = input.patientLabel ?? "";
  const knownDraft = buildKnownGeneratedDocumentDraft(
    {
      template: input.template,
      form: input.form,
      patientLabel,
      patientAddressee: input.patientAddressee,
      orderNumber: input.orderNumber,
      appointment: input.appointment,
    },
    formatDisplayDate,
  );
  if (knownDraft) return knownDraft;

  const { form, labels, template } = input;
  const lines: string[] = [];
  const title = form.titleOverride.trim() || template.label;
  lines.push(title);
  lines.push("");
  lines.push(`${labels.documentDate}: ${form.documentDate || new Date().toISOString().slice(0, 10)}`);
  if (patientLabel) lines.push(`${labels.ordersPatient}: ${patientLabel}`);
  if (input.orderNumber) lines.push(`${labels.ordersTitle}: ${input.orderNumber}`);
  if (input.appointment) {
    lines.push(
      `${labels.appointmentsTitle}: ${input.appointment.title} · ${formatDisplayDate(input.appointment.date)}${
        input.appointment.time_start ? ` · ${input.appointment.time_start}` : ""
      }`,
    );
  }
  const source = compactDocumentParty(
    form.sourcePerson || form.ursprung,
    form.sourceInstitution || form.klinik,
  );
  if (source) lines.push(`${labels.sourceInstitution}: ${source}`);
  const addressee =
    compactDocumentParty(form.addresseePerson, form.addresseeInstitution) ||
    input.patientAddressee ||
    patientLabel;
  if (addressee) lines.push(`${labels.addresseePerson}: ${addressee}`);

  if (form.introduction.trim()) {
    lines.push("");
    lines.push(form.introduction.trim());
  }

  const bindingFields = DOCUMENT_BINDING_FIELDS[template.id] ?? [];
  const bindingLines = bindingFields
    .map((field) => {
      const value = form.bindings[field.key]?.trim();
      return value ? `${field.label}: ${value}` : "";
    })
    .filter(Boolean);
  if (bindingLines.length > 0) {
    lines.push("");
    lines.push(labels.sectionBindings);
    lines.push(...bindingLines);
  }

  const availableTemplateBlocks = input.availableTemplateBlocks ?? [];
  const selectedBlocks = availableTemplateBlocks.filter((block) =>
    form.textBlockKeys.includes(block.key),
  );
  if (selectedBlocks.length > 0) {
    lines.push("");
    lines.push(labels.textBlocks);
    for (const block of selectedBlocks) {
      const textBlock = localizeTextBlock(block.key, input.lang, block);
      lines.push(textBlock.label);
      if (textBlock.description) lines.push(textBlock.description);
    }
  }

  if (form.closingNote.trim()) {
    lines.push("");
    lines.push(form.closingNote.trim());
  }

  return lines.join("\n").trim();
}

export function buildGenerateDocumentAutoName(input: {
  template: DocumentTemplate;
  form: GenerateFormState;
  patients?: PatientOption[];
  fallbackDate?: string | Date | null;
}) {
  const generatedStandardName = buildStandardDocumentNameFromMetadata({
    category: input.template.category,
    art: input.template.default_auto_name || input.template.art,
    isMedical: input.template.is_medical,
    documentDate: input.form.documentDate,
    fallbackDocumentDate: input.fallbackDate ?? new Date(),
    sourcePerson: input.form.sourcePerson,
    sourceInstitution: input.form.sourceInstitution,
    legacySource: input.form.ursprung,
    legacySourceInstitution:
      input.form.klinik || input.template.provider_name || "GMED",
    addresseePerson: input.form.addresseePerson,
    addresseeInstitution: input.form.addresseeInstitution,
    patientAddressee: patientDocumentAddresseeLabel(
      input.form.patientId,
      input.patients ?? [],
    ),
  });
  const explicitAutoName = input.form.autoName.trim();
  const defaultAutoName = input.template.default_auto_name.trim();
  return !explicitAutoName || explicitAutoName === defaultAutoName
    ? generatedStandardName || explicitAutoName
    : explicitAutoName;
}

export function resolveGeneratedDocumentAccessCategory(
  template: DocumentTemplate,
  fallback: DocumentAccessCategory = "patient",
): DocumentAccessCategory {
  const category = normalizeDocumentLookup(template.category);
  const templateId = normalizeDocumentLookup(template.id);
  if (
    template.is_medical ||
    category.startsWith("medical") ||
    ["treatment_plan", "medication_summary"].includes(templateId) ||
    ["treatment_plan", "medication_summary"].includes(category)
  ) {
    return "medical";
  }
  if (
    category.startsWith("finance") ||
    ["cost_coverage_declaration", "cost_estimate"].includes(templateId)
  ) {
    return "financial";
  }
  if (
    category.startsWith("official") ||
    category === "visa_invitation_letter" ||
    templateId === "visa_invitation_letter"
  ) {
    return "authority";
  }
  if (category.startsWith("personal")) return "patient";
  if (template.default_visibility === "patient_visible") return "patient";
  return fallback;
}

export function buildGenerateDocumentPayload(input: {
  template: DocumentTemplate;
  form: GenerateFormState;
  patients?: PatientOption[];
  displayedManualText?: string;
  fallbackDate?: string | Date | null;
}): Record<string, unknown> {
  const { form, template } = input;
  const manualText = (input.displayedManualText ?? form.manualText).trim();
  return {
    template_id: template.id,
    patient_id: form.patientId || null,
    order_id: form.orderId || null,
    appointment_id: form.appointmentId || null,
    auto_name: buildGenerateDocumentAutoName(input) || null,
    status: form.status,
    visibility: form.visibility,
    language: form.language || null,
    replace_document_id: form.replaceDocumentId || null,
    title_override: form.titleOverride.trim() || null,
    introduction: form.introduction.trim() || null,
    closing_note: form.closingNote.trim() || null,
    klinik: form.klinik.trim() || null,
    ursprung: form.ursprung.trim() || null,
    document_direction: form.documentDirection,
    document_variant: form.documentVariant,
    document_language: form.documentLanguage || form.language || null,
    access_category: resolveGeneratedDocumentAccessCategory(
      template,
      form.accessCategory,
    ),
    document_date: form.documentDate || null,
    source_person: form.sourcePerson.trim() || null,
    source_institution: form.sourceInstitution.trim() || null,
    addressee_person: form.addresseePerson.trim() || null,
    addressee_institution: form.addresseeInstitution.trim() || null,
    financial_status: form.financialStatus || null,
    payment_due_date: form.paymentDueDate || null,
    payment_date: form.paymentDate || null,
    payment_method: form.paymentMethod || null,
    notes: form.notes.trim() || null,
    manual_text: manualText || null,
    text_block_keys: form.textBlockKeys,
    bindings: buildBindingsPayload(template.id, form.bindings),
  };
}

export function formatConfidenceLabel(
  value: string,
  tr: Pick<
    Translations,
    | "common_unknown"
    | "common_unknown_value"
    | "documents_confidence_high"
    | "documents_confidence_medium"
    | "documents_confidence_low"
  >,
): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high") return tr.documents_confidence_high;
  if (normalized === "medium") return tr.documents_confidence_medium;
  if (normalized === "low") return tr.documents_confidence_low;
  return formatUnknownValue(value, tr);
}

export function normalizeTemplateLanguage(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (
    ["de", "de-de", "de_at", "de-at", "de_ch", "de-ch"].includes(normalized)
  ) {
    return "de";
  }
  if (["uk", "uk-ua", "ua", "ukrainian"].includes(normalized)) return "uk";
  if (["en", "en-gb", "en-us", "english"].includes(normalized)) return "en";
  if (["ru", "ru-ru", "russian"].includes(normalized)) return "ru";
  return null;
}

export function resolveTemplateLanguage(
  patientId: string,
  template: DocumentTemplate | null,
  patients: PatientOption[],
) {
  if (!template) return "de";
  const patient = patients.find((item) => item.id === patientId);
  const supportedLanguages = new Set(template.supported_languages);
  for (const language of patient?.languages ?? []) {
    const normalized = normalizeTemplateLanguage(language);
    if (normalized && supportedLanguages.has(normalized)) {
      return normalized;
    }
  }
  return template.supported_languages[0] ?? "de";
}

export function templateForDocument(
  templates: DocumentTemplate[],
  detail: DocumentItem | null,
) {
  if (!detail) return null;
  const generatedTemplateId =
    detail.generated_template_id?.trim() ||
    (detail.ursprung?.startsWith("template:")
      ? detail.ursprung.slice("template:".length).trim()
      : "");
  if (generatedTemplateId) {
    const exactTemplate = templates.find(
      (template) => template.id === generatedTemplateId,
    );
    if (exactTemplate) return exactTemplate;
  }
  return (
    templates.find(
      (template) =>
        (template.template_kind ?? "builtin") === "builtin" &&
        template.art === detail.art && template.category === detail.category,
    ) ?? null
  );
}

export function emptyUploadForm(patientId = ""): UploadFormState {
  return {
    file: null,
    patientId,
    orderId: "",
    appointmentId: "",
    autoName: "",
    art: "",
    category: "",
    status: "active",
    visibility: "internal",
    isMedical: false,
    klinik: "",
    ursprung: "",
    documentDirection: "incoming",
    documentVariant: "original",
    documentLanguage: "",
    accessCategory: "internal",
    documentDate: new Date().toISOString().slice(0, 10),
    sourcePerson: "",
    sourceInstitution: "",
    addresseePerson: "",
    addresseeInstitution: "GMED",
    financialStatus: "",
    paymentDueDate: "",
    paymentDate: "",
    paymentMethod: "",
    notes: "",
  };
}

export function emptyGenerateForm(patientId = ""): GenerateFormState {
  return {
    templateId: "",
    patientId,
    orderId: "",
    appointmentId: "",
    replaceDocumentId: "",
    autoName: "",
    status: "draft",
    visibility: "patient_visible",
    language: "de",
    titleOverride: "",
    introduction: "",
    closingNote: "",
    klinik: "",
    ursprung: "",
    documentDirection: "outgoing",
    documentVariant: "original",
    documentLanguage: "de",
    accessCategory: "patient",
    documentDate: new Date().toISOString().slice(0, 10),
    sourcePerson: "",
    sourceInstitution: "GMED",
    addresseePerson: "",
    addresseeInstitution: "",
    notes: "",
    financialStatus: "",
    paymentDueDate: "",
    paymentDate: "",
    paymentMethod: "",
    textBlockKeys: [],
    manualText: "",
    manualTextDirty: false,
    bindings: {},
  };
}

export function detailToEditForm(detail: DocumentItem): EditFormState {
  return {
    patientId: detail.patient_id ?? "",
    orderId: detail.order_id ?? "",
    appointmentId: detail.appointment_id ?? "",
    autoName: detail.auto_name,
    art: detail.art,
    category: detail.category ?? "",
    status: (detail.status as DocumentStatus) ?? "active",
    visibility: (detail.visibility as DocumentVisibility) ?? "internal",
    isMedical: detail.is_medical,
    klinik: detail.klinik ?? "",
    ursprung: detail.ursprung ?? "",
    documentDirection: detail.document_direction ?? "incoming",
    documentVariant: detail.document_variant ?? "original",
    documentLanguage: detail.document_language ?? "",
    accessCategory:
      detail.access_category ?? (detail.is_medical ? "medical" : "internal"),
    documentDate: detail.document_date ?? "",
    sourcePerson: detail.source_person ?? "",
    sourceInstitution: detail.source_institution ?? "",
    addresseePerson: detail.addressee_person ?? "",
    addresseeInstitution: detail.addressee_institution ?? "",
    financialStatus: detail.financial_status ?? "",
    paymentDueDate: detail.payment_due_date ?? "",
    paymentDate: detail.payment_date ?? "",
    paymentMethod: detail.payment_method ?? "",
    notes: detail.notes ?? "",
  };
}
