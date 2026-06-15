import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SheetActionsFooter } from "@/components/admin-page-patterns";
import { Field } from "./workspace-primitives";

describe("Field", () => {
  it("renders a visible required marker next to required labels", () => {
    const html = renderToStaticMarkup(
      <Field required label="Patient">
        <input />
      </Field>,
    );

    expect(html).toContain("Patient");
    expect(html).toContain("aria-hidden=\"true\"");
    expect(html).toContain("*");
  });
});

describe("SheetActionsFooter", () => {
  it("renders submit errors in the action footer", () => {
    const html = renderToStaticMarkup(
      <SheetActionsFooter error="Patient: required">
        <button type="submit">Create</button>
      </SheetActionsFooter>,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Patient: required");
    expect(html).toContain("Create");
  });
});
