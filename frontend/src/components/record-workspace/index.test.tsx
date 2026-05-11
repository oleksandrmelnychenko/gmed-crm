import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CountBadge } from "./primitives/count-badge";
import { tokens } from "./primitives/design-tokens";
import { toneForStatus } from "./primitives/status-tones";
import { InfoRow } from "./recipes/info-row";
import { StatusBadge } from "./recipes/status-badge";
import { TabShell } from "./shells/tab-shell";

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
    expect(html).toContain('aria-label="Изменить Country"');
  });
});
