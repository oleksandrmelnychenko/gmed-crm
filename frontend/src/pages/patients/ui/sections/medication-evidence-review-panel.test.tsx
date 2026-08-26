import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";
import type {
  MedicationEvidenceReview,
  MedicationEvidenceReviewPreview,
} from "@/lib/api/medication-evidence-reviews";

import {
  MedicationEvidenceReviewContent,
  MedicationEvidenceReviewPanelContent,
  medicationEvidenceOperationForError,
  resolveMedicationEvidenceIdempotencyKey,
} from "./medication-evidence-review-panel";

function summary() {
  return {
    active_medications: 2,
    identified_medications: 1,
    unresolved_medications: 1,
    findings_total: 1,
    high_priority_findings: 0,
    missing_data_total: 1,
  };
}

function preview(
  overrides: Partial<MedicationEvidenceReviewPreview> = {},
): MedicationEvidenceReviewPreview {
  return {
    mode: "local_evidence_only",
    generated_at: "2026-08-26T12:00:00Z",
    intelligence_fingerprint: "fingerprint-1",
    summary: summary(),
    medication_ids: ["med-1", "med-2"],
    provider: {
      kind: "none",
      status: "not_configured",
      external_calls_enabled: false,
      reason_code: "external_provider_not_configured",
    },
    clinical_review: { status: "not_configured", can_approve: false },
    permissions: { can_create_review: true, can_read_review: true },
    latest_review: {
      id: "review-1",
      status: "draft_ready",
      created_at: "2026-08-26T11:00:00Z",
    },
    ...overrides,
  };
}

function review(overrides: Partial<MedicationEvidenceReview> = {}): MedicationEvidenceReview {
  return {
    mode: "local_evidence_only",
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
      summary: summary(),
      medication_ids: ["med-1", "med-2"],
      findings: [{
        id: "finding-1",
        severity: "warning",
        category: "official_safety_alert",
        title_ru: "Проверяемое предупреждение",
        title_de: "Prüfbarer Warnhinweis",
        medication_ids: ["med-1"],
        evidence_refs: ["opaque:item"],
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
        last_successful_snapshot: null,
        citation_ref: "citation:source-bfarm",
      }],
      citations: [
        {
          id: "citation:finding-1",
          kind: "finding",
          source_id: "bfarm",
          source_url: "https://www.bfarm.de/alert",
          evidence_refs: ["opaque:item"],
        },
        {
          id: "citation:missing-dose",
          kind: "missing_data",
          source_id: null,
          source_url: null,
          evidence_refs: ["patient_medication:med-1"],
        },
      ],
    },
    draft: {
      id: "draft-1",
      status: "ready",
      created_at: "2026-08-26T11:00:01Z",
      evidence_summary: [{
        text_ru: "Зафиксирован проверяемый сигнал.",
        text_de: "Ein prüfbarer Hinweis wurde erfasst.",
        citation_refs: ["citation:finding-1"],
      }],
      verification_questions: [{
        text_ru: "Как специалист оценивает этот сигнал?",
        text_de: "Wie bewertet die Fachperson diesen Hinweis?",
        citation_refs: ["citation:finding-1"],
      }],
      limitations: [{
        text_ru: "Пакет не заменяет медицинскую проверку.",
        text_de: "Das Paket ersetzt keine medizinische Prüfung.",
        citation_refs: [],
      }],
      citation_refs: ["citation:finding-1", "citation:missing-dose"],
    },
    provider: {
      kind: "none",
      status: "not_configured",
      external_calls_enabled: false,
      reason_code: "external_provider_not_configured",
    },
    clinical_review: { status: "not_configured", can_approve: false },
    permissions: { can_create_review: true, can_read_review: true },
    ...overrides,
  };
}

