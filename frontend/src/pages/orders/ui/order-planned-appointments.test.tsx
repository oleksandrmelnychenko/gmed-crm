import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HiddenFromPatientMarker, PlanReleaseButton } from "./order-planned-appointments";

describe("plan release controls", () => {
  it("offers the release with the count of hidden appointments", () => {
    const ru = renderToStaticMarkup(
      <PlanReleaseButton count={3} busy={false} lang="ru" onRelease={() => {}} />,
    );
    expect(ru).toContain("Показать план пациенту (3)");
    expect(ru).not.toContain('disabled=""');

    const de = renderToStaticMarkup(
      <PlanReleaseButton count={1} busy lang="de" onRelease={() => {}} />,
    );
    expect(de).toContain("Plan dem Patienten zeigen (1)");
    expect(de).toContain('disabled=""');
  });

  it("shows nothing when the patient already sees the whole plan", () => {
    expect(
      renderToStaticMarkup(
        <PlanReleaseButton count={0} busy={false} lang="ru" onRelease={() => {}} />,
      ),
    ).toBe("");
  });

  it("holds the release while grid visits are not created yet", () => {
    const held = renderToStaticMarkup(
      <PlanReleaseButton count={2} busy={false} lang="ru" pendingDrafts={3} onRelease={() => {}} />,
    );
    expect(held).toContain("Сначала создайте приёмы (3)");
    expect(held).toContain('data-testid="order-plan-release-blocker"');
    expect(held).toContain('disabled=""');

    // Nothing released yet, only drafts: the blocker still says why.
    const draftsOnly = renderToStaticMarkup(
      <PlanReleaseButton count={0} busy={false} lang="de" pendingDrafts={1} onRelease={() => {}} />,
    );
    expect(draftsOnly).toContain("Erst Termine anlegen (1)");
    expect(draftsOnly).toContain('disabled=""');

    const free = renderToStaticMarkup(
      <PlanReleaseButton count={2} busy={false} lang="ru" pendingDrafts={0} onRelease={() => {}} />,
    );
    expect(free).not.toContain("order-plan-release-blocker");
    expect(free).not.toContain('disabled=""');
  });

  it("marks an appointment the patient does not see", () => {
    expect(renderToStaticMarkup(<HiddenFromPatientMarker lang="ru" />)).toContain(
      "не видно пациенту",
    );
    expect(renderToStaticMarkup(<HiddenFromPatientMarker lang="de" />)).toContain(
      "für Patienten nicht sichtbar",
    );
  });
});
