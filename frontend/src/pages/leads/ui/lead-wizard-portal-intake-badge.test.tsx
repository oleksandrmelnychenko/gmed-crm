import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PatientFieldBadge } from "./lead-wizard-portal-intake";

const tx = (ru: string) => ru;

describe("the marker of a field from the client's form", () => {
  it("names staff for their own entries and the patient otherwise (owner 2026-10-30)", () => {
    const staff = renderToStaticMarkup(<PatientFieldBadge marker={{ at: null, access_kind: "staff" }} tx={tx} />);
    expect(staff).toContain("внёс сотрудник");
    expect(staff).not.toContain("от пациента");
    const own = renderToStaticMarkup(<PatientFieldBadge marker={{ at: null, access_kind: "self" }} tx={tx} />);
    expect(own).toContain("от пациента");
  });
});
