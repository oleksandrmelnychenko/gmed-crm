import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CountBadge, InfoRow, StatusBadge, TabShell, tokens, toneForStatus } from "./index";

describe("record-workspace", () => {
  it("re-exports the shared design contract", () => {
    expect(tokens.radius.md).toBe("rounded-xl");
    expect(toneForStatus("cancelled")).toBe("error");
  });

  it("renders extracted recipes without changing behavior", () => {
    const html = renderToStaticMarkup(
      <TabShell>
        <StatusBadge status="active">Active</StatusBadge>
        <CountBadge>3</CountBadge>
        <InfoRow label="Country" value="Germany" onEdit={() => {}} />
      </TabShell>,
    );

    expect(html).toContain("space-y-4");
    expect(html).toContain("Active");
    expect(html).toContain('aria-label="Edit Country"');
  });
});
