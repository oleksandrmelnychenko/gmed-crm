import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";
import { appointmentTypeOptionsForRole } from "@/pages/appointments/model/constants";
import {
  appointmentActionErrorMessage,
  CONCIERGE_APPOINTMENT_TYPE_FORBIDDEN_CODE,
} from "@/pages/appointments/model/error-message";
import { blankAppointmentFormForCurrentUser } from "@/pages/appointments/model/form-factories";
import { attentionIssueLabel } from "@/pages/appointments/model/labels";
import { conciergeTasksVisibleToActor, type ConciergeTask } from "@/pages/concierge/model";
import { conciergeBookingMissingHint } from "@/pages/concierge/provider-booking-dialog";
import { canShareDocumentWithRole } from "@/pages/documents/model/document-model";
import { localizeProviderResourceDescription } from "@/pages/employees/staff-access-model";
import { feedbackReviewNeedsEdit } from "@/pages/feedback/model/feedback-model";
import { specializationLabelForItem, specializationLabelForValue } from "@/pages/providers/model/specialization-labels";
import { providerPeopleShortCodes } from "@/pages/providers/ui/provider-people-catalog";
import { activePackages } from "@/pages/services-agency-catalog.model";

describe("system-D operations fixes (QA 2026-11-12)", () => {
  it("F1: a concierge is offered and preset only the appointment types it may create", () => {
    expect(appointmentTypeOptionsForRole("concierge")).toEqual(["non_medical", "internal"]);
    expect(appointmentTypeOptionsForRole("patient_manager")).toEqual(["medical", "non_medical", "internal"]);
    expect(blankAppointmentFormForCurrentUser("c-1", "concierge").appointmentType).toBe("non_medical");
    expect(blankAppointmentFormForCurrentUser("pm-1", "patient_manager").appointmentType).toBe("medical");
  });

  it("F1: the server refusal of a medical appointment for the concierge is translated", () => {
    const error = new ApiRequestError("Concierge can only create non-medical or internal appointments", {
      status: 403,
      code: CONCIERGE_APPOINTMENT_TYPE_FORBIDDEN_CODE,
    });
    const message = appointmentActionErrorMessage(error, "Не удалось создать приём.");
    expect(message).toContain("Консьерж");
    expect(message).not.toContain("Concierge can only");
  });

  it("F2: the share picker keeps only roles the server accepts for the document", () => {
    const medicalInternal = { data_sensitivity: "Medical", visibility: "internal" };
    const medicalReleased = { data_sensitivity: "Medical", visibility: "released_internal" };
    expect(canShareDocumentWithRole("interpreter", medicalInternal)).toBe(false);
    expect(canShareDocumentWithRole("interpreter", medicalReleased)).toBe(true);
    expect(canShareDocumentWithRole("concierge", medicalReleased)).toBe(false);
    expect(canShareDocumentWithRole("teamlead_interpreter", medicalReleased)).toBe(false);
    expect(canShareDocumentWithRole("patient_manager", medicalInternal)).toBe(true);
    expect(canShareDocumentWithRole("ceo", medicalInternal)).toBe(true);
    expect(canShareDocumentWithRole("concierge", { data_sensitivity: "Service", visibility: "internal" })).toBe(true);
    expect(canShareDocumentWithRole("it_admin", { data_sensitivity: "General", visibility: "internal" })).toBe(false);
  });

  it("F3: the booking dialog names what keeps «Сохранить бронь» disabled", () => {
    expect(conciergeBookingMissingHint({ providerId: "p", startsAt: "", address: "Berlin" }, "ru"))
      .toBe("Чтобы сохранить, заполните: Начало");
    expect(conciergeBookingMissingHint({ providerId: "", startsAt: "", address: " " }, "de"))
      .toBe("Zum Speichern fehlt: Partner, Beginn, Serviceadresse");
    expect(conciergeBookingMissingHint({ providerId: "p", startsAt: "2026-11-14T19:00", address: "x" }, "ru")).toBe("");
  });

  it("F4: «Проверено» on a submitted entry is a change of its own", () => {
    expect(feedbackReviewNeedsEdit({ status: "submitted" }, "reviewed")).toBe(false);
    expect(feedbackReviewNeedsEdit({ status: "reviewed" }, "reviewed")).toBe(true);
    expect(feedbackReviewNeedsEdit(null, "reviewed")).toBe(true);
  });

  it("F5: an interpreter's board keeps the project tasks the server shares with him", () => {
    const rows = [
      { id: "own", assigned_to: "me", assigned_by: "pm", project_id: null },
      { id: "project", assigned_to: "other", assigned_by: "pm", project_id: "project-1" },
      { id: "foreign", assigned_to: "other", assigned_by: "pm", project_id: null },
    ] as unknown as ConciergeTask[];
    expect(conciergeTasksVisibleToActor(rows, "me", "interpreter").map((task) => task.id)).toEqual([
      "own",
      "project",
    ]);
  });

  it("F6: people with a shared id prefix get distinct short ids", () => {
    const codes = providerPeopleShortCodes([
      "c1000000-0000-0000-0000-000000000001",
      "c1000000-0000-0000-0000-000000000002",
      "4935cc9f-154b-42c8-bdaa-5ac66e84c0f8",
    ]);
    expect(codes.get("c1000000-0000-0000-0000-000000000001")).toBe("00000001");
    expect(codes.get("c1000000-0000-0000-0000-000000000002")).toBe("00000002");
    expect(codes.get("4935cc9f-154b-42c8-bdaa-5ac66e84c0f8")).toBe("4935CC9F");
  });

  it("F7: Russian plurals for open points", () => {
    expect(attentionIssueLabel(1)).toBe("открытый пункт");
    expect(attentionIssueLabel(2)).toBe("открытых пункта");
    expect(attentionIssueLabel(5)).toBe("открытых пунктов");
  });

  it("F7: «Vorsorge» reads in Russian", () => {
    expect(specializationLabelForValue("Vorsorge", [], "ru")).toBe("Профилактика");
    expect(
      specializationLabelForItem(
        { code: "innere_medizin_vorsorge", name_de: "Innere Medizin / Vorsorge", name_ru: "Innere Medizin / Vorsorge" },
        "ru",
      ),
    ).toBe("Внутренние болезни / профилактика");
    expect(
      specializationLabelForItem(
        { code: "innere_medizin_vorsorge", name_de: "Innere Medizin / Vorsorge", name_ru: "Innere Medizin / Vorsorge" },
        "de",
      ),
    ).toBe("Innere Medizin / Vorsorge");
  });

  it("F7: a provider's country in the access sheet follows the UI language", () => {
    expect(localizeProviderResourceDescription("Berlin · Germany", "ru")).toBe("Berlin · Германия");
    expect(localizeProviderResourceDescription("Berlin · Germany", "de")).toBe("Berlin · Deutschland");
    expect(localizeProviderResourceDescription("", "ru")).toBe("");
  });

  it("F8: packages with the same name are told apart, a repeated description is dropped", () => {
    const rows = activePackages([
      { id: "1", package_key: "portal-b", name: "Synthetic Portal Subscription", description: "Synthetic Portal Subscription", items: [] },
      { id: "2", package_key: "portal-a", name: "Synthetic Portal Subscription", items: [] },
      { id: "3", package_key: "vip", name: "VIP", description: "Alles inklusive", items: [] },
    ]);
    expect(rows.map((row) => row.label)).toEqual([
      "Synthetic Portal Subscription · portal-a",
      "Synthetic Portal Subscription · portal-b",
      "VIP",
    ]);
    expect(rows.map((row) => row.shownDescription)).toEqual(["", "", "Alles inklusive"]);
  });
});
