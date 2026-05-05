import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InfoRow } from "./ui-shell";

describe("InfoRow", () => {
  it("uses an explicit edit label when provided", () => {
    const html = renderToStaticMarkup(
      <InfoRow
        label="Nationality"
        value="Germany"
        onEdit={() => {}}
        editLabel="Edit nationality"
      />,
    );

    expect(html).toContain('aria-label="Edit nationality"');
  });

  it("falls back to a field-specific label", () => {
    const html = renderToStaticMarkup(
      <InfoRow label="Nationality" value="Germany" onEdit={() => {}} />,
    );

    expect(html).toContain('aria-label="Изменить Nationality"');
  });
});
