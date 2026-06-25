import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProviderStatusPill } from "./provider-status-pill";

const labels = {
  common_active: "Активен",
  common_inactive: "Неактивен",
};

describe("ProviderStatusPill", () => {
  it("renders active and inactive statuses with the shared rounded pill pattern", () => {
    const activeHtml = renderToStaticMarkup(
      <ProviderStatusPill active labels={labels} />,
    );
    const inactiveHtml = renderToStaticMarkup(
      <ProviderStatusPill active={false} labels={labels} />,
    );

    expect(activeHtml).toContain('data-provider-status-pill="active"');
    expect(activeHtml).toContain("rounded-full");
    expect(activeHtml).toContain("border-emerald-500/25");
    expect(activeHtml).toContain("Активен");

    expect(inactiveHtml).toContain('data-provider-status-pill="inactive"');
    expect(inactiveHtml).toContain("border-rose-500/25");
    expect(inactiveHtml).toContain("Неактивен");
  });
});
