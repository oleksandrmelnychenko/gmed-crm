import { describe, expect, it } from "vitest";

import { withoutUnchangedClientFormAnswers } from "./lead-wizard";

describe("wizard autosave and the client's form", () => {
  it("leaves out client's-form answers the wizard did not change (QA 2026-11-10)", () => {
    const payload = {
      first_name: "Dorothea",
      has_insurance: null,
      insurance_type: null,
      phone: "+49 30 1234567",
      middle_name: "",
    };
    // Staff answered «Нет» in the client's form; the wizard's draft still holds the old empty
    // answer it loaded: it must not send it back over the stored one.
    const known = { has_insurance: null, insurance_type: null, phone: "+49 30 1234567", middle_name: "" };
    expect(withoutUnchangedClientFormAnswers(payload, known)).toEqual({ first_name: "Dorothea" });
    // A value staff changed in the wizard is sent.
    expect(withoutUnchangedClientFormAnswers({ ...payload, has_insurance: true }, known)).toMatchObject({ has_insurance: true });
    // Nothing known yet (a new lead): everything goes.
    expect(withoutUnchangedClientFormAnswers(payload, null)).toEqual(payload);
  });
});
