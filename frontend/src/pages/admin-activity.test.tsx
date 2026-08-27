import { describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import { ru } from "@/lib/i18n/ru";

import { actionLabel, actionTone, isAiActivityAction } from "./admin-activity";

describe("Medication AI activity localization", () => {
  it("uses exact Russian and German labels for every AI lifecycle action", () => {
    expect(actionLabel("create_medication_ai_analysis", ru)).toBe("Запрошен AI-черновик");
    expect(actionLabel("medication_ai_analysis_requested", de)).toBe("KI-Entwurf eingereiht");
    expect(actionLabel("medication_ai_analysis_ready", ru)).toBe("AI-черновик готов");
    expect(actionLabel("medication_ai_analysis_failed", de)).toBe("KI-Entwurf fehlgeschlagen");
    expect(actionLabel("retry_medication_ai_analysis", ru)).toBe("Повторно запущен AI-черновик");
  });

  it("localizes evidence package actions instead of exposing raw action codes", () => {
    expect(actionLabel("preview_medication_evidence_review", ru)).toBe(
      "Открыт предпросмотр пакета доказательств",
    );
    expect(actionLabel("medication_evidence_review_created", de)).toBe(
      "Evidenzpaket erstellt",
    );
  });

  it("marks AI actions and assigns meaningful status tones", () => {
    expect(isAiActivityAction("medication_ai_analysis_ready")).toBe(true);
    expect(isAiActivityAction("medication_evidence_review_created")).toBe(false);
    expect(actionTone("medication_ai_analysis_requested")).toBe("brand");
    expect(actionTone("medication_ai_analysis_ready")).toBe("success");
    expect(actionTone("medication_ai_analysis_failed")).toBe("error");
    expect(actionTone("patient.medication_ai_analysis_ready")).toBe("success");
    expect(actionLabel("patient.medication_ai_analysis_ready", de)).toBe(
      "Patient: KI-Entwurf bereit",
    );
  });
});
