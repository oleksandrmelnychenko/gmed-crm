import { describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import { ru } from "@/lib/i18n/ru";

import {
  actionLabel,
  actionTone,
  activityViewQuery,
  entityTypeLabel,
  isAccessActivity,
  isAiActivityAction,
} from "./admin-activity";

describe("Every server audit action has a label (QA E-14)", () => {
  // The actions the QA run saw as "Неизвестное значение".
  const qaActions = [
    "view_patient",
    "update_invoice_status",
    "sanctions_gate_blocked",
    "update_lead",
    "download_document",
    "payer_assigned",
    "set_order_payer",
    "lead_risk_status",
    "lead_portal_update_personal_data",
    "personnel_document_archived",
    "gwg_staff_training_created",
    "gwg_staff_training_signed",
    "create_sop",
    "create_invoice",
    "personnel_employee_created",
  ];

  it("names them in Russian and German", () => {
    for (const action of qaActions) {
      const labelRu = actionLabel(action, ru);
      const labelDe = actionLabel(action, de);
      expect(labelRu, action).not.toBe(ru.common_unknown_value);
      expect(labelRu, action).toMatch(/[А-Яа-яЁё]/);
      expect(labelDe, action).not.toBe(de.common_unknown_value);
      expect(labelDe, action).not.toContain("_");
    }
    expect(actionLabel("view_patient", ru)).toBe("Карта пациента открыта");
    expect(actionLabel("update_invoice_status", de)).toBe("Rechnungsstatus geändert");
  });

  it("shows a code added later humanised, never as unknown", () => {
    expect(actionLabel("brand_new_server_action", ru)).toBe("Brand new server action");
  });

  it("names the audit entity types", () => {
    expect(entityTypeLabel("security_incident", ru)).toBe("Инцидент с данными");
    expect(entityTypeLabel("personnel", de)).toBe("Personalakte");
    expect(entityTypeLabel("sanctions_hit", ru)).toBe("Совпадение с санкционным списком");
    expect(entityTypeLabel("gwg_staff_training", de)).toBe("GwG-Unterweisung");
    expect(entityTypeLabel("token_family", ru)).toBe("Сессия");
    expect(entityTypeLabel("lead", ru)).toBe("Лид");
    expect(entityTypeLabel("new_entity_kind", de)).toBe("New entity kind");
  });
});

describe("Access and roles activity view", () => {
  it("sends the access category on top of the meaningful-activity view", () => {
    expect(activityViewQuery("access")).toEqual({ view: "activity", category: "access" });
    expect(activityViewQuery("security")).toEqual({ view: "security" });
    expect(activityViewQuery("activity")).toEqual({ view: "activity" });
  });

  it("keeps only account, role and permission changes when filtering locally", () => {
    for (const action of [
      "create_user",
      "update_user",
      "deactivate_user",
      "activate_user",
      "reset_password",
      "totp_reset",
      "update_access_policy",
      "update_staff_user_access",
    ]) {
      expect(isAccessActivity({ action })).toBe(true);
    }
    expect(isAccessActivity({ action: "login_success" })).toBe(false);
    expect(isAccessActivity({ action: "read_patient" })).toBe(false);
    expect(isAccessActivity({ action: "http_request" })).toBe(false);
  });

  it("labels the view in Russian and German", () => {
    expect(ru.activity_view_access).toBe("Доступ и роли");
    expect(de.activity_view_access).toBe("Zugriff und Rollen");
  });
});

describe("Status-change activity localization", () => {
  it("names privacy, document, signature, import and account status changes", () => {
    expect(actionLabel("privacy_request_executed", ru)).toBe("Запрос по защите данных выполнен");
    expect(actionLabel("processing_restriction_lifted", de)).toBe(
      "Einschränkung der Verarbeitung aufgehoben",
    );
    expect(actionLabel("document_signature_withdrawn", de)).toBe("Signaturanfrage zurückgezogen");
    expect(actionLabel("clinical_document_import_retried", ru)).toBe("Импорт документа перезапущен");
    expect(actionLabel("deactivate_user", ru)).toBe("Пользователь деактивирован");
    expect(actionLabel("security_incident_reported", de)).toBe("Datenschutzvorfall gemeldet");
  });
});

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
