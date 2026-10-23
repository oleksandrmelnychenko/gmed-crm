import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import {
  LEAD_SELF_DISCLOSURE_TEMPLATE,
  leadSelfDisclosureAvailable,
  leadSelfDisclosureErrorText,
  leadSelfDisclosureRequirement,
  leadSelfDisclosureRecordedByGmed,
  leadSelfDisclosureRequirementLabel,
  leadSelfDisclosureSourceNote,
  leadSelfDisclosureUnavailableHint,
} from "./lead-self-disclosure";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

describe("the lead's patient form", () => {
  it("is the template the server fills from the sent request", () => {
    expect(LEAD_SELF_DISCLOSURE_TEMPLATE).toBe("lead_self_disclosure");
  });

  it("can be generated once the lead sent the request, or from the data staff recorded (owner decision 2026-10-23)", () => {
    expect(leadSelfDisclosureAvailable({ submitted_at: "2026-10-07T08:30:00Z" })).toBe(true);
    expect(leadSelfDisclosureAvailable({ submitted_at: "2026-10-07T08:30:00Z", fill_mode: "patient" })).toBe(true);
    // The patient fills the cabinet: only after sending.
    expect(leadSelfDisclosureAvailable({ submitted_at: null, fill_mode: "patient" })).toBe(false);
    // Staff fill the data in ("Заполняю сам", the default): from the lead's data.
    expect(leadSelfDisclosureAvailable({ submitted_at: null, fill_mode: "staff" })).toBe(true);
    expect(leadSelfDisclosureAvailable({ submitted_at: null })).toBe(true);
    expect(leadSelfDisclosureRecordedByGmed({ submitted_at: null, fill_mode: "staff" })).toBe(true);
    expect(leadSelfDisclosureRecordedByGmed({ submitted_at: "2026-10-07T08:30:00Z", fill_mode: "staff" })).toBe(false);
    expect(leadSelfDisclosureRecordedByGmed(null)).toBe(false);
    expect(leadSelfDisclosureSourceNote({ submitted_at: null, fill_mode: "staff" }, de)).toContain("Angaben aufgenommen durch GMED");
    expect(leadSelfDisclosureSourceNote({ submitted_at: null, fill_mode: "staff" }, ru)).toContain("создайте анкету заново");
    expect(leadSelfDisclosureSourceNote({ submitted_at: "2026-10-07T08:30:00Z" }, de)).toContain("Angaben aus dem Portal");
    expect(leadSelfDisclosureAvailable(null)).toBe(false);
    expect(leadSelfDisclosureAvailable(undefined)).toBe(false);
    expect(leadSelfDisclosureAvailable({ submitted_at: "2026-10-07T08:30:00Z", changed_since_submit: true })).toBe(false);
    expect(leadSelfDisclosureAvailable({ submitted_at: "2026-10-07T08:30:00Z", changed_since_submit: false })).toBe(true);
  });

  it("asks for resubmission when the answers have changed", () => {
    const error = new ApiRequestError("Conflict", { status: 409, body: { code: "lead_request_changed_since_submit" } });
    expect(leadSelfDisclosureErrorText(error, de)).toContain("erneut gesendet");
    expect(leadSelfDisclosureErrorText(error, ru)).toContain("повторной отправки");
  });

  it("explains the server's refusal before sending in the user's language", () => {
    const refusal = new ApiRequestError("Conflict", {
      status: 409,
      code: "lead_request_not_sent",
      body: { error: "lead_request_not_sent", code: "lead_request_not_sent" },
    });
    expect(leadSelfDisclosureErrorText(refusal, ru)).toContain("после того, как пациент отправил заявку");
    expect(leadSelfDisclosureErrorText(refusal, de)).toContain("erst erstellt werden, wenn der Patient die Anfrage");
    const onlyError = new ApiRequestError("Conflict", { status: 409, body: { error: "lead_request_not_sent" } });
    expect(leadSelfDisclosureErrorText(onlyError, de)).not.toBeNull();
  });

  it("says why it cannot be generated yet: it comes from the cabinet data", () => {
    expect(leadSelfDisclosureUnavailableHint({ submitted_at: "2026-10-07T08:30:00Z" }, ru)).toBeNull();
    expect(leadSelfDisclosureUnavailableHint(null, ru)).toContain("из данных кабинета");
    expect(leadSelfDisclosureUnavailableHint({ submitted_at: null, fill_mode: "patient" }, de)).toContain("noch nicht gesendet");
    expect(leadSelfDisclosureUnavailableHint({ submitted_at: null, fill_mode: "patient" }, ru)).toContain("«Заполняю сам»");
    expect(leadSelfDisclosureUnavailableHint({ submitted_at: null, fill_mode: "staff" }, de)).toBeNull();
    expect(
      leadSelfDisclosureUnavailableHint({ submitted_at: "2026-10-07T08:30:00Z", changed_since_submit: true }, de),
    ).toContain("erneuten Senden");
  });

  it("is required or optional as the server's readiness check says (owner decision 2026-10-23)", () => {
    const check = (required?: boolean) => [
      { key: "confidentiality_release_signed" },
      { key: "self_disclosure_signed", required },
    ];
    expect(leadSelfDisclosureRequirement(check(true))).toBe("required");
    expect(leadSelfDisclosureRequirement(check(false))).toBe("optional");
    expect(leadSelfDisclosureRequirement(check(undefined))).toBeNull();
    expect(leadSelfDisclosureRequirement([])).toBeNull();
    expect(leadSelfDisclosureRequirement(undefined)).toBeNull();
    expect(leadSelfDisclosureRequirementLabel("required", ru)).toBe("Обязательно: первичное оформление нового пациента");
    expect(leadSelfDisclosureRequirementLabel("optional", de)).toBe("Optional: Folgeauftrag");
  });

  it("leaves other errors to the usual wording", () => {
    const other = new ApiRequestError("Conflict", { status: 409, body: { error: "lead_converted" } });
    expect(leadSelfDisclosureErrorText(other, ru)).toBeNull();
    expect(leadSelfDisclosureErrorText(new Error("lead_request_not_sent"), ru)).toBeNull();
    expect(leadSelfDisclosureErrorText(null, ru)).toBeNull();
  });
});
