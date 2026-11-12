import { describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import { ru } from "@/lib/i18n/ru";

import {
  actionLabel,
  actionTone,
  activityActionOptions,
  activityLabelMatches,
  activityViewQuery,
  entityDisplay,
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

describe("Activity log after the QA of 2026-11-10 (E F-7)", () => {
  // Shown as humanised English ("Credit transferred out") in the Russian log.
  const qaActions = [
    "lead_uncounted_parent_acknowledged",
    "credit_transferred_out",
    "credit_transferred_in",
    "lead_portal_consent_choices_saved",
    "lead_portal_trusted_persons_saved",
    "lead_portal_representative_country_questions",
    "staff_upload_representative_identity",
    "update_lead_representative_details",
    "lead_portal_update_services",
    "update_lead_invoice_recipient",
    // The other server actions that had no label on that day.
    "staff_upload_representative_authority",
    "lead_portal_follow_up_submit",
    "lead_portal_plan_requested",
    "payer_link_prepared",
    "supersede_quote",
    "update_quote_status",
    "delete_agency_service",
    "unassign_interpreter",
    "release_appointment_to_portal",
    "reset_order_client_signature",
    "waive_external_invoice_rebilling",
    "privacy_request_requeued",
    "revoke_guardian_patient_access",
    "link_request_login_to_patient",
  ];

  it("names the actions in Russian and German", () => {
    for (const action of qaActions) {
      const labelRu = actionLabel(action, ru);
      const labelDe = actionLabel(action, de);
      expect(labelRu, action).toMatch(/[А-Яа-яЁё]/);
      expect(labelRu, action).not.toMatch(/^[A-Za-z ]+$/);
      expect(labelDe, action).not.toContain("_");
      expect(labelDe.toLowerCase(), action).not.toBe(action.replace(/_/g, " "));
    }
    expect(actionLabel("credit_transferred_out", ru)).toBe("Кредит перенесён с этого счёта");
    expect(actionLabel("update_lead_invoice_recipient", de)).toBe("Rechnungsempfänger des Leads geändert");
  });

  it("names the affected account instead of an id fragment", () => {
    const id = "649d7b93-5a88-426f-b93f-c34bc8e19638";
    expect(entityDisplay("user", id, ru, "QA-E Manager Eins edited")).toBe(
      "Пользователь: QA-E Manager Eins edited",
    );
    expect(entityDisplay("user", id, de, "  ")).toBe("Benutzer 649d7b93…");
    expect(entityDisplay("user", id, ru)).toBe("Пользователь 649d7b93…");
    expect(entityDisplay("user", id, ru, null)).toBe("Пользователь 649d7b93…");
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

describe("activity log objects and search by label (QA E3-01)", () => {
  it("names provider catalogue objects instead of English codes", () => {
    expect(entityTypeLabel("provider_service", ru)).toBe("Услуга провайдера");
    expect(entityTypeLabel("provider_doctor", ru)).toBe("Врач провайдера");
    expect(entityTypeLabel("provider_doctor", de)).toBe("Arzt beim Anbieter");
  });

  it("says Portal in German, never Kabinett", () => {
    expect(actionLabel("lead_portal_update_payer_declaration", de)).toBe("Portal: Angaben zum Zahler geändert");
    expect(actionLabel("create_lead_portal_account", de)).toBe("Zugang zum Lead-Portal angelegt");
  });

  it("sends the codes whose shown label matches the search text", () => {
    const ruMatches = activityLabelMatches("Неудачн", ru);
    expect(ruMatches.actions).toContain("login_failure");
    expect(activityLabelMatches("Fehlgeschlagene Anm", de).actions).toContain("login_failure");
    expect(activityLabelMatches("Услуга провайдера", ru).entities).toContain("provider_service");
    // Raw codes are matched by the server already; short texts match nothing.
    expect(activityLabelMatches("login_failure", ru).actions).not.toContain("login_failure");
    expect(activityLabelMatches("Не", ru)).toEqual({ actions: [], entities: [] });
    expect(activityLabelMatches("Заметка", ru).actions.length).toBeLessThanOrEqual(120);
  });
});

describe("Action filter options come from the stored codes (screens QA E F2/F11)", () => {
  it("offers each stored code once and joins codes with the same label", () => {
    const options = activityActionOptions(
      ["create_custom_field", "login_failure", "login_failed", "create_custom_field"],
      ru,
    );
    const values = options.map((option) => option.value);
    expect(values).toContain("create_custom_field");
    expect(values).toContain("login_failed,login_failure");
    const labels = options.map((option) => option.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("keeps a selected filter selectable", () => {
    const options = activityActionOptions([], ru, "create_lead");
    expect(options).toEqual([{ value: "create_lead", label: actionLabel("create_lead", ru) }]);
  });
});
