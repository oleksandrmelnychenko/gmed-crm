import { apiFetch, downloadApiFile } from "@/lib/api";

type JsonPayload = Record<string, unknown>;

const ADMIN_FAST_CACHE_TTL_MS = 15_000;
const ADMIN_LOOKUPS_CACHE_TTL_MS = 60_000;

function postJson<T = unknown>(path: string, payload?: JsonPayload) {
  const init: RequestInit = { method: "POST" };
  if (payload !== undefined) {
    init.body = JSON.stringify(payload);
  }
  return apiFetch<T>(path, init);
}

export function fetchAdminUsers<TUser>() {
  return apiFetch<TUser[]>("/users", {
    cacheTtlMs: ADMIN_LOOKUPS_CACHE_TTL_MS,
  });
}

export function createAdminUser<TUser>(payload: JsonPayload) {
  return postJson<TUser>("/users", payload);
}

export function updateAdminUser(userId: string, payload: JsonPayload) {
  return postJson(`/users/${userId}/update`, payload);
}

export function resetAdminUserPassword(userId: string, payload: JsonPayload) {
  return postJson(`/users/${userId}/reset-password`, payload);
}

export function setAdminUserActive(userId: string, isActive: boolean) {
  return postJson(isActive ? `/users/${userId}/activate` : `/users/${userId}/deactivate`);
}

export async function fetchAdminSettingsWorkspace<
  TSetting,
  TSession,
  TPendingLogin,
>() {
  const [settingsRows, sessionRows, pendingRows] = await Promise.all([
    apiFetch<TSetting[]>("/admin/settings", {
      cacheTtlMs: ADMIN_LOOKUPS_CACHE_TTL_MS,
    }),
    apiFetch<TSession[]>("/admin/sessions", {
      cacheTtlMs: ADMIN_FAST_CACHE_TTL_MS,
    }),
    apiFetch<TPendingLogin[]>("/admin/mfa/pending", {
      cacheTtlMs: ADMIN_FAST_CACHE_TTL_MS,
    }),
  ]);
  return { settingsRows, sessionRows, pendingRows };
}

export function saveAdminSetting(key: string, value: string) {
  return postJson(`/admin/settings/${key}`, { value });
}

export function revokeAdminUserSessions(userId: string) {
  return postJson(`/admin/sessions/user/${userId}/revoke`);
}

export function revokeAllAdminSessions() {
  return postJson("/admin/sessions/revoke-all");
}

export function approvePendingMfaLogin(id: string) {
  return postJson(`/admin/mfa/pending/${id}/approve`);
}

export function rejectPendingMfaLogin(id: string) {
  return postJson(`/admin/mfa/pending/${id}/reject`);
}

export async function fetchAdminSecurityWorkspace<TIpEntry, TGeoLogin, TAudit>() {
  const [ipList, geoList, analyticsPayload, settings] = await Promise.all([
    apiFetch<TIpEntry[]>("/admin/ip-whitelist", {
      cacheTtlMs: ADMIN_LOOKUPS_CACHE_TTL_MS,
    }),
    apiFetch<TGeoLogin[]>("/admin/login-geo", {
      cacheTtlMs: ADMIN_FAST_CACHE_TTL_MS,
    }),
    apiFetch<TAudit>("/admin/audit-analytics", {
      cacheTtlMs: ADMIN_FAST_CACHE_TTL_MS,
    }).catch(() => null),
    apiFetch<{ key: string; value: string }[]>("/admin/settings", {
      cacheTtlMs: ADMIN_LOOKUPS_CACHE_TTL_MS,
    }),
  ]);
  return { ipList, geoList, analyticsPayload, settings };
}

export function saveAdminMaintenance(payload: JsonPayload) {
  return postJson("/admin/maintenance", payload);
}

export function createIpWhitelistEntry(payload: JsonPayload) {
  return postJson("/admin/ip-whitelist", payload);
}

export function deleteIpWhitelistEntry(id: string) {
  return postJson(`/admin/ip-whitelist/${id}/delete`);
}

export function fetchAdminHealth<THealth>() {
  return apiFetch<THealth>("/admin/health", {
    cacheTtlMs: ADMIN_FAST_CACHE_TTL_MS,
  });
}

export function fetchAdminCustomFields<TField>(entityType: string) {
  const query = entityType ? `?entity_type=${encodeURIComponent(entityType)}` : "";
  return apiFetch<TField[]>(`/admin/custom-fields${query}`, {
    cacheTtlMs: ADMIN_LOOKUPS_CACHE_TTL_MS,
  });
}

