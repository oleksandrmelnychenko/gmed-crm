import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";
import type { MedicationIntelligenceResponse } from "@/lib/api/medication-intelligence";

import {
  MedicationIntelligencePanelContent,
  medicationIdentityWorkflowStatusForError,
  resolveMedicationIdentityIdempotencyKey,
} from "./medication-intelligence-panel";

function response(
  overrides: Partial<MedicationIntelligenceResponse> = {},
): MedicationIntelligenceResponse {
  return {
    mode: "open_sources_only",
    generated_at: "2026-08-26T10:00:00Z",
    disclaimer: { ru: "", de: "" },
    summary: {
      active_medications: 2,
      identified_medications: 1,
      unresolved_medications: 1,
      findings_total: 2,
      high_priority_findings: 1,
      missing_data_total: 1,
    },
    medications: [
      {
        id: "med-1",
        name: "Eliquis",
        substance: "Apixaban",
        status: "active",
        atc_code: "B01AF02",
        pzn: "12345678",
        country_code: "DE",
        identity_status: "verified",
      },
      {
        id: "med-2",
        name: "Unbekanntes Präparat",
        substance: null,
        status: "active",
        atc_code: null,
        pzn: null,
        country_code: "UA",
        identity_status: "unresolved",
      },
    ],
    findings: [
      {
        id: "finding-info",
        severity: "info",
        category: "identity_unresolved",
        title_ru: "Не удалось идентифицировать препарат",
        title_de: "Präparat konnte nicht identifiziert werden",
        detail_ru: "Нужно проверить торговое название.",
        detail_de: "Der Handelsname muss geprüft werden.",
        medication_ids: ["med-2"],
        evidence_refs: ["bfarm"],
        source_id: null,
        published_at: null,
        source_url: null,
        substances: [],
      },
      {
        id: "finding-high",
        severity: "high",
        category: "duplicate_substance",
        title_ru: "Возможное дублирование вещества",
        title_de: "Mögliche Wirkstoff-Dopplung",
        detail_ru: "Сигнал требует медицинской проверки.",
        detail_de: "Der Hinweis erfordert eine medizinische Prüfung.",
        medication_ids: ["med-1"],
        evidence_refs: ["bfarm"],
        source_id: null,
        published_at: null,
        source_url: null,
        substances: [],
      },
    ],
    missing_data: [
      {
        code: "egfr",
        label_ru: "Функция почек",
        label_de: "Nierenfunktion",
        reason_ru: "Нет актуального eGFR.",
        reason_de: "Kein aktueller eGFR-Wert.",
      },
    ],
    sources: [
      {
        id: "bfarm",
        label: "BfArM Arzneimittelinformationen",
        authority: "BfArM",
        kind: "official_reference",
        url: "https://www.bfarm.de/",
        machine_readable: false,
        ingestion_status: "manual_reference",
        health: "never",
        freshness_ttl_hours: null,
        last_attempt_at: null,
        last_error: null,
        last_successful_snapshot: null,
      },
    ],
    identity_permissions: {
      can_search_candidates: true,
      can_confirm_identity: true,
      reason_code: null,
    },
    ...overrides,
  };
}

