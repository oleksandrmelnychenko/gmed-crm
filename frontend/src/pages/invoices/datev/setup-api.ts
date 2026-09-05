import { apiFetch } from "@/lib/api";

export const DATEV_MODULES = ["belege", "belegfreigabe", "bank", "kassenbuch", "auswertungspakete", "liquiditaetsmonitor"] as const;
export type DatevModule = typeof DATEV_MODULES[number];
export type DatevProfile = {
  company_name: string;
  consultant_number: string;
  client_number: string;
  belege_version: string;
  modules: DatevModule[];
  export_service: "unknown" | "not_ordered" | "ordered";
};
export type DatevSetup = {
  profile: DatevProfile;
  revision: string | null;
  updated_at: string | null;
  connection_status: "not_configured";
  read_only: true;
  accounting_writes_enabled: false;
  last_sync_at: null;
};

export const fetchDatevSetup = () => apiFetch<DatevSetup>("/admin/datev/setup", { forceFresh: true });
export const saveDatevSetup = (profile: DatevProfile, revision: string | null) => apiFetch<DatevSetup>("/admin/datev/setup", {
  method: "PUT", body: JSON.stringify({ profile, revision }),
});
