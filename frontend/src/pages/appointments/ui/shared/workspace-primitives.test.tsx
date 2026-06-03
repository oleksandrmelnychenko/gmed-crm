import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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
