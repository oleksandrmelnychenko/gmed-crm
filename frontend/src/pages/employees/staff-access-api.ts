import { apiFetch } from "@/lib/api";

import type {
  CreateStaffAccessProfileBody,
  StaffAccessProfile,
  StaffAccessResource,
  StaffUserAccessResponse,
  UpdateStaffUserAccessBody,
} from "./staff-access-types";

type ProviderRow = {
  id: string;
  name?: string | null;
  provider_type?: string | null;
  address_city?: string | null;
};

type PatientRow = {
  id: string;
  patient_id?: string | null;
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

type DocumentRow = {
  id: string;
  document_number?: string | null;
  auto_name?: string | null;
  original_filename?: string | null;
  patient_name?: string | null;
  is_medical?: boolean;
};

function compactText(values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim()).filter(Boolean).join(" · ");
}

export function listStaffAccessProfiles() {
  return apiFetch<StaffAccessProfile[]>("/staff-access/profiles", {
    forceFresh: true,
  });
}

export function getStaffUserAccess(userId: string) {
  return apiFetch<StaffUserAccessResponse>(
    `/staff-access/users/${encodeURIComponent(userId)}`,
    { forceFresh: true },
  );
}

export function updateStaffUserAccess(
  userId: string,
  body: UpdateStaffUserAccessBody,
) {
  return apiFetch<StaffUserAccessResponse>(
    `/staff-access/users/${encodeURIComponent(userId)}/update`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function createStaffAccessProfile(body: CreateStaffAccessProfileBody) {
  return apiFetch<StaffAccessProfile>("/staff-access/profiles", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function cloneStaffAccessProfile(
  profileId: string,
  body: { name: string; description?: string | null },
) {
  return apiFetch<StaffAccessProfile>(
    `/staff-access/profiles/${encodeURIComponent(profileId)}/clone`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function listProviderAccessResources() {
  return apiFetch<ProviderRow[]>("/providers", { forceFresh: true }).then((rows) =>
    rows.map<StaffAccessResource>((row) => ({
      id: row.id,
      label: row.name?.trim() || row.id,
      description: compactText([row.provider_type, row.address_city]),
    })),
  );
}

export function listPatientAccessResources() {
  return apiFetch<PatientRow[]>("/patients", { forceFresh: true }).then((rows) =>
    rows.map<StaffAccessResource>((row) => {
      const name = compactText([row.title, row.first_name, row.last_name]).replaceAll(" · ", " ");
      return {
        id: row.id,
        label: name || row.patient_id?.trim() || row.id,
        description: compactText([row.patient_id, row.email]),
      };
    }),
  );
}

export function listDocumentAccessResources() {
  return apiFetch<DocumentRow[]>("/documents", { forceFresh: true }).then((rows) =>
    rows.map<StaffAccessResource>((row) => ({
      id: row.id,
      label:
        row.auto_name?.trim() ||
        row.original_filename?.trim() ||
        row.document_number?.trim() ||
        row.id,
      description: compactText([row.document_number, row.patient_name]),
      isMedical: Boolean(row.is_medical),
    })),
  );
}
