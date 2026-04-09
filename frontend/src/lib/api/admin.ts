import { get, post, postNoBody } from "./client";
import type {
  // Settings
  SettingRow,
  SessionRow,
  PendingLogin,
  // Security
  IpEntry,
  GeoLogin,
  // Activity
  ActivityRow,
  // Compliance
  ConsentDashboard,
  ExpiredConsent,
  // Custom fields
  CustomField,
  UpsertCustomFieldBody,
  // Notification channels
  NotificationChannel,
  UpsertChannelBody,
  // Announcements
  AnnouncementFull,
  UpsertAnnouncementBody,
  // Health
  HealthData,
} from "./types";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function fetchSettings(): Promise<SettingRow[]> {
  return get<SettingRow[]>("/admin/settings");
}

export function updateSetting(key: string, value: string): Promise<unknown> {
  return post(`/admin/settings/${key}`, { value });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function fetchSessions(): Promise<SessionRow[]> {
  return get<SessionRow[]>("/admin/sessions");
}

export function revokeUserSessions(userId: string): Promise<void> {
  return postNoBody(`/admin/sessions/user/${userId}/revoke`);
}

export function revokeAllSessions(): Promise<void> {
  return postNoBody("/admin/sessions/revoke-all");
}

// ---------------------------------------------------------------------------
// MFA / Pending logins
// ---------------------------------------------------------------------------

export function fetchPendingLogins(): Promise<PendingLogin[]> {
  return get<PendingLogin[]>("/admin/mfa/pending");
}

export function approvePendingLogin(id: string): Promise<void> {
  return postNoBody(`/admin/mfa/pending/${id}/approve`);
}

export function rejectPendingLogin(id: string): Promise<void> {
  return postNoBody(`/admin/mfa/pending/${id}/reject`);
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export function fetchHealth(): Promise<HealthData> {
  return get<HealthData>("/admin/health");
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

export function fetchIpWhitelist(): Promise<IpEntry[]> {
  return get<IpEntry[]>("/admin/ip-whitelist");
}

export function addIpWhitelist(cidr: string, description?: string | null): Promise<unknown> {
  return post("/admin/ip-whitelist", { cidr, description });
}

export function deleteIpWhitelist(id: string): Promise<void> {
  return postNoBody(`/admin/ip-whitelist/${id}/delete`);
}

export function fetchLoginGeo(): Promise<GeoLogin[]> {
  return get<GeoLogin[]>("/admin/login-geo");
}

export function toggleMaintenance(enabled: boolean, message?: string | null): Promise<unknown> {
  return post("/admin/maintenance", { enabled, message });
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export function fetchActivity(params?: {
  limit?: number;
  action?: string;
}): Promise<ActivityRow[]> {
  const q = new URLSearchParams();
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.action) q.set("action", params.action);
  const qs = q.toString();
  return get<ActivityRow[]>(`/admin/activity${qs ? `?${qs}` : ""}`);
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

export function fetchConsents(): Promise<ConsentDashboard> {
  return get<ConsentDashboard>("/admin/compliance/consents");
}

export function fetchExpiredConsents(): Promise<ExpiredConsent[]> {
  return get<ExpiredConsent[]>("/admin/compliance/consents/expired");
}

export function exportPatientData(patientId: string): Promise<unknown> {
  return get(`/admin/compliance/patient/${patientId}/export`);
}

export function anonymizePatient(patientId: string): Promise<void> {
  return postNoBody(`/admin/compliance/patient/${patientId}/anonymize`);
}

// ---------------------------------------------------------------------------
// Custom Fields
// ---------------------------------------------------------------------------

export function fetchCustomFields(entityType: string): Promise<CustomField[]> {
  return get<CustomField[]>(`/admin/custom-fields?entity_type=${entityType}`);
}

export function createCustomField(body: UpsertCustomFieldBody): Promise<unknown> {
  return post("/admin/custom-fields", body);
}

export function deleteCustomField(id: string): Promise<void> {
  return postNoBody(`/admin/custom-fields/${id}/delete`);
}

// ---------------------------------------------------------------------------
// Notification Channels
// ---------------------------------------------------------------------------

export function fetchNotificationChannels(): Promise<NotificationChannel[]> {
  return get<NotificationChannel[]>("/admin/notifications");
}

export function createNotificationChannel(body: UpsertChannelBody): Promise<unknown> {
  return post("/admin/notifications", body);
}

export function deleteNotificationChannel(id: string): Promise<void> {
  return postNoBody(`/admin/notifications/${id}/delete`);
}

export function testNotificationChannel(id: string): Promise<void> {
  return postNoBody(`/admin/notifications/${id}/test`);
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

export function fetchAnnouncements(): Promise<AnnouncementFull[]> {
  return get<AnnouncementFull[]>("/admin/announcements");
}

export function createAnnouncement(body: UpsertAnnouncementBody): Promise<unknown> {
  return post("/admin/announcements", body);
}

export function deleteAnnouncement(id: string): Promise<void> {
  return postNoBody(`/admin/announcements/${id}/delete`);
}