describe("MedicationEvidenceReviewPanelContent", () => {
  it("presents provider-not-configured as a neutral local mode, not a failure", () => {
    const html = renderToStaticMarkup(
      <MedicationEvidenceReviewPanelContent preview={preview()} language="ru" />,
    );

    expect(html).toContain("Evidence Copilot");
    expect(html).toContain("Только локальные доказательства");
    expect(html).toContain("Внешний AI-провайдер не настроен");
    expect(html).toContain("внешние вызовы не выполняются");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("Одобрить");
  });

  it("obeys server create/read capabilities", () => {
    const allowed = renderToStaticMarkup(
      <MedicationEvidenceReviewPanelContent
        preview={preview()}
        language="de"
        onCreate={() => undefined}
        onViewLatest={() => undefined}
      />,
    );
    const denied = renderToStaticMarkup(
      <MedicationEvidenceReviewPanelContent
        preview={preview({
          permissions: { can_create_review: false, can_read_review: false },
        })}
        language="de"
        onCreate={() => undefined}
        onViewLatest={() => undefined}
      />,
    );

    expect(allowed).toContain("Evidenzpaket erstellen");
    expect(allowed).toContain("Paket öffnen");
    expect(denied).not.toContain("Evidenzpaket erstellen");
    expect(denied).not.toContain("Paket öffnen");
  });

  it("renders an explicit stale fingerprint recovery state", () => {
    const html = renderToStaticMarkup(
      <MedicationEvidenceReviewPanelContent
        preview={preview()}
        operation="stale"
        language="ru"
        onRefreshStale={() => undefined}
      />,
    );

    expect(html).toContain("Medication Intelligence изменился");
    expect(html).toContain("Обновить данные");
    expect(html).toContain('role="alert"');
  });
});

describe("MedicationEvidenceReviewContent", () => {
  it("shows bilingual allowlisted draft groups and bundle-owned citation links", () => {
    const russian = renderToStaticMarkup(
      <MedicationEvidenceReviewContent review={review()} language="ru" />,
    );
    const german = renderToStaticMarkup(
      <MedicationEvidenceReviewContent review={review()} language="de" />,
    );

    expect(russian).toContain("Сводка доказательств");
    expect(russian).toContain("Вопросы для проверки");
    expect(russian).toContain("Ограничения");
    expect(russian).toContain("Зафиксирован проверяемый сигнал");
    expect(russian).toContain('href="https://www.bfarm.de/alert"');
    expect(russian).toContain("citation:finding-1");
    expect(russian).toContain("Клиническое согласование не настроено");
    expect(german).toContain("Evidenzzusammenfassung");
    expect(german).toContain("Prüffragen");
    expect(german).toContain("Ein prüfbarer Hinweis wurde erfasst");
    expect(german).not.toContain("Зафиксирован проверяемый сигнал");
    expect(russian).not.toMatch(/confidence|дозировк.*измен|Одобрить|Freigeben/);
  });

  it("never turns an unsafe citation URL into a link", () => {
    const unsafe = review();
    unsafe.bundle.citations[0] = {
      ...unsafe.bundle.citations[0],
      source_url: "javascript:alert(1)",
    };
    unsafe.bundle.sources[0] = {
      ...unsafe.bundle.sources[0],
      url: "data:text/html,unsafe",
    };
    const html = renderToStaticMarkup(
      <MedicationEvidenceReviewContent review={unsafe} language="ru" />,
    );

    expect(html).not.toContain("javascript:alert");
    expect(html).not.toContain("data:text/html");
  });

  it("does not render bundle contents when full-review read capability is absent", () => {
    const denied = review({
      permissions: { can_create_review: true, can_read_review: false },
    });
    const html = renderToStaticMarkup(
      <MedicationEvidenceReviewContent review={denied} language="de" />,
    );

    expect(html).toContain("keinen Zugriff");
    expect(html).not.toContain("Ein prüfbarer Hinweis wurde erfasst");
  });

  it("maps 409 to stale and keeps one idempotency key for retries", () => {
    expect(
      medicationEvidenceOperationForError(new ApiRequestError("stale", { status: 409 })),
    ).toBe("stale");
    expect(
      medicationEvidenceOperationForError(new ApiRequestError("failed", { status: 500 })),
    ).toBe("error");
    const first = resolveMedicationEvidenceIdempotencyKey(null, () => "attempt-1");
    const retry = resolveMedicationEvidenceIdempotencyKey(first, () => "attempt-2");
    expect(first).toBe("attempt-1");
    expect(retry).toBe("attempt-1");
  });
});
