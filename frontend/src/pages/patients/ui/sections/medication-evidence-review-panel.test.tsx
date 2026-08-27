import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api";
import type {
  MedicationEvidenceReview,
  MedicationEvidenceReviewPreview,
} from "@/lib/api/medication-evidence-reviews";

import {
  MedicationEvidenceReviewContent,
  MedicationEvidenceReviewPanelContent,
  MedicationAiAnalysisSection,
  clearMedicationAiIdempotencyAttempt,
  createSingleFlightRunner,
  isMedicationAiRequestAbort,
  medicationAiAnalysisBelongsToReview,
  medicationAiRealtimeEventMatches,
  medicationEvidenceOperationForError,
  officialSourceLabel,
  resolveMedicationAiIdempotencyAttempt,
  resolveMedicationEvidenceIdempotencyKey,
  startSequentialPolling,
} from "./medication-evidence-review-panel";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

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

  it("keeps URL-less citations visible as safe local references", () => {
    const russian = renderToStaticMarkup(
      <MedicationEvidenceReviewContent review={review()} language="ru" />,
    );
    const german = renderToStaticMarkup(
      <MedicationEvidenceReviewContent review={review()} language="de" />,
    );

    expect(russian).toContain("Недостающие данные · Локальная ссылка 1");
    expect(german).toContain("Fehlende Daten · Lokaler Nachweis 1");
    expect(russian).not.toContain("citation:missing-dose");
    expect(russian).not.toContain("patient_medication:med-1");
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

  it("scopes an ambiguous AI create attempt to one patient review", () => {
    const first = resolveMedicationAiIdempotencyAttempt(
      null,
      "patient-1",
      "review-1",
      () => "ai-attempt-1",
    );
    const createRetryKey = vi.fn(() => "should-not-be-used");
    const sameReviewRetry = resolveMedicationAiIdempotencyAttempt(
      first,
      "patient-1",
      "review-1",
      createRetryKey,
    );
    const otherReview = resolveMedicationAiIdempotencyAttempt(
      first,
      "patient-1",
      "review-2",
      () => "ai-attempt-2",
    );
    const otherPatient = resolveMedicationAiIdempotencyAttempt(
      first,
      "patient-2",
      "review-1",
      () => "ai-attempt-3",
    );

    expect(sameReviewRetry).toBe(first);
    expect(createRetryKey).not.toHaveBeenCalled();
    expect(otherReview.key).toBe("ai-attempt-2");
    expect(otherPatient.key).toBe("ai-attempt-3");
  });

  it("clears only the AI create attempt proven by a matching response", () => {
    const attempt = {
      patientId: "patient-1",
      reviewId: "review-1",
      key: "ai-attempt-1",
    };

    expect(clearMedicationAiIdempotencyAttempt(
      attempt,
      "patient-1",
      "review-1",
      "ai-attempt-1",
    )).toBeNull();
    expect(clearMedicationAiIdempotencyAttempt(
      attempt,
      "patient-1",
      "review-1",
    )).toBeNull();
    expect(clearMedicationAiIdempotencyAttempt(
      attempt,
      "patient-1",
      "review-1",
      "newer-attempt",
    )).toBe(attempt);
    expect(clearMedicationAiIdempotencyAttempt(
      attempt,
      "patient-1",
      "review-2",
    )).toBe(attempt);
  });
});

