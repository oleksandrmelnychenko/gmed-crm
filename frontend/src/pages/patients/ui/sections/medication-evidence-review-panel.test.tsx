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
  officialSourceLabel,
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
    benefit_assessments_total: 1,
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
    ai_provider: {
      kind: "none",
      status: "not_configured",
      external_calls_enabled: false,
      reason_code: "external_provider_not_configured",
      model: null,
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
        source_id: "bfarm_rote_hand",
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
        id: "bfarm_rote_hand",
        label: "Rote-Hand-Briefe und RSS",
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
          source_id: "bfarm_rote_hand",
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
        {
          id: "benefit_assessment:gba:decision-1:group-a",
          kind: "benefit_assessment",
          source_id: "gba_ais",
          source_url: "https://www.g-ba.de/bewertungsverfahren/nutzenbewertung/1/",
          evidence_refs: ["gba:decision-1:group-a"],
        },
      ],
      benefit_assessments: [{
        evidence_ref: "gba:decision-1:group-a",
        medication_id: "med-1",
        decision_id: "decision-1",
        dossier_reference: "A23-01",
        official_url: "https://www.g-ba.de/bewertungsverfahren/nutzenbewertung/1/",
        decision_date: "2026-08-01",
        indication_short: "Indikation",
        patient_group: "Gruppe A",
        benefit_extent: "gering",
        benefit_probability: "Hinweis",
        assessed_substances: ["Apixaban"],
        citation_ref: "benefit_assessment:gba:decision-1:group-a",
      }],
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
  it("renders a compact overview without technical or clinical boilerplate", () => {
    const html = renderToStaticMarkup(
      <MedicationEvidenceReviewPanelContent preview={preview()} language="ru" />,
    );

    expect(html).toContain("AI-анализ доказательств");
    expect(html).not.toContain("Evidence Copilot");
    expect(html).toContain('data-ai-mark="true"');
    expect(html).not.toContain("Только локальные доказательства");
    expect(html).not.toContain("Внешний AI-провайдер не активен");
    expect(html).not.toContain("Клиническое согласование не настроено");
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

    expect(allowed).toContain("KI-Analyse erstellen");
    expect(allowed).toContain("Ergebnis öffnen");
    expect(denied).not.toContain("KI-Analyse erstellen");
    expect(denied).not.toContain("Ergebnis öffnen");
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

    expect(html).toContain("Данные о медикаментах изменились");
    expect(html).not.toContain("Medication Intelligence изменился");
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
    expect(russian).toContain("Источник · bfarm.de");
    expect(russian).toContain("Открыть источник");
    expect(russian).not.toContain("citation:finding-1");
    expect(russian).not.toContain("citation:missing-dose");
    expect(russian).not.toContain("benefit_assessment:gba:decision-1:group-a");
    expect(russian).toContain("Письма Rote-Hand и RSS");
    expect(russian).toContain("Сигнал · BfArM");
    expect(russian).toContain("Актуален");
    expect(russian).not.toContain("medication-evidence-v1");
    expect(russian).toContain("Дополнительная польза");
    expect(russian).toContain("Gruppe A");
    expect(russian).toContain("Точное совпадение PZN/ATC");
    expect(russian).not.toContain("Клиническое согласование не настроено");
    expect(german).toContain("Evidenzzusammenfassung");
    expect(german).toContain("Prüffragen");
    expect(german).toContain("Ein prüfbarer Hinweis wurde erfasst");
    expect(german).toContain("Rote-Hand-Briefe und RSS");
    expect(german).toContain("Hinweis · BfArM");
    expect(german).toContain("Aktuell");
    expect(german).not.toContain("Зафиксирован проверяемый сигнал");
    expect(russian).not.toMatch(/confidence|дозировк.*измен|Одобрить|Freigeben/);
    expect(russian).toContain("bg-orange-500");
    expect(russian).toContain("bg-sky-50");
    expect(russian).toContain("bg-emerald-50");
    expect(russian).toContain("bg-amber-50");
    expect(russian).toContain("bg-rose-50/50");
  });

  it("replaces internal medication relation keys with user-facing text", () => {
    const technical = review();
    technical.bundle.missing_data[0] = {
      code: "medication_identity",
      reason_ru: "Нужен подтверждённый medication_drug_match либо проверенный ATC/PZN.",
      reason_de: "Bestätigter medication_drug_match erforderlich.",
      citation_ref: "missing-data:technical-key",
    };
    technical.draft.verification_questions[0] = {
      text_ru: "Требуется проверить: Нужен подтверждённый medication_drug_match либо проверенный ATC/PZN.",
      text_de: "Bestätigter medication_drug_match erforderlich.",
      citation_refs: ["missing-data:technical-key"],
    };

    const html = renderToStaticMarkup(
      <MedicationEvidenceReviewContent review={technical} language="ru" />,
    );

    expect(html).toContain("Нужно подтвердить соответствие препарата");
    expect(html).not.toContain("medication_drug_match");
    expect(html).not.toContain("missing-data:technical-key");
  });

  it("localizes registered official source labels", () => {
    const source = review().bundle.sources[0];
    expect(officialSourceLabel(source, "ru")).toBe("Письма Rote-Hand и RSS");
    expect(officialSourceLabel(source, "de")).toBe("Rote-Hand-Briefe und RSS");
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
