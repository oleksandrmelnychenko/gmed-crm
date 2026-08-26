import { beforeEach, describe, expect, it, vi } from "vitest";

import { get, post } from "./client";
import {
  createMedicationEvidenceReview,
  fetchMedicationEvidenceReview,
  fetchMedicationEvidenceReviewPreview,
  normalizeMedicationEvidenceReview,
  normalizeMedicationEvidenceReviewPreview,
} from "./medication-evidence-reviews";

vi.mock("./client", () => ({
  get: vi.fn(),
  post: vi.fn(),
}));

describe("medication evidence review API", () => {
  beforeEach(() => {
    vi.mocked(get).mockReset();
    vi.mocked(post).mockReset();
  });

  it("normalizes preview capabilities and keeps provider/clinical review non-operational", () => {
    const result = normalizeMedicationEvidenceReviewPreview({
      generated_at: "2026-08-26T12:00:00Z",
      intelligence_fingerprint: "fingerprint-1",
      summary: { active_medications: 3, findings_total: 2 },
      medication_ids: ["med-1", 42, "med-2"],
      provider: {
        kind: "none",
        status: "not_configured",
        external_calls_enabled: false,
        reason_code: "external_provider_not_configured",
      },
      clinical_review: { status: "not_configured", can_approve: false },
      permissions: { can_create_review: true, can_read_review: false },
      latest_review: {
        id: "review-1",
        status: "draft_ready",
        created_at: "2026-08-26T11:00:00Z",
      },
    });

    expect(result.mode).toBe("local_evidence_only");
    expect(result.summary).toMatchObject({
      active_medications: 3,
      findings_total: 2,
      missing_data_total: 0,
    });
    expect(result.medication_ids).toEqual(["med-1", "med-2"]);
    expect(result.provider).toEqual({
      kind: "none",
      status: "not_configured",
      external_calls_enabled: false,
      reason_code: "external_provider_not_configured",
    });
    expect(result.clinical_review).toEqual({
      status: "not_configured",
      can_approve: false,
    });
    expect(result.permissions).toEqual({
      can_create_review: true,
      can_read_review: false,
    });
    expect(result.latest_review?.status).toBe("draft_ready");
  });

  it("normalizes immutable bundle draft groups and bundle-owned citations", () => {
    const result = normalizeMedicationEvidenceReview({
      review: {
        id: "review-1",
        status: "draft_ready",
        created_at: "2026-08-26T11:00:00Z",
        completed_at: "2026-08-26T11:00:01Z",
        bundle_id: "bundle-1",
      },
      bundle: {
        id: "bundle-1",
        version: "medication-evidence-v1",
        fingerprint: "fingerprint-1",
        created_at: "2026-08-26T11:00:00Z",
        summary: { active_medications: 1 },
        medication_ids: ["med-1"],
        findings: [{
          id: "finding-1",
          severity: "warning",
          category: "official_safety_alert",
          title_ru: "Предупреждение",
          title_de: "Warnhinweis",
          medication_ids: ["med-1"],
          evidence_refs: ["opaque:a"],
          source_id: "bfarm",
          published_at: "2026-08-25T08:00:00Z",
          source_url: "https://www.bfarm.de/alert",
          substances: ["Apixaban"],
          citation_ref: "citation:finding-1",
        }],
        missing_data: [{
          code: "dose",
          reason_ru: "Не указана дозировка",
          reason_de: "Stärke fehlt",
          citation_ref: "citation:missing-dose",
        }],
        sources: [{
          id: "bfarm",
          label: "BfArM",
          authority: "BfArM",
          kind: "rss",
          url: "https://www.bfarm.de/",
          machine_readable: true,
          ingestion_status: "available",
          health: "fresh",
          last_successful_snapshot: {
            id: "snapshot-1",
            fetched_at: "2026-08-26T10:00:00Z",
            published_at: null,
            version: null,
            checksum_sha256: "abc",
            item_count: 10,
            source_url: "https://www.bfarm.de/feed",
          },
          citation_ref: "citation:source-bfarm",
        }],
        citations: [{
          id: "citation:finding-1",
          kind: "finding",
          source_id: "bfarm",
          source_url: "https://www.bfarm.de/alert",
          evidence_refs: ["opaque:a"],
        }],
      },
      draft: {
        id: "draft-1",
        status: "ready",
        created_at: "2026-08-26T11:00:01Z",
        evidence_summary: [{
          text_ru: "Зафиксирован сигнал",
          text_de: "Hinweis erfasst",
          citation_refs: ["citation:finding-1"],
        }],
        verification_questions: [],
        limitations: [{
          text_ru: "Требуется медицинская проверка",
          text_de: "Medizinische Prüfung erforderlich",
          citation_refs: [],
        }],
        citation_refs: ["citation:finding-1"],
      },
      provider: { status: "not_configured" },
      clinical_review: { status: "not_configured", can_approve: false },
      permissions: { can_create_review: true, can_read_review: true },
    });

    expect(result.review.status).toBe("draft_ready");
    expect(result.bundle.findings[0]).toMatchObject({
      source_id: "bfarm",
      citation_ref: "citation:finding-1",
      substances: ["Apixaban"],
    });
    expect(result.bundle.sources[0].last_successful_snapshot).toMatchObject({
      id: "snapshot-1",
      item_count: 10,
      version: null,
    });
    expect(result.bundle.citations[0]).toEqual({
      id: "citation:finding-1",
      kind: "finding",
      source_id: "bfarm",
      source_url: "https://www.bfarm.de/alert",
      evidence_refs: ["opaque:a"],
    });
    expect(result.draft.evidence_summary[0]).toEqual({
      text_ru: "Зафиксирован сигнал",
      text_de: "Hinweis erfasst",
      citation_refs: ["citation:finding-1"],
    });
    expect(JSON.stringify(result)).not.toMatch(/treatment|dosage|confidence|approve_action/);
  });

  it("uses the frozen preview, create, and review endpoints", async () => {
    vi.mocked(get)
      .mockResolvedValueOnce({ intelligence_fingerprint: "fp" })
      .mockResolvedValueOnce({ review: { id: "review/1" } });
    vi.mocked(post).mockResolvedValueOnce({ review: { id: "review/1" } });

    await fetchMedicationEvidenceReviewPreview("patient/1");
    await createMedicationEvidenceReview("patient/1", {
      intelligence_fingerprint: "fp",
      idempotency_key: "attempt-1",
    });
    await fetchMedicationEvidenceReview("patient/1", "review/1");

    const base = "/patients/patient%2F1/medication-evidence-reviews";
    expect(get).toHaveBeenNthCalledWith(1, `${base}/preview`);
    expect(post).toHaveBeenCalledWith(base, {
      intelligence_fingerprint: "fp",
      idempotency_key: "attempt-1",
    });
    expect(get).toHaveBeenNthCalledWith(2, `${base}/review%2F1`);
  });
});
