import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";
import { de } from "@/lib/i18n/de";
import { ru } from "@/lib/i18n/ru";

import { knownTwoFactorError, twoFactorErrorMessage } from "./two-factor-errors";

const refused = (status: number, message: string) =>
  new ApiRequestError(message, { status, code: "Unauthorized", body: { error: "Unauthorized", message } });

describe("2FA refusals in the UI language", () => {
  it("translates every sentence of routes/totp.rs the setup can meet", () => {
    expect(twoFactorErrorMessage(refused(401, "Sign in again"), ru)).toBe("Сеанс входа истёк. Войдите снова.");
    expect(twoFactorErrorMessage(refused(422, "The code does not match"), de)).toBe("Der Code stimmt nicht.");
    expect(twoFactorErrorMessage(refused(409, "Two-factor authentication is already active"), ru)).toBe(
      "Двухфакторный вход уже настроен.",
    );
    expect(twoFactorErrorMessage(refused(409, "Start the enrolment first"), de)).toContain("Einrichtung");
    expect(twoFactorErrorMessage(refused(404, "No second factor enrolled"), ru)).toBe(
      "У сотрудника нет подключённого второго фактора.",
    );
  });

  it("shows the generic text for server failures, keeps translated client texts", () => {
    expect(twoFactorErrorMessage(refused(500, "Failed to start enrolment"), ru)).toBe(ru.uiText.twofactor_error_generic);
    expect(twoFactorErrorMessage(new Error("Сеть недоступна"), ru)).toBe("Сеть недоступна");
    expect(knownTwoFactorError(new Error("something else"), ru)).toBeNull();
  });
});
