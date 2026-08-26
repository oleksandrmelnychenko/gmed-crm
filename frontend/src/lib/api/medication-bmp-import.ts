import { post } from "./client";

export type MedicationBmpIssue = {
  code: string;
  path: string;
  message_ru: string;
  message_de: string;
  blocking: boolean;
};

export type MedicationBmpSubstance = {
  name: string;
  strength: string | null;
};

export type MedicationBmpMedication = {
  index: number;
  pzn: string | null;
  trade_name: string | null;
  substances: MedicationBmpSubstance[];
  form: { kind: "code" | "free_text"; value: string } | null;
  dose: {
    morning: string | null;
    noon: string | null;
    evening: string | null;
    night: string | null;
    free_text: string | null;
    weekly_day: number | null;
  };
  unit: { kind: "code" | "free_text"; value: string } | null;
  instructions: string | null;
  reason: string | null;
  additional_text: string | null;
  importable: boolean;
  blocking_reasons: MedicationBmpIssue[];
};

export type MedicationBmpSection = {
  index: number;
  code: string | null;
  title: string | null;
  category: "dauer" | "besondere" | "selbst" | null;
  medications: MedicationBmpMedication[];
};

export type MedicationBmpIdentityField = {
  field: "given_name" | "family_name" | "birth_date";
  carrier_value: string | null;
  patient_value: string | null;
  matches: boolean;
};

export type MedicationBmpImportPermissions = {
  can_preview: boolean;
  can_confirm: boolean;
};

export type MedicationBmpImportPreview = {
  mode: "kbv_bmp_carrier_xml";
  generated_at: string;
  parser: {
    spec_version: "028";
    locale: "de-DE";
    implementation_version: "gmed-bmp-import-v1";
  };
  preview_fingerprint: string;
  plan: {
    instance_id: string;
    version: "028";
    locale: "de-DE";
    page_number: number | null;
    total_pages: number | null;
    printed_at: string;
  };
  patient: {
    given_name: string;
    family_name: string;
    birth_date: string;
    gender: string | null;
    insurance_id: string | null;
  };
  issuer: {
    name: string;
    street: string | null;
    postal_code: string | null;
    city: string | null;
    phone: string | null;
    email: string | null;
    printed_at: string;
    identifier: { kind: "lanr" | "idf" | "kik"; value: string } | null;
  };
  sections: MedicationBmpSection[];
  summary: {
    sections_total: number;
    medications_total: number;
    importable_medications: number;
    blocked_medications: number;
    current_medications_replaced: number;
  };
  identity_match: {
    status: "matched" | "mismatch" | "profile_incomplete" | "carrier_incomplete";
    fields: MedicationBmpIdentityField[];
    blocking_reasons: MedicationBmpIssue[];
  };
  warnings: MedicationBmpIssue[];
  permissions: MedicationBmpImportPermissions;
};

export type ConfirmMedicationBmpImportInput = {
  carrier_xml: string;
  preview_fingerprint: string;
  idempotency_key: string;
  staff_acknowledged: boolean;
};

export type ConfirmMedicationBmpImportResult = {
  mode: "kbv_bmp_carrier_xml";
  import_id: string;
  status: "confirmed";
  strategy: "replace_current";
  plan_instance_id: string;
  preview_fingerprint: string;
  medication_ids: string[];
  imported_medications: number;
  superseded_medications: number;
  idempotent_replay: boolean;
  confirmed_at: string;
  permissions: MedicationBmpImportPermissions;
};

export class MedicationBmpContractError extends Error {
  readonly field: string;

