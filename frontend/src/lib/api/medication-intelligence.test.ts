import { beforeEach, describe, expect, it, vi } from "vitest";

import { get, post } from "./client";
import {
  confirmMedicationIdentity,
  fetchMedicationIntelligence,
  fetchMedicationIdentityCandidates,
  generateMedicationIdentityCandidates,
  normalizeMedicationIdentityCandidateSet,
  normalizeMedicationIntelligence,
} from "./medication-intelligence";

vi.mock("./client", () => ({
  get: vi.fn(),
  post: vi.fn(),
}));

describe("medication intelligence API", () => {
  beforeEach(() => {
    vi.mocked(get).mockReset();
    vi.mocked(post).mockReset();
  });

  it("uses the patient-scoped endpoint and normalizes its payload", async () => {
    vi.mocked(get).mockResolvedValue({
      generated_at: "2026-08-26T10:00:00Z",
      summary: { active_medications: 2 },
      medications: [{ id: "med-1", name: "Eliquis", identity_status: "verified" }],
    });

    const result = await fetchMedicationIntelligence("patient/one");

    expect(get).toHaveBeenCalledWith(
      "/patients/patient%2Fone/medication-intelligence",
    );
    expect(result.summary.active_medications).toBe(2);
    expect(result.summary.findings_total).toBe(0);
    expect(result.medications[0]).toMatchObject({
      name: "Eliquis",
      substance: null,
      identity_status: "verified",
    });
    expect(result.findings).toEqual([]);
    expect(result.missing_data).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(result.identity_permissions).toEqual({
      can_search_candidates: false,
      can_confirm_identity: false,
      reason_code: null,
    });
  });

  it("falls back to safe values for incomplete or unknown fields", () => {
    const result = normalizeMedicationIntelligence({
      mode: "unexpected",
      summary: { findings_total: -3, missing_data_total: "four" },
      findings: [{ id: "finding-1", severity: "critical" }],
      medications: [{ id: "med-1", identity_status: "not-matched" }],
      sources: [{ id: "source-1", ingestion_status: "unknown" }],
    });

    expect(result.mode).toBe("open_sources_only");
    expect(result.summary.findings_total).toBe(0);
    expect(result.summary.missing_data_total).toBe(0);
    expect(result.findings[0].severity).toBe("info");
    expect(result.findings[0]).toMatchObject({
      source_id: null,
      published_at: null,
      source_url: null,
      substances: [],
    });
    expect(result.medications[0].identity_status).toBe("unresolved");
    expect(result.sources[0].ingestion_status).toBe("manual_reference");
    expect(result.sources[0].health).toBe("never");
    expect(result.sources[0].last_successful_snapshot).toBeNull();
  });

  it("normalizes source freshness and successful snapshot provenance", () => {
    const result = normalizeMedicationIntelligence({
      sources: [{
        id: "bfarm-shortages",
        ingestion_status: "available",
        health: "stale",
        freshness_ttl_hours: 24,
        last_attempt_at: "2026-08-26T11:00:00Z",
        last_error: "upstream timeout",
        last_successful_snapshot: {
          id: "snapshot-1",
          fetched_at: "2026-08-25T10:00:00Z",
          published_at: "2026-08-25T08:00:00Z",
          version: "2026-08-25",
          checksum_sha256: "0123456789abcdef",
          item_count: 184,
          source_url: "https://example.test/feed.csv",
        },
      }],
    });

    expect(result.sources[0]).toMatchObject({
      ingestion_status: "available",
      health: "stale",
      freshness_ttl_hours: 24,
      last_attempt_at: "2026-08-26T11:00:00Z",
      last_error: "upstream timeout",
      last_successful_snapshot: {
        id: "snapshot-1",
        version: "2026-08-25",
        item_count: 184,
      },
    });
  });

  it("normalizes optional official safety alert metadata", () => {
    const result = normalizeMedicationIntelligence({
      findings: [{
        id: "alert-1",
        category: "official_safety_alert",
        severity: "warning",
        source_id: "bfarm",
        published_at: "2026-08-25T08:00:00Z",
        source_url: "https://www.bfarm.de/alert.pdf",
        substances: ["Apixaban", 42, "Ibuprofen"],
      }],
    });

    expect(result.findings[0]).toMatchObject({
      category: "official_safety_alert",
      severity: "warning",
      source_id: "bfarm",
      published_at: "2026-08-25T08:00:00Z",
      source_url: "https://www.bfarm.de/alert.pdf",
      substances: ["Apixaban", "Ibuprofen"],
    });
  });

  it("normalizes a deterministic medication identity candidate set without confidence scores", () => {
    const result = normalizeMedicationIdentityCandidateSet({
      medication: {
        id: "med-1",
        name: "Eliquis",
        substance: "Apixaban",
        version: "v4",
        identity_status: "unresolved",
      },
      candidate_set: {
        id: "set-1",
        generated_at: "2026-08-26T10:00:00Z",
        query_basis: ["pzn", 42],
      },
      candidates: [{
        id: "candidate-1",
        product: {
          id: "product-1",
          brand_name: "Eliquis 5 mg",
          substances: ["Apixaban"],
          pzn: "12345678",
        },
        match_basis: ["exact_pzn", "unsupported_score"],
        confirmable: true,
        provenance: {
          source_state: "official_snapshot",
          source_id: "bfarm",
          source_label: "BfArM",
          snapshot_id: "snapshot-1",
        },
      }],
      permissions: {
        can_search_candidates: true,
        can_confirm_identity: true,
      },
    });

    expect(result.medication).toMatchObject({
      id: "med-1",
      strength: null,
      version: "v4",
      identity_status: "unresolved",
    });
    expect(result.candidate_set.query_basis).toEqual(["pzn"]);
    expect(result.candidates[0]).toMatchObject({
      confirmable: true,
      match_basis: ["exact_pzn"],
      product: { brand_name: "Eliquis 5 mg", substances: ["Apixaban"] },
      provenance: {
        source_state: "official_snapshot",
        snapshot_id: "snapshot-1",
        official_url: null,
      },
    });
    expect(result.permissions).toEqual({
      can_search_candidates: true,
      can_confirm_identity: true,
      reason_code: null,
    });
    expect(JSON.stringify(result)).not.toContain("confidence");
  });

  it("uses the defined candidate and confirmation routes", async () => {
    const rawCandidateSet = {
      medication: { id: "med/1", version: "v1" },
      candidate_set: { id: "set-1" },
      candidates: [],
      permissions: { can_search_candidates: true },
    };
    vi.mocked(get).mockResolvedValueOnce(rawCandidateSet);
    vi.mocked(post)
      .mockResolvedValueOnce(rawCandidateSet)
      .mockResolvedValueOnce({
        medication_id: "med/1",
        identity_status: "verified",
        medication_version: "v2",
        refresh_token: "refresh-1",
        audit: {
          confirmed_by: "user-1",
          confirmed_at: "2026-08-26T12:00:00Z",
        },
      });

    await fetchMedicationIdentityCandidates("patient/1", "med/1");
    await generateMedicationIdentityCandidates("patient/1", "med/1");
    const confirmation = await confirmMedicationIdentity("patient/1", "med/1", {
      candidate_set_id: "set-1",
      candidate_id: "candidate-1",
      medication_version: "v1",
      source_snapshot_id: null,
      staff_acknowledged: true,
      idempotency_key: "request-1",
    });

    const path = "/patients/patient%2F1/medications/med%2F1";
    expect(get).toHaveBeenCalledWith(`${path}/identity-candidates`);
    expect(post).toHaveBeenNthCalledWith(1, `${path}/identity-candidates`);
    expect(post).toHaveBeenNthCalledWith(
      2,
      `${path}/identity-confirmations`,
      expect.objectContaining({
        staff_acknowledged: true,
        idempotency_key: "request-1",
      }),
    );
    expect(confirmation).toEqual({
      medication_id: "med/1",
      identity_status: "verified",
      medication_version: "v2",
      refresh_token: "refresh-1",
      audit: {
        confirmed_by: "user-1",
        confirmed_at: "2026-08-26T12:00:00Z",
      },
    });
  });
});
