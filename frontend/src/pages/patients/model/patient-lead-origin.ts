import type { PatientDetail } from "./list-model";

export type LeadOriginServiceRequest = {
  value: string;
  comment: string | null;
};

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasValue(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (typeof value === "boolean" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.some(hasValue);
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(hasValue);
  }
  return false;
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringsFromUnknown(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const normalized = stringFromUnknown(item);
    return normalized ? [normalized] : [];
  });
}

export function createPatientLeadOrigin(detail: PatientDetail) {
  const profile = recordFromUnknown(detail.intake_profile);
  const snapshot = recordFromUnknown(detail.lead_snapshot);
  const wizardState = recordFromUnknown(snapshot["wizard_state"]);

  const value = (key: string) => (
    hasValue(profile[key]) ? profile[key] : snapshot[key]
  );
  const string = (key: string) => stringFromUnknown(value(key));
  const boolean = (key: string) => {
    const candidate = value(key);
    return typeof candidate === "boolean" ? candidate : null;
  };
  const strings = (key: string) => stringsFromUnknown(value(key));
  const record = (key: string) => recordFromUnknown(value(key));
  const records = (key: string) => {
    const candidate = value(key);
    return Array.isArray(candidate)
      ? candidate
          .filter((item) => item !== null && typeof item === "object" && !Array.isArray(item))
          .map((item) => item as Record<string, unknown>)
      : [];
  };

  const serviceComments = recordFromUnknown(
    hasValue(profile["service_comments"])
      ? profile["service_comments"]
      : wizardState["service_comments"],
  );
  const serviceValues = new Set(strings("services"));
  for (const key of Object.keys(serviceComments)) {
    if (key.trim()) serviceValues.add(key.trim());
  }
  const serviceRequests: LeadOriginServiceRequest[] = Array.from(serviceValues).map((service) => ({
    value: service,
    comment: stringFromUnknown(serviceComments[service]),
  }));

  const sourceLeadId = detail.source_lead_id ?? stringFromUnknown(snapshot["id"]);
  const hasData = Boolean(sourceLeadId) || Object.values(profile).some(hasValue) || Object.values(snapshot).some(hasValue);

  return {
    boolean,
    hasData,
    profile,
    record,
    records,
    serviceRequests,
    snapshot,
    sourceLeadId,
    string,
    strings,
    value,
    wizardState,
  };
}
