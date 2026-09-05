import type { PatientOption } from "./types";

export type InvoicePatientMatch =
  | { status: "matched"; patientId: string }
  | { status: "not_found" | "ambiguous"; patientId?: never };

function normalize(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "")
    .replace(/ß/g, "ss").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function containsPhrase(text: string, phrase: string): boolean {
  return phrase.length > 0 && ` ${text} `.includes(` ${phrase} `);
}

// Names must occur in the patient/recipient block, not just anywhere in a
// document (e.g. a doctor or supplier can have the same name as a patient).
const RECIPIENT_LABELS = [
  "patient", "patientin", "patientenname", "patient name", "name des patienten", "name der patientin",
  "rechnungsempfanger", "rechnungsempfangerin", "rechnungsadresse", "kunde", "kundin", "kundenname",
  "customer", "customer name", "client", "bill to", "billed to", "invoice to", "recipient",
  "пациент", "пациентка", "фио пациента", "клиент", "получатель", "плательщик",
  "пацієнт", "пацієнтка", "піб пацієнта", "клієнт", "одержувач", "платник",
  "herr", "herrn", "frau", "mr", "mrs", "ms",
].map(normalize);

export function matchInvoicePatient(text: string, patients: readonly PatientOption[]): InvoicePatientMatch {
  if (!text.trim() || !patients.length) return { status: "not_found" };
  const normalizeId = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\u2010-\u2015\u2212]/g, "-").trim();
  const identifiers = new Set(normalizeId(text).match(/[\p{L}\p{N}_/-]+/gu) ?? []);
  const lines = text.split(/\r?\n/).map(normalize).filter(Boolean);
  const recipientBlocks = lines.flatMap((line, index) =>
    // A named contact below a company addressee is not automatically a patient.
    !/\b(agentur|gmbh|gesellschaft|company|firma)\b/u.test(lines[index - 1] ?? "")
    && RECIPIENT_LABELS.some((label) => line === label || line.startsWith(`${label} `))
      ? [lines.slice(index, index + 3).join(" ")]
      : []);
  const fullName = (patient: PatientOption) => normalize(`${patient.first_name ?? ""} ${patient.last_name ?? ""}`);
  const byName = patients.filter((patient) => {
    if (!patient.first_name?.trim() || !patient.last_name?.trim()) return false;
    const names = [fullName(patient), normalize(`${patient.last_name} ${patient.first_name}`)];
    return recipientBlocks.some((block) => names.some((name) => containsPhrase(block, name)));
  });
  const byId = patients.filter((patient) => {
    const id = normalizeId(patient.patient_id);
    // Ignore short/numeric external customer numbers: they may also be dates,
    // totals or invoice numbers. GMED IDs contain a letter prefix and digits.
    return id.length >= 5 && /\p{L}/u.test(id) && /\d/.test(id) && identifiers.has(id);
  });
  if (byId.length > 1) return { status: "ambiguous" };
  if (byId.length === 1) {
    const patient = byId[0];
    // A unique ID can disambiguate namesakes, but conflicting recipient names
    // need a person to review the assignment.
    if (byName.some((candidate) => candidate.id !== patient.id && fullName(candidate) !== fullName(patient))) {
      return { status: "ambiguous" };
    }
    return { status: "matched", patientId: patient.id };
  }
  if (byName.length === 1) return { status: "matched", patientId: byName[0].id };
  return { status: byName.length ? "ambiguous" : "not_found" };
}

// XML buyer references and invoice IDs are not GMED patient identifiers.
export function matchInvoiceRecipient(name: string | null | undefined, patients: readonly PatientOption[]): InvoicePatientMatch {
  if (!name || /\b(gmbh|ag|kg|ohg|ug|gbr|ltd|llc|inc|agentur|gesellschaft|company|firma)\b/iu.test(name)) return { status: "not_found" };
  const recipient = normalize(name).replace(/^(?:herrn?|frau|mr|mrs|ms)\s+/u, "");
  const matches = patients.filter((patient) => patient.first_name?.trim() && patient.last_name?.trim()
    && [normalize(`${patient.first_name} ${patient.last_name}`), normalize(`${patient.last_name} ${patient.first_name}`)].includes(recipient));
  return matches.length === 1 ? { status: "matched", patientId: matches[0].id }
    : { status: matches.length ? "ambiguous" : "not_found" };
}
