import { describe, expect, it } from "vitest";
import { hasPortalSubscription, isBasicPortalRoute } from "./portal-subscription";
import { listPatientPortalNavItems } from "./staff-route-access";

const user = { role: "patient", portal_mode: "patient" as const, patients: [
  { id: "mother", name: "Parent", patient_number: "P1", has_active_subscription: false },
  { id: "child", name: "Child", patient_number: "P2", has_active_subscription: true },
] };

describe("patient subscription access", () => {
  it("locks a converted patient without a subscription, including missing metadata", () => {
    expect(hasPortalSubscription(user, "mother")).toBe(false);
    expect(hasPortalSubscription({ role: "patient", patients: [{ id: "old", name: "Old", patient_number: "P3" }] }, "old")).toBe(false);
    expect(hasPortalSubscription({ role: "patient", portal_mode: "lead", patients: user.patients }, "child")).toBe(false);
  });
  it("does not borrow another family member's subscription or guess an ambiguous patient", () => {
    expect(hasPortalSubscription(user, "child")).toBe(true);
    expect(hasPortalSubscription(user, "mother")).toBe(false);
    expect(hasPortalSubscription(user, null)).toBe(false);
    expect(hasPortalSubscription(user, "revoked")).toBe(false);
    expect(hasPortalSubscription({ ...user, patients: [user.patients[1]] }, null)).toBe(true);
    expect(hasPortalSubscription({ role: "ceo" }, null)).toBe(true);
  });
  it("leaves exactly the basic records, account and existing request available in the navigation", () => {
    const allowed = listPatientPortalNavItems({ leadRequests: true })
      .filter((item) => isBasicPortalRoute(item.to)).map((item) => item.id);
    expect(allowed).toEqual(["lead_request", "documents", "invoices", "privacy", "account", "legal"]);
    expect(isBasicPortalRoute("/documents/a")).toBe(true);
    expect(isBasicPortalRoute("/documents-extra")).toBe(false);
    expect(isBasicPortalRoute("/")).toBe(false);
  });
});