describe("startSequentialPolling", () => {
  it("waits for a slow request to settle before scheduling the next poll", async () => {
    vi.useFakeTimers();
    try {
      const firstRequest = deferred<void>();
      const poll = vi
        .fn<() => Promise<void>>()
        .mockImplementationOnce(() => firstRequest.promise)
        .mockResolvedValue(undefined);
      const stop = startSequentialPolling({ poll, delayMs: 2_000 });

      await vi.advanceTimersByTimeAsync(2_000);
      expect(poll).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(poll).toHaveBeenCalledTimes(1);

      firstRequest.resolve(undefined);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_999);
      expect(poll).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(poll).toHaveBeenCalledTimes(2);

      stop();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(poll).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reschedule after cleanup while a poll is still in flight", async () => {
    vi.useFakeTimers();
    try {
      const request = deferred<void>();
      const poll = vi.fn<() => Promise<void>>(() => request.promise);
      const stop = startSequentialPolling({ poll, delayMs: 2_000 });

      await vi.advanceTimersByTimeAsync(2_000);
      expect(poll).toHaveBeenCalledTimes(1);

      stop();
      request.resolve(undefined);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(poll).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("medication AI realtime refresh", () => {
  it("matches only ready/failed events for the open patient review", () => {
    const baseEvent = {
      type: "patient.medication_ai_analysis_ready",
      entity_type: "patient",
      entity_id: "patient-1",
      patient_id: "patient-1",
      payload: { review_id: "review-1", analysis_id: "analysis-1", status: "ready" },
    };

    expect(medicationAiRealtimeEventMatches(baseEvent, "patient-1", "review-1")).toBe(true);
    expect(medicationAiRealtimeEventMatches(
      { ...baseEvent, type: "patient.medication_ai_analysis_failed" },
      "patient-1",
      "review-1",
    )).toBe(true);
    expect(medicationAiRealtimeEventMatches(
      { ...baseEvent, patient_id: "patient-2" },
      "patient-1",
      "review-1",
    )).toBe(false);
    expect(medicationAiRealtimeEventMatches(
      { ...baseEvent, payload: { ...baseEvent.payload, review_id: "review-2" } },
      "patient-1",
      "review-1",
    )).toBe(false);
    expect(medicationAiRealtimeEventMatches(
      { ...baseEvent, type: "patient.medication_ai_analysis_requested" },
      "patient-1",
      "review-1",
    )).toBe(false);
  });

  it("accepts the patient entity fallback when patient_id is absent", () => {
    expect(medicationAiRealtimeEventMatches({
      type: "patient.medication_ai_analysis_ready",
      entity_type: "patient",
      entity_id: "patient-1",
      payload: { review_id: "review-1" },
    }, "patient-1", "review-1")).toBe(true);
  });

  it("coalesces realtime and polling loads for the same review", async () => {
    const runner = createSingleFlightRunner();
    const request = deferred<void>();
    const fetchAnalysis = vi.fn(() => request.promise);

    const realtimeLoad = runner.run("patient-1:review-1", fetchAnalysis);
    const pollingLoad = runner.run("patient-1:review-1", fetchAnalysis);

    expect(realtimeLoad).toBe(pollingLoad);
    expect(fetchAnalysis).toHaveBeenCalledTimes(1);

    request.resolve(undefined);
    await realtimeLoad;

    await runner.run("patient-1:review-1", fetchAnalysis);
    expect(fetchAnalysis).toHaveBeenCalledTimes(2);
  });

  it("detaches an in-flight load when dialog or patient cleanup clears it", async () => {
    const runner = createSingleFlightRunner();
    const oldRequest = deferred<void>();
    const freshRequest = deferred<void>();
    const signals: AbortSignal[] = [];
    const fetchAnalysis = vi
      .fn<(signal: AbortSignal) => Promise<void>>()
      .mockImplementationOnce((signal) => {
        signals.push(signal);
        return oldRequest.promise;
      })
      .mockImplementationOnce((signal) => {
        signals.push(signal);
        return freshRequest.promise;
      });

    const oldLoad = runner.run("patient-1:review-1", fetchAnalysis);
    runner.clear();
    const freshLoad = runner.run("patient-1:review-1", fetchAnalysis);

    expect(freshLoad).not.toBe(oldLoad);
    expect(fetchAnalysis).toHaveBeenCalledTimes(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    oldRequest.resolve(undefined);
    await oldLoad;
    expect(runner.run("patient-1:review-1", fetchAnalysis)).toBe(freshLoad);
    expect(fetchAnalysis).toHaveBeenCalledTimes(2);

    freshRequest.resolve(undefined);
    await freshLoad;
  });

  it("aborts the previous request when the patient-review key changes", async () => {
    const runner = createSingleFlightRunner();
    const firstRequest = deferred<void>();
    const secondRequest = deferred<void>();
    const signals: AbortSignal[] = [];
    const fetchAnalysis = vi
      .fn<(signal: AbortSignal) => Promise<void>>()
      .mockImplementationOnce((signal) => {
        signals.push(signal);
        return firstRequest.promise;
      })
      .mockImplementationOnce((signal) => {
        signals.push(signal);
        return secondRequest.promise;
      });

    const firstLoad = runner.run("patient-1:review-1", fetchAnalysis);
    const secondLoad = runner.run("patient-1:review-2", fetchAnalysis);

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    firstRequest.resolve(undefined);
    secondRequest.resolve(undefined);
    await Promise.all([firstLoad, secondLoad]);
  });

  it("recognizes wrapped and native abort errors as non-user-facing", () => {
    const nativeAbort = new Error("aborted");
    nativeAbort.name = "AbortError";

    expect(isMedicationAiRequestAbort(
      new ApiRequestError("cancelled", { code: "aborted" }),
    )).toBe(true);
    expect(isMedicationAiRequestAbort(nativeAbort)).toBe(true);
    expect(isMedicationAiRequestAbort(
      new ApiRequestError("timeout", { code: "timeout" }),
    )).toBe(false);
  });

  it("rejects status payloads that do not belong to the requested review", () => {
    const analysis = {
      id: "analysis-1",
      review_id: "review-1",
      status: "processing" as const,
      requested_at: "2026-08-27T10:00:00Z",
      started_at: null,
      completed_at: null,
      provider: preview().ai_provider,
      prompt_version: "medication-evidence-draft-v1",
      draft: null,
      error_code: null,
    };

    expect(medicationAiAnalysisBelongsToReview(analysis, "review-1")).toBe(true);
    expect(medicationAiAnalysisBelongsToReview(analysis, "review-2")).toBe(false);
    expect(medicationAiAnalysisBelongsToReview({ ...analysis, id: "" }, "review-1")).toBe(false);
  });

  it("fails closed when a ready backend payload has no displayable draft", () => {
    const html = renderToStaticMarkup(
      <MedicationAiAnalysisSection
        review={review()}
        provider={{
          kind: "openai",
          status: "ready",
          external_calls_enabled: true,
          reason_code: "ready",
          model: "gpt-test",
        }}
        analysis={{
          id: "analysis-1",
          review_id: "review-1",
          status: "ready",
          requested_at: "2026-08-27T10:00:00Z",
          started_at: "2026-08-27T10:00:01Z",
          completed_at: "2026-08-27T10:00:02Z",
          provider: {
            kind: "openai",
            status: "ready",
            external_calls_enabled: true,
            reason_code: "ready",
            model: "gpt-test",
          },
          prompt_version: "medication-evidence-draft-v1",
          draft: null,
          error_code: null,
        }}
        loading={false}
        error={null}
        lang="ru"
        onCreate={() => undefined}
        onRetry={() => undefined}
      />,
    );

    expect(html).toContain("AI-результат имеет неполный формат");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Краткий вывод");
  });

  it("keeps an existing ready draft visible when a later refresh fails", () => {
    const html = renderToStaticMarkup(
      <MedicationAiAnalysisSection
        review={review()}
        provider={preview().ai_provider}
        analysis={{
          id: "analysis-1",
          review_id: "review-1",
          status: "ready",
          requested_at: "2026-08-27T10:00:00Z",
          started_at: "2026-08-27T10:00:01Z",
          completed_at: "2026-08-27T10:00:02Z",
          provider: preview().ai_provider,
          prompt_version: "medication-evidence-draft-v1",
          draft: review().draft,
          error_code: null,
        }}
        loading={false}
        error="Не удалось обновить статус AI-анализа."
        lang="ru"
        onCreate={() => undefined}
        onRetry={() => undefined}
      />,
    );

    expect(html).toContain("Не удалось обновить статус AI-анализа.");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Краткий вывод");
  });
});
