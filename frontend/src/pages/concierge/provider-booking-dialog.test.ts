import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import {
  canBookConciergeService,
  conciergeBookingActionLabel,
  conciergeBookingErrorMessage,
} from "./provider-booking-dialog";

describe("concierge partner booking", () => {
  it("lets the CEO and the concierge book planned services and confirm requested bookings", () => {
    for (const role of ["ceo", "concierge"]) {
      expect(canBookConciergeService({ status: "planned", billing_status: "draft" }, role)).toBe(true);
      expect(canBookConciergeService({ status: "booked", billing_status: "draft" }, role)).toBe(true);
    }
  });

  it("offers no booking to other roles, for services past the booking or closed in billing", () => {
    for (const role of ["patient_manager", "ceo_assistant", "billing", "interpreter", null]) {
      expect(canBookConciergeService({ status: "planned", billing_status: "draft" }, role)).toBe(false);
    }
    for (const status of ["confirmed", "in_service", "completed", "cancelled"]) {
      expect(canBookConciergeService({ status, billing_status: "draft" }, "ceo")).toBe(false);
    }
    for (const billing of ["billed", "settled", "waived", "reversed"]) {
      expect(canBookConciergeService({ status: "planned", billing_status: billing }, "concierge")).toBe(false);
    }
  });

  it("names the action after the next step of the booking", () => {
    expect(conciergeBookingActionLabel("planned", "ru")).toBe("Забронировать у партнёра");
    expect(conciergeBookingActionLabel("booked", "ru")).toBe("Подтвердить бронь");
    expect(conciergeBookingActionLabel("planned", "de")).toBe("Beim Partner buchen");
    expect(conciergeBookingActionLabel("booked", "de")).toBe("Buchung bestätigen");
  });

  it("translates the server's booking refusals instead of showing English text", () => {
    const refused = (message: string, status = 409) => new ApiRequestError(message, { status });

    expect(conciergeBookingErrorMessage(refused("Service is already linked to a different provider"), "ru")).toBe(
      "Сервис уже связан с другим партнёром.",
    );
    expect(
      conciergeBookingErrorMessage(refused("Confirmed booking requires a reference, contact person, or note", 422), "de"),
    ).toBe("Für eine bestätigte Buchung ist eine Buchungsnummer, Kontaktperson oder Notiz erforderlich.");
    expect(conciergeBookingErrorMessage(refused("Insufficient permissions", 403), "ru")).toBe(
      "У вас нет прав бронировать этот сервис.",
    );
    expect(conciergeBookingErrorMessage(refused("Failed", 500), "ru")).toBe("Не удалось сохранить бронь.");
  });
});