export function createAdminCustomField(payload: JsonPayload) {
  return postJson("/admin/custom-fields", payload);
}

export function deleteAdminCustomField(id: string) {
  return postJson(`/admin/custom-fields/${id}/delete`);
}

export function fetchAdminAnnouncements<TAnnouncement>() {
  return apiFetch<TAnnouncement[]>("/admin/announcements", {
    cacheTtlMs: ADMIN_LOOKUPS_CACHE_TTL_MS,
  });
}

export function createAdminAnnouncement(payload: JsonPayload) {
  return postJson("/admin/announcements", payload);
}

export function deleteAdminAnnouncement(id: string) {
  return postJson(`/admin/announcements/${id}/delete`);
}

export function fetchAdminNotificationChannels<TChannel>() {
  return apiFetch<TChannel[]>("/admin/notifications", {
    cacheTtlMs: ADMIN_LOOKUPS_CACHE_TTL_MS,
  });
}

export function createAdminNotificationChannel(payload: JsonPayload) {
  return postJson("/admin/notifications", payload);
}

export function deleteAdminNotificationChannel(id: string) {
  return postJson(`/admin/notifications/${id}/delete`);
}

export function testAdminNotificationChannel(id: string) {
  return postJson(`/admin/notifications/${id}/test`);
}

export function fetchAdminActivity<TActivity>(action: string) {
  const query = new URLSearchParams({ limit: "300" });
  if (action) query.set("action", action);
  return apiFetch<TActivity[]>(`/admin/activity?${query.toString()}`, {
    cacheTtlMs: ADMIN_FAST_CACHE_TTL_MS,
  });
}

export function fetchAccessPolicies<TPolicy>() {
  return apiFetch<TPolicy[]>("/access-policies?entity_type=patient", {
    cacheTtlMs: ADMIN_LOOKUPS_CACHE_TTL_MS,
  });
}

export function updateAccessPolicy(payload: JsonPayload) {
  return postJson("/access-policies/update", payload);
}

export function resetAccessPolicies() {
  return postJson("/access-policies/reset", { entity_type: "patient" });
}

export async function fetchComplianceDashboard<TDashboard, TExpiredConsent>() {
  const [dashboard, expired] = await Promise.all([
    apiFetch<TDashboard>("/admin/compliance/consents", {
      cacheTtlMs: ADMIN_FAST_CACHE_TTL_MS,
    }),
    apiFetch<TExpiredConsent[]>("/admin/compliance/consents/expired", {
      cacheTtlMs: ADMIN_FAST_CACHE_TTL_MS,
    }),
  ]);
  return { dashboard, expired };
}

export function fetchCompliancePrivacyQueue<TPrivacyRequest>() {
  return apiFetch<TPrivacyRequest[]>("/admin/compliance/privacy-requests", {
    cacheTtlMs: ADMIN_FAST_CACHE_TTL_MS,
  });
}

export async function fetchPatientComplianceWorkspace<
  TConsent,
  TPrivacyRequest,
>(patientId: string) {
  const [consents, privacyRequests] = await Promise.all([
    apiFetch<TConsent[]>(`/admin/compliance/patient/${patientId}/consents`, {
      cacheTtlMs: ADMIN_FAST_CACHE_TTL_MS,
    }),
    apiFetch<TPrivacyRequest[]>(
      `/admin/compliance/patient/${patientId}/privacy-requests`,
      { cacheTtlMs: ADMIN_FAST_CACHE_TTL_MS },
    ),
  ]);
  return { consents, privacyRequests };
}

export function savePatientConsent(patientId: string, payload: JsonPayload) {
  return postJson(`/admin/compliance/patient/${patientId}/consents`, payload);
}

export function createPatientPrivacyRequest(patientId: string, payload: JsonPayload) {
  return postJson(
    `/admin/compliance/patient/${patientId}/privacy-requests`,
    payload,
  );
}

export function reviewCompliancePrivacyRequest(
  requestId: string,
  payload: JsonPayload,
) {
  return postJson(`/admin/compliance/privacy-requests/${requestId}/review`, payload);
}

export function executeCompliancePrivacyRequest<TPayload>(requestId: string) {
  return postJson<TPayload>(`/admin/compliance/privacy-requests/${requestId}/execute`);
}

export function downloadPatientComplianceExport(patientId: string) {
  return downloadApiFile(
    `/admin/compliance/patient/${patientId}/export?format=zip`,
    `${patientId}-dsgvo-export.zip`,
  );
}
