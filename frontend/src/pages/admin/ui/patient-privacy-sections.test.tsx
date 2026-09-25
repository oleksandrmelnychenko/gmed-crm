import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PatientPrivacySections } from "./patient-privacy-sections";

function sectionKeys(patientId: string, canManageConsents: boolean) {
  const fragment = PatientPrivacySections({ patientId, canManageConsents }) as ReactElement<{
    children: unknown[];
  }>;
  return fragment.props.children.filter(isValidElement).map((child) => child.key);
}

function count(html: string, needle: string) {
  return html.split(needle).length - 1;
}

describe("PatientPrivacySections", () => {
  it("keys the consent and recipient sections differently for the same patient", () => {
    const keys = sectionKeys("patient-1", true);
    expect(keys).toEqual(["consents:patient-1", "recipients:patient-1"]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("renders the consent form exactly once", () => {
    const html = renderToStaticMarkup(
      <PatientPrivacySections patientId="patient-1" canManageConsents />,
    );
    expect(count(html, 'id="consent-type"')).toBe(1);
    expect(count(html, 'id="consent-note"')).toBe(1);
    expect(count(html, 'data-testid="patient-recipients"')).toBe(1);
  });

  it("omits consents for roles that cannot manage them and everything without a patient", () => {
    expect(sectionKeys("patient-1", false)).toEqual(["recipients:patient-1"]);
    expect(renderToStaticMarkup(<PatientPrivacySections patientId="" canManageConsents />)).toBe("");
  });
});
