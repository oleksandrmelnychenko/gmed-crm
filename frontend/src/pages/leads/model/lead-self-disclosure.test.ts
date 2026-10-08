import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import {
  LEAD_SELF_DISCLOSURE_TEMPLATE,
  leadSelfDisclosureAvailable,
  leadSelfDisclosureErrorText,
} from "./lead-self-disclosure";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

describe("the lead's patient form", () => {
  it("is the template the server fills from the sent request", () => {
    expect(LEAD_SELF_DISCLOSURE_TEMPLATE).toBe("lead_self_disclosure");
  });

  it("can be generated only once the lead sent the request", () => {
    expect(leadSelfDisclosureAvailable({ submitted_at: "2026-10-07T08:30:00Z" })).toBe(true);
    expect(leadSelfDisclosureAvailable({ submitted_at: null })).toBe(false);
    expect(leadSelfDisclosureAvailable(null)).toBe(false);
    expect(leadSelfDisclosureAvailable(undefined)).toBe(false);
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

  it("leaves other errors to the usual wording", () => {
    const other = new ApiRequestError("Conflict", { status: 409, body: { error: "lead_converted" } });
    expect(leadSelfDisclosureErrorText(other, ru)).toBeNull();
    expect(leadSelfDisclosureErrorText(new Error("lead_request_not_sent"), ru)).toBeNull();
    expect(leadSelfDisclosureErrorText(null, ru)).toBeNull();
  });
});
