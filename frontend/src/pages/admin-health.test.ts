import { describe, expect, it } from "vitest";

import { aiHealthCopy, aiReasonLabel, aiStatusLabel } from "./admin-health";

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
});
