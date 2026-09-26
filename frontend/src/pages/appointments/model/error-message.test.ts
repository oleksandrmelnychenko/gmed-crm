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

  it("localizes the server rejection of a report submitted or approved before the date", () => {
    const error = new ApiRequestError(
      "Interpreter reports cannot be approved before the appointment date",
      {
        status: 422,
        code: "Unprocessable Entity",
        body: { code: "appointment_report_before_date" },
      },
    );

    const message = appointmentActionErrorMessage(error, "Fallback");

    expect(message).not.toBe("Fallback");
    expect(message).not.toBe("appointments_report_not_before_date");
    expect(message).toBe(appointmentText("appointments_report_not_before_date"));
  });

  it("localizes the server rejection of a report for an unconfirmed appointment", () => {
    const error = new ApiRequestError(
      "Interpreter reports are only available for confirmed, in-progress or completed appointments",
      {
        status: 409,
        body: { code: "appointment_report_status_not_open" },
      },
    );

    expect(appointmentActionErrorMessage(error, "Fallback")).toBe(
      appointmentText("appointments_report_requires_confirmed_appointment"),
    );
    expect(
      appointmentText("appointments_report_requires_confirmed_appointment"),
    ).not.toBe("appointments_report_requires_confirmed_appointment");
  });

  it("localizes the server rejection of moving a reported appointment to a future date", () => {
    const error = new ApiRequestError(
      "An appointment with an interpreter report cannot be moved to a future date",
      {
        status: 422,
        body: { code: "appointment_reported_future_date" },
      },
    );

    expect(appointmentActionErrorMessage(error, "Fallback")).toBe(
      appointmentText("appointments_reported_not_to_future_date"),
    );
    expect(appointmentText("appointments_reported_not_to_future_date")).not.toBe(
      "appointments_reported_not_to_future_date",
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
