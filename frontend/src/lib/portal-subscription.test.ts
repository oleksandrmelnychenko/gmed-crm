import { describe, expect, it } from "vitest";
import {
  canRequestPortalService,
  hasPortalSubscription,
  isPortalRouteLocked,
  isPortalSubscriptionPaused,
  isTariffPortalRoute,
} from "./portal-subscription";
import { listPatientPortalNavItems } from "./staff-route-access";

const user = { role: "patient", portal_mode: "patient" as const, patients: [
  { id: "mother", name: "Parent", patient_number: "P1", has_active_subscription: false },
  { id: "child", name: "Child", patient_number: "P2", has_active_subscription: true },
] };

describe("paused subscription (owner decision 2026-11-10)", () => {
  const paused = { role: "patient", portal_mode: "patient" as const, patients: [
    { id: "p", name: "Paused", patient_number: "P9", has_active_subscription: false, subscription_paused: true },
  ] };

  it("is no active subscription, but is told apart from having none", () => {
    expect(hasPortalSubscription(paused, "p")).toBe(false);
    expect(isPortalSubscriptionPaused(paused, "p")).toBe(true);
    expect(isPortalSubscriptionPaused(paused, null)).toBe(true);
    expect(isPortalSubscriptionPaused(user, "mother")).toBe(false);
    expect(isPortalSubscriptionPaused(user, "child")).toBe(false);
    expect(isPortalSubscriptionPaused({ ...paused, portal_mode: "lead" }, "p")).toBe(false);
    expect(isPortalSubscriptionPaused({ role: "ceo" }, null)).toBe(false);
  });

  it("keeps every page and the chat open, but no new concierge request", () => {
    for (const item of listPatientPortalNavItems()) {
      expect(isPortalRouteLocked(paused, "p", item.to), item.to).toBe(false);
    }
    expect(canRequestPortalService(paused, "p")).toBe(false);
  });
});

describe("tariff is optional (owner decision 9, 2026-11-13)", () => {
  it("locks only the team chat without a tariff", () => {
    const locked = listPatientPortalNavItems({ leadRequests: true })
      .filter((item) => isPortalRouteLocked(user, "mother", item.to)).map((item) => item.to);
    expect(locked).toEqual(["/chat"]);
    for (const path of ["/", "/appointments", "/services", "/notifications", "/subscriptions", "/documents", "/invoices"]) {
      expect(isPortalRouteLocked(user, "mother", path), path).toBe(false);
    }
    expect(isTariffPortalRoute("/chat/x")).toBe(true);
    expect(isTariffPortalRoute("/chatter")).toBe(false);
    expect(canRequestPortalService(user, "mother")).toBe(false);
  });

  it("opens the chat and new requests with the tariff of the selected person", () => {
    expect(isPortalRouteLocked(user, "child", "/chat")).toBe(false);
    expect(canRequestPortalService(user, "child")).toBe(true);
    expect(isPortalRouteLocked({ role: "ceo" }, null, "/chat")).toBe(false);
  });
});

describe("patient subscription access", () => {
  it("knows no subscription for a converted patient without one, including missing metadata", () => {
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
});
