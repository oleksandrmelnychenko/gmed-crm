import { describe, expect, it } from "vitest";
import { EMPTY_PAYER_DECLARATION_FORM, withPayerDeclarationField, type PayerDeclarationForm } from "./lead-payer";

const informed: PayerDeclarationForm = {
  ...EMPTY_PAYER_DECLARATION_FORM, kind: "third_party", payerTypeSupport: "supported",
  firstName: "Eva", lastName: "Muster", birthDate: "1980-01-01", payerInformed: true,
};

describe("staff payer identity and information confirmation", () => {
  it("requires a new confirmation for a different person, birth date, type or organisation", () => {
    expect(withPayerDeclarationField(informed, "firstName", "Anna").payerInformed).toBe(false);
    expect(withPayerDeclarationField(informed, "lastName", "Neu").payerInformed).toBe(false);
    expect(withPayerDeclarationField(informed, "birthDate", "1981-01-01").payerInformed).toBe(false);
    const company = { ...informed, payerType: "company" as const, organisationName: "Example GmbH" };
    expect(withPayerDeclarationField(informed, "payerType", "company").payerInformed).toBe(false);
    expect(withPayerDeclarationField(company, "organisationName", "Other GmbH").payerInformed).toBe(false);
  });

  it("keeps the confirmation for an address correction and permits explicitly informing the new payer", () => {
    expect(withPayerDeclarationField(informed, "city", "Berlin").payerInformed).toBe(true);
    expect(withPayerDeclarationField(informed, "firstName", " Eva ").payerInformed).toBe(true);
    const changed = withPayerDeclarationField(informed, "firstName", "Anna");
    expect(withPayerDeclarationField(changed, "payerInformed", true).payerInformed).toBe(true);
  });
});
