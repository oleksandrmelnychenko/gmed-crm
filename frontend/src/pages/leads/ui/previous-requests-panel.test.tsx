import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PreviousRequest } from "../model/use-previous-requests";
import { PreviousRequestsPanel } from "./previous-requests-panel";

const tx = (ru: string) => ru;
const request = (id: string, concern: string, extra: Partial<PreviousRequest> = {}): PreviousRequest => ({
  id,
  created_at: "2026-03-01T09:00:00Z",
  concern,
  specialties: ["radiologie"],
  order_number: null,
  date_from: null,
  date_to: null,
  ...extra,
});

function render(requests: PreviousRequest[], currentConcern = "") {
  return renderToStaticMarkup(
    <PreviousRequestsPanel
      requests={requests}
      currentConcern={currentConcern}
      tx={tx}
      specialtyLabel={(value) => (value === "radiologie" ? "Радиология" : value)}
      onUse={() => undefined}
    />,
  );
}

describe("PreviousRequestsPanel", () => {
  it("renders nothing when the patient has no earlier requests", () => {
    expect(render([])).toBe("");
  });

  it("shows date, order, period, specialty and reason of an earlier request", () => {
    const html = render([
      request("a", "Knee pain", { order_number: "A-20260301-0001", date_from: "2026-03-02", date_to: "2026-03-06" }),
    ]);
    expect(html).toContain("01.03.2026 · A-20260301-0001 · 02.03.2026 – 06.03.2026 · Радиология");
    expect(html).toContain("Knee pain");
    expect(html).toContain(">Взять<");
  });

  it("marks the reason that is already in the field and disables taking it again", () => {
    const html = render([request("a", "Knee pain")], "  Knee pain ");
    expect(html).toContain("Уже в поле");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Уже в поле/);
  });

  it("shows three requests and offers to expand the rest", () => {
    const html = render(["a", "b", "c", "d"].map((id) => request(id, `Reason ${id}`)));
    expect(html).toContain("Reason c");
    expect(html).not.toContain("Reason d");
    expect(html).toContain("Показать все (4)");
  });
});
