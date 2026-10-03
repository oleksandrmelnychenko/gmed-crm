import { describe, expect, it } from "vitest";

import {
  canIssueLeadPortalPassword,
  leadPortalStatus,
  patientMessageLanguage,
  portalCredentialsMessage,
} from "./lead-portal-access";

const account = {
  user_id: "u1",
  is_active: true,
  password_change_pending: true,
  last_login_at: null,
};

describe("leadPortalStatus", () => {
  it("follows the login from creation to an own password", () => {
    expect(leadPortalStatus(null)).toBe("none");
    expect(leadPortalStatus(undefined)).toBe("none");
    expect(leadPortalStatus(account)).toBe("never_logged_in");
    expect(leadPortalStatus({ ...account, last_login_at: "2026-10-03T12:00:00Z" })).toBe(
      "password_pending",
    );
    expect(
      leadPortalStatus({
        ...account,
        last_login_at: "2026-10-03T12:00:00Z",
        password_change_pending: false,
      }),
    ).toBe("active");
  });

  it("reports a switched-off login whatever it did before", () => {
    expect(
      leadPortalStatus({ ...account, is_active: false, last_login_at: "2026-10-03T12:00:00Z" }),
    ).toBe("disabled");
  });
});

describe("canIssueLeadPortalPassword", () => {
  it("is limited to the CEO and patient managers", () => {
    expect(canIssueLeadPortalPassword("ceo")).toBe(true);
    expect(canIssueLeadPortalPassword("patient_manager")).toBe(true);
    for (const role of ["sales", "ceo_assistant", "billing", "it_admin", "patient", null]) {
      expect(canIssueLeadPortalPassword(role)).toBe(false);
    }
  });
});

describe("portalCredentialsMessage", () => {
  it("writes the message in the patient's language with login and password", () => {
    const message = portalCredentialsMessage({
      firstName: "Olena",
      email: "olena@example.com",
      password: "Kq7-mP2x",
      loginUrl: "https://app.example/login",
      language: patientMessageLanguage("uk-UA"),
    });
    expect(message).toContain("Вітаємо, Olena!");
    expect(message).toContain("Логін: olena@example.com");
    expect(message).toContain("Одноразовий пароль: Kq7-mP2x");
    expect(message).toContain("https://app.example/login");
  });

  it("falls back to German", () => {
    expect(patientMessageLanguage(null)).toBe("de");
    expect(patientMessageLanguage("tr")).toBe("de");
    expect(patientMessageLanguage("EN")).toBe("en");
  });
});

describe("portal e-mail conflicts", () => {
  it("names the owner of a taken address instead of a generic conflict", async () => {
    const { leadErrorMessage } = await import("./leads-model");
    const error = Object.assign(new Error("Email already belongs to an account"), {
      status: 409,
      body: {
        code: "portal_email_taken",
        owner: {
          name: "Anna Müller",
          role: "patient",
          lead_id: null,
          lead_name: null,
          patient_id: "p1",
          patient_code: "P-00123",
          patient_name: "Anna Müller",
        },
      },
    });
    expect(leadErrorMessage(error, (ru) => ru)).toBe(
      "Этот адрес уже используется: Anna Müller · пациент P-00123. Укажите другую электронную почту",
    );
    expect(leadErrorMessage(error, (_ru, de) => de)).toContain("Anna Müller · Patient P-00123");
  });

  it("describes staff owners with their role", async () => {
    const { portalEmailOwnerLabel } = await import("./lead-portal-access");
    expect(
      portalEmailOwnerLabel(
        { name: "Max Muster", role: "sales", lead_id: null, lead_name: null, patient_id: null, patient_code: null, patient_name: null },
        "ru",
      ),
    ).toBe("Max Muster · сотрудник (продажи)");
  });
});
