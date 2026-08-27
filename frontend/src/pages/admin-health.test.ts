import { describe, expect, it } from "vitest";

import {
  aiHealthCopy,
  aiLeaseAttention,
  aiReasonLabel,
  aiStatusLabel,
  normalizeMedicationAiHealth,
} from "./admin-health";

describe("Medication AI health localization", () => {
  it("localizes provider, operational and reason codes in Russian and German", () => {
    const ru = aiHealthCopy("ru");
    const de = aiHealthCopy("de");

    expect(aiStatusLabel("healthy", ru)).toBe("Стабильно");
    expect(aiStatusLabel("attention", de)).toBe("Prüfung erforderlich");
    expect(aiReasonLabel("data_transfer_not_approved", ru)).toBe("Передача данных не согласована");
    expect(aiReasonLabel("api_key_missing", de)).toBe("Server-Schlüssel fehlt");
  });

  it("never exposes an unknown backend status or reason code", () => {
    const ru = aiHealthCopy("ru");
    const de = aiHealthCopy("de");

    expect(aiStatusLabel("future_backend_status", ru)).toBe("Недоступно");
    expect(aiStatusLabel("future_backend_status", de)).toBe("Nicht verfügbar");
    expect(aiReasonLabel("future_backend_reason", ru)).toBe("Недоступно");
    expect(aiReasonLabel("future_backend_reason", de)).toBe("Nicht verfügbar");
  });

  it("keeps lease recovery and exhaustion visible without identifiers", () => {
    const ru = aiHealthCopy("ru");
    const de = aiHealthCopy("de");

    expect(aiLeaseAttention(2, 1, ru)).toEqual([
      "AI-задачи повторно поставлены в очередь после истечения lease: 2",
      "AI-задачи завершились ошибкой после исчерпания lease-попыток: 1",
    ]);
    expect(aiLeaseAttention(1, 0, de)).toEqual([
      "KI-Aufträge nach abgelaufener Lease wieder eingeplant: 1",
    ]);
    expect(aiLeaseAttention(0, 0, ru)).toEqual([]);
  });

  it("defaults new lease fields during a mixed-version rollout", () => {
    const normalized = normalizeMedicationAiHealth({
      operational_status: "healthy",
      queue: { requested: 3 },
    });

    expect(normalized.queue.requested).toBe(3);
    expect(normalized.queue.lease_recovered_last_24h).toBe(0);
    expect(normalized.queue.lease_exhausted_last_24h).toBe(0);
    expect(normalized.queue.last_lease_recovery_at).toBeNull();
    expect(normalized.queue.last_lease_exhausted_at).toBeNull();
  });
});