describe("MedicationIntelligencePanelContent", () => {
  it("renders the compact clinical review with high severity first", () => {
    const html = renderToStaticMarkup(
      <MedicationIntelligencePanelContent data={response()} language="ru" />,
    );

    expect(html).toContain("Интеллектуальная проверка медикации");
    expect(html).toContain("Eliquis");
    expect(html).toContain("Apixaban");
    expect(html).toContain("B01AF02");
    expect(html).toContain("Функция почек");
    expect(html).toContain("BfArM Arzneimittelinformationen");
    expect(html).toContain("Активный");
    expect(html).not.toContain(">active<");
    expect(html.indexOf("Возможное дублирование вещества")).toBeLessThan(
      html.indexOf("Не удалось идентифицировать препарат"),
    );
  });

  it("never exposes the internal medication identity relation name", () => {
    const html = renderToStaticMarkup(
      <MedicationIntelligencePanelContent
        data={response({
          missing_data: [{
            code: "medication_identity",
            label_ru: "Идентификация препарата",
            label_de: "Arzneimittelidentifikation",
            reason_ru: "Нужен подтверждённый medication_drug_match либо проверенный ATC/PZN.",
            reason_de: "Bestätigter medication_drug_match erforderlich.",
          }],
        })}
        language="ru"
      />,
    );

    expect(html).toContain("Нужно подтвердить соответствие препарата");
    expect(html).not.toContain("medication_drug_match");
  });

  it("offers identity review only when the server capability permits it", () => {
    const allowed = renderToStaticMarkup(
      <MedicationIntelligencePanelContent
        data={response()}
        language="ru"
        onIdentifyMedication={() => undefined}
      />,
    );
    const denied = renderToStaticMarkup(
      <MedicationIntelligencePanelContent
        data={response({
          identity_permissions: {
            can_search_candidates: false,
            can_confirm_identity: false,
            reason_code: "role_not_allowed",
          },
        })}
        language="de"
        onIdentifyMedication={() => undefined}
      />,
    );

    expect(allowed).toContain("Идентифицировать");
    expect(denied).not.toContain("Identifizieren</button>");
  });

  it("maps HTTP 409 to the stale workflow and reuses one idempotency key per attempt", () => {
    expect(
      medicationIdentityWorkflowStatusForError(
        new ApiRequestError("stale", { status: 409 }),
      ),
    ).toBe("stale");
    expect(
      medicationIdentityWorkflowStatusForError(
        new ApiRequestError("failed", { status: 500 }),
      ),
    ).toBe("error");

    const first = resolveMedicationIdentityIdempotencyKey(null, () => "attempt-1");
    const retry = resolveMedicationIdentityIdempotencyKey(first, () => "attempt-2");
    expect(first).toBe("attempt-1");
    expect(retry).toBe("attempt-1");
  });

  it("shows the complete open-source safety disclaimer in the active language", () => {
    const german = renderToStaticMarkup(
      <MedicationIntelligencePanelContent data={response()} language="de" />,
    );
    const russian = renderToStaticMarkup(
      <MedicationIntelligencePanelContent data={response()} language="ru" />,
    );

    expect(russian).toContain("Проверка использует только открытые источники");
    expect(russian).toContain("не доказывает отсутствие взаимодействия");
    expect(russian).not.toContain("ausschließlich offene Quellen");
    expect(german).toContain("ausschließlich offene Quellen");
    expect(german).toContain("medizinische Prüfung");
    expect(german).not.toContain("Проверка использует только открытые источники");
    expect(german).toContain("Mögliche Wirkstoff-Dopplung");
  });

  it("labels source ingestion honestly and only links safe web URLs", () => {
    const unsafe = response({
      sources: [
        {
          id: "planned",
          label: "Planned source",
          authority: "Authority",
          kind: "feed",
          url: "javascript:alert(1)",
          machine_readable: true,
          ingestion_status: "planned",
          health: "never",
          freshness_ttl_hours: null,
          last_attempt_at: null,
          last_error: null,
          last_successful_snapshot: null,
        },
      ],
    });
    const html = renderToStaticMarkup(
      <MedicationIntelligencePanelContent data={unsafe} language="ru" />,
    );

    expect(html).toContain("Коннектор запланирован");
    expect(html).toContain("Машиночитаемый");
    expect(html).not.toContain("javascript:alert");
  });

  it("shows snapshot freshness, version, publication time, and update errors", () => {
    const provenance = response({
      sources: [
        {
          id: "fresh-source",
          label: "Fresh feed",
          authority: "BfArM",
          kind: "csv",
          url: "https://example.test/fresh",
          machine_readable: true,
          ingestion_status: "available",
          health: "fresh",
          freshness_ttl_hours: 24,
          last_attempt_at: "2026-08-26T10:00:00Z",
          last_error: null,
          last_successful_snapshot: {
            id: "snapshot-fresh",
            fetched_at: "2026-08-26T10:00:00Z",
            published_at: "2026-08-26T08:00:00Z",
            version: "2026.08.26",
            checksum_sha256: "0123456789abcdef0123456789abcdef",
            item_count: 184,
            source_url: "https://example.test/fresh.csv",
          },
        },
        {
          id: "stale-source",
          label: "Stale feed",
          authority: "G-BA",
          kind: "xml",
          url: "https://example.test/stale",
          machine_readable: true,
          ingestion_status: "available",
          health: "stale",
          freshness_ttl_hours: 12,
          last_attempt_at: "2026-08-25T10:00:00Z",
          last_error: null,
          last_successful_snapshot: {
            id: "snapshot-stale",
            fetched_at: "2026-08-24T10:00:00Z",
            published_at: null,
            version: null,
            checksum_sha256: "abc",
            item_count: null,
            source_url: "https://example.test/stale.xml",
          },
        },
        {
          id: "error-source",
          label: "Feed with failed refresh",
          authority: "PEI",
          kind: "rss",
          url: "https://example.test/error",
          machine_readable: true,
          ingestion_status: "available",
          health: "error",
          freshness_ttl_hours: 6,
          last_attempt_at: "2026-08-26T11:00:00Z",
          last_error: "upstream_timeout",
          last_successful_snapshot: {
            id: "snapshot-error",
            fetched_at: "2026-08-25T11:00:00Z",
            published_at: null,
            version: "42",
            checksum_sha256: "def",
            item_count: 7,
            source_url: "https://example.test/error.rss",
          },
        },
        {
          id: "planned-source",
          label: "Planned feed",
          authority: "EMA",
          kind: "api",
          url: "https://example.test/planned",
          machine_readable: true,
          ingestion_status: "planned",
          health: "never",
          freshness_ttl_hours: null,
          last_attempt_at: null,
          last_error: null,
          last_successful_snapshot: null,
        },
      ],
    });
    const html = renderToStaticMarkup(
      <MedicationIntelligencePanelContent data={provenance} language="ru" />,
    );

    expect(html).toContain("Актуальный снимок");
    expect(html).toContain("Снимок устарел");
    expect(html).toContain("Ошибка обновления · используется последний снимок");
    expect(html).toContain("Последний успешный снимок");
    expect(html).toContain("Версия");
    expect(html).toContain("2026.08.26");
    expect(html).toContain("Опубликовано");
    expect(html).toContain("184");
    expect(html).toContain("Источник не ответил вовремя");
    expect(html).not.toContain("upstream_timeout");
    expect(html).toContain("Последняя попытка");
    expect(html).toContain("Коннектор запланирован");
    expect(html).toContain("локальный снимок отсутствует");
    expect(html).toContain("Актуально");
    expect(html).toContain("Требуют внимания");
    expect(html).not.toMatch(/<details[^>]*\sopen(?:=|>)/);
    expect(html).not.toContain("Локально доступен");
  });

  it("localizes a known ingestion error in German and falls back safely for unknown codes", () => {
    const erroredSource = response({
      sources: [{
        id: "source-error",
        label: "Feed",
        authority: "BfArM",
        kind: "rss",
        url: "https://example.test/feed",
        machine_readable: true,
        ingestion_status: "error",
        health: "error",
        freshness_ttl_hours: 6,
        last_attempt_at: "2026-08-26T11:00:00Z",
        last_error: "invalid_feed",
        last_successful_snapshot: null,
      }],
    });
    const unknownError = response({
      sources: [{
        ...erroredSource.sources[0],
        last_error: "future_error_code",
      }],
    });

    const german = renderToStaticMarkup(
      <MedicationIntelligencePanelContent data={erroredSource} language="de" />,
    );
    const fallback = renderToStaticMarkup(
      <MedicationIntelligencePanelContent data={unknownError} language="ru" />,
    );

    expect(german).toContain("Der Quellen-Feed konnte nicht validiert werden");
    expect(german).not.toContain("invalid_feed");
    expect(fallback).toContain("Техническая причина не классифицирована");
    expect(fallback).not.toContain("future_error_code");
  });

  it("renders a sourced official safety alert without turning it into a treatment directive", () => {
    const alert = response({
      findings: [{
        id: "alert-1",
        severity: "warning",
        category: "official_safety_alert",
        title_ru: "Rote-Hand-Brief по препарату",
        title_de: "Rote-Hand-Brief zum Arzneimittel",
        detail_ru: "Опубликована новая информация безопасности.",
        detail_de: "Neue Sicherheitsinformationen wurden veröffentlicht.",
        medication_ids: ["med-1"],
        evidence_refs: ["source_item:alert-1", "source_snapshot:snapshot-1"],
        source_id: "bfarm",
        published_at: "2026-08-25T08:00:00Z",
        source_url: "https://www.bfarm.de/alert.pdf",
        substances: ["Apixaban"],
      }],
    });
    const html = renderToStaticMarkup(
      <MedicationIntelligencePanelContent data={alert} language="ru" />,
    );

    expect(html).toContain("BfArM Rote-Hand-Brief");
    expect(html).toContain("Rote-Hand-Brief по препарату");
    expect(html).toContain("Опубликовано");
    expect(html).toContain("Действующее вещество");
    expect(html).toContain("Apixaban");
    expect(html).toContain("BfArM Arzneimittelinformationen");
    expect(html).toContain("Открыть официальный документ");
    expect(html).toContain('href="https://www.bfarm.de/alert.pdf"');
    expect(html).toContain("не является указанием изменить лечение");
    expect(html).not.toContain("source_item:alert-1");
    expect(html).not.toContain("source_snapshot:snapshot-1");
  });

  it("does not expose an alert URL when source_id is absent from the evidence bundle", () => {
    const untrustedAlert = response({
      findings: [{
        id: "alert-untrusted",
        severity: "warning",
        category: "official_safety_alert",
        title_ru: "Неподтверждённый alert",
        title_de: "Nicht bestätigter Alert",
        detail_ru: "Требует проверки источника.",
        detail_de: "Die Quelle muss geprüft werden.",
        medication_ids: [],
        evidence_refs: ["source_item:unknown"],
        source_id: "missing-source",
        published_at: null,
        source_url: "https://malicious.example/pretend-official.pdf",
        substances: ["Unknown"],
      }],
    });
    const html = renderToStaticMarkup(
      <MedicationIntelligencePanelContent data={untrustedAlert} language="ru" />,
    );

    expect(html).toContain("Источник не подтверждён");
    expect(html).not.toContain("Открыть официальный документ");
    expect(html).not.toContain("malicious.example");
  });

  it("renders loading, error, and empty states without implying a clean interaction check", () => {
    const loading = renderToStaticMarkup(
      <MedicationIntelligencePanelContent loading language="ru" />,
    );
    const error = renderToStaticMarkup(
      <MedicationIntelligencePanelContent error="Ошибка загрузки" language="ru" />,
    );
    const empty = renderToStaticMarkup(
      <MedicationIntelligencePanelContent
        data={response({
          summary: {
            active_medications: 0,
            identified_medications: 0,
            unresolved_medications: 0,
            findings_total: 0,
            high_priority_findings: 0,
            missing_data_total: 0,
          },
          medications: [],
          findings: [],
          missing_data: [],
        })}
        language="ru"
      />,
    );

    expect(loading).toContain("Загружаем проверку медикации");
    expect(error).toContain("Ошибка загрузки");
    expect(empty).toContain("Нет данных для проверки");
    expect(empty).toContain("не доказывает отсутствие взаимодействия");
  });
});
