import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import { appointmentActionErrorMessage } from "./error-message";

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
