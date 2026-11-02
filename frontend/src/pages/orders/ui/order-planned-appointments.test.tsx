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

  it("marks an appointment the patient does not see", () => {
    expect(renderToStaticMarkup(<HiddenFromPatientMarker lang="ru" />)).toContain(
      "не видно пациенту",
    );
    expect(renderToStaticMarkup(<HiddenFromPatientMarker lang="de" />)).toContain(
      "für Patienten nicht sichtbar",
    );
  });
});
