import { describe, expect, it } from "vitest";

import { acceptedDefaultNo, disclosureChanged, disclosureDraft } from "./lead-trusted-persons-model";
import type { LeadRequest } from "./lead-request-api";

const request = (extra: Partial<LeadRequest> = {}) => ({
  disclosure: null,
  disclosure_company_name: null,
  trusted_persons: [],
  consent_form: null,
  submitted_at: null,
  ...extra,
}) as unknown as LeadRequest;

describe("the «No» shown by default (DEV 2026-10-27)", () => {
  it("is saved as the person's answer when they leave the step", () => {
    const base = request();
    const shown = disclosureDraft(base);
    expect(shown.allowDisclosure).toBe(false);
    expect(disclosureChanged(shown, base)).toBe(false);
    const leaving = acceptedDefaultNo(shown, base);
    expect(leaving.answered).toBe(true);
    expect(disclosureChanged(leaving, base)).toBe(true);
  });

  it("is not saved for a sent request or over a stored decision", () => {
    const sent = request({ submitted_at: "2026-10-27T10:47:10Z" } as Partial<LeadRequest>);
    expect(acceptedDefaultNo(disclosureDraft(sent), sent).answered).toBeFalsy();
    const decided = request({ disclosure: { allow_disclosure: false, consent_given: false } } as Partial<LeadRequest>);
    expect(acceptedDefaultNo(disclosureDraft(decided), decided).answered).toBeFalsy();
  });

  it("leaves an open «Yes» draft as it is", () => {
    const base = request();
    const yes = { ...disclosureDraft(base), allowDisclosure: true };
    expect(acceptedDefaultNo(yes, base)).toBe(yes);
  });
});
