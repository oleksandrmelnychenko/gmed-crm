import { apiFetch } from "@/lib/api";

import type {
  CreateStaffAccessProfileBody,
  StaffAccessProfile,
  StaffAccessResource,
  StaffUserAccessResponse,
  UpdateStaffUserAccessBody,
} from "./staff-access-types";

type StaffAccessResourceRow = {
  id: string;
  label: string;
  description?: string | null;
  medical_kind?: string | null;
  is_medical: boolean;
  is_active?: boolean | null;
  status: string;
};

function listAccessResources(resourceType: "provider" | "patient" | "document") {
  return apiFetch<StaffAccessResourceRow[]>(
    `/staff-access/resources/${resourceType}`,
    { forceFresh: true },
  ).then((rows) =>
    rows.map<StaffAccessResource>((row) => ({
      id: row.id,
      label: row.label.trim() || row.id,
      description: row.description?.trim() || "",
      isMedical: row.is_medical,
      isActive: row.is_active ?? undefined,
      medicalKind:
        row.medical_kind === "medical" || row.medical_kind === "non_medical"
          ? row.medical_kind
          : undefined,
      status: row.status.trim() || "unknown",
    })),
  );
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
  return listAccessResources("provider");
}

export function listPatientAccessResources() {
  return listAccessResources("patient");
}

export function listDocumentAccessResources() {
  return listAccessResources("document");
}
