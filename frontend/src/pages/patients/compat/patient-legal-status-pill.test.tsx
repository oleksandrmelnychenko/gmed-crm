import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LegalStatusPill } from "../ui/shared/legal-status-pill";

const completeStatus = {
  dsgvoSigned: true,
  confidentialityReleaseSigned: true,
  identityVerified: true,
  documentPackComplete: true,
  complianceCompleted: true,
  contractStatus: "signed",
  notes: "",
};

describe("LegalStatusPill", () => {
  it("renders the ready state only when all five checklist items are done", () => {
    const html = renderToStaticMarkup(<LegalStatusPill status={completeStatus} />);

    expect(html).toContain("Готов");
    expect(html).toContain("border-emerald-200");
  });

  it("renders a partial state when compliance is done but another item is missing", () => {
    const html = renderToStaticMarkup(
      <LegalStatusPill
        status={{
          ...completeStatus,
          confidentialityReleaseSigned: false,
        }}
      />
    );

    expect(html).toContain("4/5 выполнено");
    expect(html).toContain("border-amber-200");
    expect(html).not.toContain("Готов");
  });
});
