/**
 * Sanctions screening API (crates/server/src/routes/sanctions.rs).
 * See docs/architecture/sanctions-screening_ua.md.
 */
import { apiFetch } from "@/lib/api";

export type LiveCheckStatus = "clear" | "possible_match" | "unavailable";

export type LiveCheckResult = {
  status: LiveCheckStatus;
  list_version_date: string | null;
};

export type LiveCheckInput = {
  first_name: string;
  last_name: string;
  middle_name?: string | null;
  date_of_birth?: string | null;
  citizenships?: string[];
  lead_id?: string | null;
};

export type SanctionsBlockCode = "sanctions_confirmed" | "sanctions_review_pending" | "blocked_country";

export type SanctionsBlock = {
  code: SanctionsBlockCode;
  message: string;
  permanent: boolean;
  countries: string[];
};

export type CountryLift = {
  id: string;
  lead_id: string | null;
  patient_id: string | null;
  countries: string[];
  reason: string;
  lifted_by: string;
  lifted_by_name: string | null;
  lifted_at: string;
};

export type LeadSanctionsStatus = {
  lead_id: string;
  list_version_date: string | null;
  list_available: boolean;
  list_stale: boolean;
  screening: "not_screened" | "clear" | "review_pending" | "confirmed";
  open_hits: number;
  confirmed_hits: number;
  sanctions_block: SanctionsBlock | null;
  country: {
    blocked_countries: string[];
    found: string[];
    blocking: string[];
    lift: CountryLift | null;
  };
  can_lift_country_block: boolean;
  can_review: boolean;
};

export type LeadSanctionsFlag = {
  lead_id: string;
  flag: "confirmed" | "review_pending" | "blocked_country" | "country_lifted";
};

export type HitStatus = "open" | "false_positive" | "confirmed";
export type SubjectKind = "lead_patient" | "lead_guardian" | "lead_payer" | "patient";

export type SubjectData = {
  first_name: string;
  middle_name: string | null;
  last_name: string;
  date_of_birth: string | null;
  citizenships: string[];
  residence?: string[];
  organisation: boolean;
  relation: string | null;
};

export type ListName = {
  whole_name: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  language?: string;
  gender?: string;
};

export type ListBirthDate = {
  date?: string;
  year?: number;
  circa?: boolean;
  place?: string;
  country?: string;
};

export type ListRegulation = {
  programme?: string;
  number_title?: string;
  publication_date?: string;
  entry_into_force_date?: string;
  url?: string;
};

export type ListEntry = {
  logical_id: string;
  eu_reference?: string;
  un_reference?: string;
  subject_type: "person" | "entity";
  names: ListName[];
  birth_dates: ListBirthDate[];
  citizenships: string[];
  regulations: ListRegulation[];
  designation_date?: string;
  remark?: string;
};

export type SanctionsHit = {
  id: string;
  subject_kind: SubjectKind;
  lead_id: string | null;
  patient_id: string | null;
  patient_number: string | null;
  lead_status: string | null;
  owner_name: string | null;
  subject_snapshot: SubjectData;
  current_subject: SubjectData | null;
  list_logical_id: string;
  list_entry: ListEntry;
  list_version_date: string;
  score: number;
  match_details: {
    score?: number;
    name_score?: number;
    matched_name?: string;
    dob?: "exact" | "year" | "conflict" | "unknown";
    citizenship?: "match" | "conflict" | "unknown";
  };
  status: HitStatus;
  still_matches: boolean;
  last_screened_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
  decision_reason: string | null;
  created_at: string;
};

export type HitsResponse = {
  hits: SanctionsHit[];
  counts: Record<HitStatus, number>;
};

export type ListVersion = {
  id: string;
  source: "download" | "upload";
  list_date: string;
  generated_at: string | null;
  global_file_id: string | null;
  sha256: string;
  byte_size: number;
  entry_count: number;
  person_count: number;
  is_active: boolean;
  imported_by_name: string | null;
  created_at: string;
};

export type ListStatusResponse = {
  list: {
    active: ListVersion | null;
    versions: ListVersion[];
    sync: {
      last_attempt_at: string | null;
      last_success_at: string | null;
      last_error_code: string | null;
      last_error_at: string | null;
      consecutive_failures: number;
    };
    stale: boolean;
    source_url: string;
    automatic_download: boolean;
  };
  blocked_countries: string[];
};

export type UploadResponse = {
  outcome:
    | { result: "imported"; version_id: string; list_date: string; entries: number; persons: number }
    | { result: "unchanged"; version_id: string };
  rescreen: { leads: number; patients: number; new_hits: number; errors: number } | null;
};

export type CountryBlocksResponse = {
  leads: {
    lead_id: string;
    name: string | null;
    flag: "blocked_country" | "country_lifted";
    found: string[];
    blocking: string[];
    lift: CountryLift | null;
  }[];
};

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const sanctionsApi = {
  check: (input: LiveCheckInput, signal?: AbortSignal) =>
    apiFetch<LiveCheckResult>("/sanctions/check", { ...json(input), signal }),
  leadStatus: (leadId: string) =>
    apiFetch<LeadSanctionsStatus>(`/sanctions/leads/${encodeURIComponent(leadId)}/status`, {
      forceFresh: true,
    }),
  leadFlags: () => apiFetch<LeadSanctionsFlag[]>("/sanctions/leads/flags", { forceFresh: true }),
  liftLeadCountryBlock: (leadId: string, reason: string) =>
    apiFetch<CountryLift>(
      `/sanctions/leads/${encodeURIComponent(leadId)}/country-override`,
      json({ reason }),
    ),
  revokeCountryLift: (overrideId: string, reason: string) =>
    apiFetch<{ ok: boolean }>(
      `/sanctions/country-overrides/${encodeURIComponent(overrideId)}/revoke`,
      json({ reason }),
    ),
  countryBlocks: () => apiFetch<CountryBlocksResponse>("/sanctions/country-blocks", { forceFresh: true }),
  hits: (status: HitStatus | "all") =>
    apiFetch<HitsResponse>(`/sanctions/hits?status=${encodeURIComponent(status)}`, { forceFresh: true }),
  hit: (hitId: string) =>
    apiFetch<SanctionsHit>(`/sanctions/hits/${encodeURIComponent(hitId)}`, { forceFresh: true }),
  decide: (hitId: string, decision: "false_positive" | "confirmed", reason: string) =>
    apiFetch<SanctionsHit>(
      `/sanctions/hits/${encodeURIComponent(hitId)}/decision`,
      json({ decision, reason }),
    ),
  listStatus: () => apiFetch<ListStatusResponse>("/sanctions/list", { forceFresh: true }),
  refreshList: () => apiFetch<{ ok: boolean }>("/sanctions/list/refresh", json({})),
  setBlockedCountries: (countries: string[]) =>
    apiFetch<{ blocked_countries: string[] }>("/sanctions/settings/blocked-countries", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ countries }),
    }),
  /** Manual upload of the FSF XML (or a ZIP with it); long timeout for re-screening. */
  uploadList: (file: File) => {
    const form = new FormData();
    form.set("file", file, file.name);
    return apiFetch<UploadResponse>("/sanctions/list/upload", {
      method: "POST",
      body: form,
      timeoutMs: 300_000,
    });
  },
};
