import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import { appointmentActionErrorMessage } from "./error-message";
import { appointmentText } from "./labels";

describe("appointmentActionErrorMessage", () => {
  it("does not expose an English backend message", () => {
    const error = new ApiRequestError("Only approved requests can be converted", {
      status: 409,
      code: "Conflict",
    });

    expect(appointmentActionErrorMessage(error, "Не удалось сохранить")).toBe(
      "Не удалось сохранить",
    );
  });

  it("localizes the server rejection of a completion before the appointment date", () => {
    const error = new ApiRequestError(
      "Appointment cannot be completed before its date",
      {
        status: 422,
        code: "Unprocessable Entity",
        body: {
          error: "Unprocessable Entity",
          message: "Appointment cannot be completed before its date",
          code: "appointment_completion_before_date",
        },
      },
    );

    const message = appointmentActionErrorMessage(error, "Не удалось сохранить");

    expect(message).not.toBe("Не удалось сохранить");
    expect(message).not.toContain("before its date");
    expect(message).not.toBe("appointments_status_completion_not_before_date");
    expect(message).toBe(
      appointmentText("appointments_status_completion_not_before_date"),
    );
  });

  it("keeps the fallback for unknown or inherited body codes", () => {
    for (const code of ["constructor", "something_else", 42]) {
      const error = new ApiRequestError("Rejected", {
        status: 422,
        body: { code },
      });
      expect(appointmentActionErrorMessage(error, "Fallback")).toBe("Fallback");
    }
  });

  it("keeps localized transport and local validation messages", () => {
    expect(
      appointmentActionErrorMessage(
        new ApiRequestError("Netzwerkfehler", { code: "network" }),
        "Speichern fehlgeschlagen",
      ),
    ).toBe("Netzwerkfehler");
    expect(
      appointmentActionErrorMessage(
        new Error("Заполните дату"),
        "Не удалось сохранить",
      ),
    ).toBe("Заполните дату");
  });
});