  constructor(field: string, expected: string, received: unknown) {
    super(`Unexpected BMP import contract value for ${field}: expected ${expected}, received ${String(received)}`);
    this.name = "MedicationBmpContractError";
    this.field = field;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function nullableCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function weeklyDay(value: unknown): number | null {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 1
    && value <= 7
    ? value
    : null;
}

function invariant<T extends string>(
  field: string,
  value: unknown,
  expected: T,
): T {
  if (value !== expected) {
    throw new MedicationBmpContractError(field, expected, value);
  }
  return expected;
}

function issue(value: unknown): MedicationBmpIssue {
  const payload = record(value);
  return {
    code: string(payload.code),
    path: string(payload.path),
    message_ru: string(payload.message_ru),
    message_de: string(payload.message_de),
    blocking: payload.blocking === true,
  };
}

function issues(value: unknown): MedicationBmpIssue[] {
  return Array.isArray(value) ? value.map(issue) : [];
}

function taggedValue(
  value: unknown,
): { kind: "code" | "free_text"; value: string } | null {
  const payload = record(value);
  const normalized = string(payload.value);
  if (!normalized) return null;
  return {
    kind: payload.kind === "code" ? "code" : "free_text",
    value: normalized,
  };
}

function permissions(value: unknown): MedicationBmpImportPermissions {
  const payload = record(value);
  return {
    can_preview: payload.can_preview === true,
    can_confirm: payload.can_confirm === true,
  };
}

function medication(value: unknown): MedicationBmpMedication {
  const payload = record(value);
  const dose = record(payload.dose);
  const substances = Array.isArray(payload.substances) ? payload.substances : [];
  return {
    index: count(payload.index),
    pzn: nullableString(payload.pzn),
    trade_name: nullableString(payload.trade_name),
    substances: substances.map((entry) => {
      const substance = record(entry);
      return {
        name: string(substance.name),
        strength: nullableString(substance.strength),
      };
    }),
    form: taggedValue(payload.form),
    dose: {
      morning: nullableString(dose.morning),
      noon: nullableString(dose.noon),
      evening: nullableString(dose.evening),
      night: nullableString(dose.night),
      free_text: nullableString(dose.free_text),
      weekly_day: weeklyDay(dose.weekly_day),
    },
    unit: taggedValue(payload.unit),
    instructions: nullableString(payload.instructions),
    reason: nullableString(payload.reason),
    additional_text: nullableString(payload.additional_text),
    importable: payload.importable === true,
    blocking_reasons: issues(payload.blocking_reasons),
  };
}

function identityField(value: unknown): MedicationBmpIdentityField {
  const payload = record(value);
  const field = payload.field === "given_name" || payload.field === "birth_date"
    ? payload.field
    : "family_name";
  return {
    field,
    carrier_value: nullableString(payload.carrier_value),
    patient_value: nullableString(payload.patient_value),
    matches: payload.matches === true,
  };
}

export function normalizeMedicationBmpImportPreview(
  value: unknown,
): MedicationBmpImportPreview {
  const payload = record(value);
  const plan = record(payload.plan);
  const patient = record(payload.patient);
  const issuer = record(payload.issuer);
  const issuerIdentifier = record(issuer.identifier);
  const parser = record(payload.parser);
  const summary = record(payload.summary);
  const identity = record(payload.identity_match);
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const identityFields = Array.isArray(identity.fields) ? identity.fields : [];
  const identityStatus = identity.status === "matched"
    || identity.status === "mismatch"
    || identity.status === "profile_incomplete"
    ? identity.status
    : "carrier_incomplete";

  return {
    mode: invariant("mode", payload.mode, "kbv_bmp_carrier_xml"),
    generated_at: string(payload.generated_at),
    parser: {
      spec_version: invariant("parser.spec_version", parser.spec_version, "028"),
      locale: invariant("parser.locale", parser.locale, "de-DE"),
      implementation_version: invariant(
        "parser.implementation_version",
        parser.implementation_version,
        "gmed-bmp-import-v1",
      ),
    },
    preview_fingerprint: string(payload.preview_fingerprint),
    plan: {
      instance_id: string(plan.instance_id),
      version: invariant("plan.version", plan.version, "028"),
      locale: invariant("plan.locale", plan.locale, "de-DE"),
      page_number: nullableCount(plan.page_number),
      total_pages: nullableCount(plan.total_pages),
      printed_at: string(plan.printed_at),
    },
    patient: {
      given_name: string(patient.given_name),
      family_name: string(patient.family_name),
      birth_date: string(patient.birth_date),
      gender: nullableString(patient.gender),
      insurance_id: nullableString(patient.insurance_id),
    },
    issuer: {
      name: string(issuer.name),
      street: nullableString(issuer.street),
      postal_code: nullableString(issuer.postal_code),
      city: nullableString(issuer.city),
      phone: nullableString(issuer.phone),
      email: nullableString(issuer.email),
      printed_at: string(issuer.printed_at),
      identifier: Object.keys(issuerIdentifier).length === 0
        ? null
        : {
            kind: issuerIdentifier.kind === "lanr" || issuerIdentifier.kind === "kik"
              ? issuerIdentifier.kind
              : "idf",
            value: string(issuerIdentifier.value),
          },
    },
    sections: sections.map((entry) => {
      const section = record(entry);
      const category = section.category === "dauer"
        || section.category === "besondere"
        || section.category === "selbst"
        ? section.category
        : null;
      return {
        index: count(section.index),
        code: nullableString(section.code),
        title: nullableString(section.title),
        category,
        medications: Array.isArray(section.medications)
          ? section.medications.map(medication)
          : [],
      };
    }),
    summary: {
      sections_total: count(summary.sections_total),
      medications_total: count(summary.medications_total),
      importable_medications: count(summary.importable_medications),
      blocked_medications: count(summary.blocked_medications),
      current_medications_replaced: count(summary.current_medications_replaced),
    },
    identity_match: {
      status: identityStatus,
      fields: identityFields.map(identityField),
      blocking_reasons: issues(identity.blocking_reasons),
    },
    warnings: issues(payload.warnings),
    permissions: permissions(payload.permissions),
  };
}

export function normalizeConfirmMedicationBmpImportResult(
  value: unknown,
): ConfirmMedicationBmpImportResult {
  const payload = record(value);
  return {
    mode: invariant("mode", payload.mode, "kbv_bmp_carrier_xml"),
    import_id: string(payload.import_id),
    status: invariant("status", payload.status, "confirmed"),
    strategy: invariant("strategy", payload.strategy, "replace_current"),
    plan_instance_id: string(payload.plan_instance_id),
    preview_fingerprint: string(payload.preview_fingerprint),
    medication_ids: Array.isArray(payload.medication_ids)
      ? payload.medication_ids.filter((item): item is string => typeof item === "string")
      : [],
    imported_medications: count(payload.imported_medications),
    superseded_medications: count(payload.superseded_medications),
    idempotent_replay: payload.idempotent_replay === true,
    confirmed_at: string(payload.confirmed_at),
    permissions: permissions(payload.permissions),
  };
}

function collectionPath(patientId: string): string {
  return `/patients/${encodeURIComponent(patientId)}/bmp-imports`;
}

export async function previewMedicationBmpImport(
  patientId: string,
  carrierXml: string,
): Promise<MedicationBmpImportPreview> {
  const payload = await post<unknown>(`${collectionPath(patientId)}/preview`, {
    carrier_xml: carrierXml,
  });
  return normalizeMedicationBmpImportPreview(payload);
}

export async function confirmMedicationBmpImport(
  patientId: string,
  input: ConfirmMedicationBmpImportInput,
): Promise<ConfirmMedicationBmpImportResult> {
  const payload = await post<unknown>(`${collectionPath(patientId)}/confirm`, input);
  return normalizeConfirmMedicationBmpImportResult(payload);
}
