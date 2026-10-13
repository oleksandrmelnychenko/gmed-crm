import { describe, expect, it } from "vitest";
import { mergeSavedDraft, queuedDraftFields, scopedDraftPatch } from "./lead-request-autosave";

describe("cabinet autosave response reconciliation", () => {
  it("adopts a concurrent correction without erasing typing during the request", () => {
    const baseline = { name: "Anna", city: "Berlin", phone: "old" };
    const sent = { ...baseline, name: "Annette" };
    const current = { ...sent, phone: "typed during request" };
    const fresh = { ...sent, city: "Munich" };
    expect(mergeSavedDraft(current, sent, fresh, baseline, ["name"]))
      .toEqual({ name: "Annette", city: "Munich", phone: "typed during request" });
  });

  it("retains a rejected field while saving an independent valid field", () => {
    const baseline = { name: "Anna", date: "1980-01-01" };
    const draft = { name: "Annette", date: "3000-01-01" };
    expect(mergeSavedDraft(draft, draft, { ...baseline, name: "Annette" }, baseline, ["name"]))
      .toEqual(draft);
  });

  it("does not turn stale untouched values into edits when a queued request starts", () => {
    const fields = queuedDraftFields({ phone: "next" }, { phone: "next" });
    expect(scopedDraftPatch({ phone: "next", city: "Berlin" }, fields)).toEqual({ phone: "next" });
  });

  it("queues a deliberate return to the saved value while the first edit is in flight", () => {
    const fields = queuedDraftFields({}, { name: "Anna" });
    expect(scopedDraftPatch({ name: "Anna" }, fields)).toEqual({ name: "Anna" });
  });

  it("reconciles array values and keeps newer array edits", () => {
    const baseline = { countries: ["DE"], contact: ["email"] };
    const sent = { countries: ["DE", "AT"], contact: ["email"] };
    const current = { ...sent, contact: ["email", "phone"] };
    const fresh = { countries: ["AT", "DE"], contact: ["email"] };
    expect(mergeSavedDraft(current, sent, fresh, baseline, ["countries"]))
      .toEqual({ countries: ["AT", "DE"], contact: ["email", "phone"] });
  });

  it("rebases an untouched field against the value at execution when two replies correct it", () => {
    const snapshot = { city: "Berlin", phone: "new" };
    const baseline = { city: "Munich", phone: "old" };
    const fresh = { city: "Hamburg", phone: "new" };
    const current = { city: "Munich", phone: "new" };
    expect(mergeSavedDraft(current, snapshot, fresh, baseline, ["phone"], new Set(["phone"])))
      .toEqual(fresh);
    expect(mergeSavedDraft({ ...current, city: "Typed city" }, snapshot, fresh, baseline, ["phone"], new Set(["phone"])))
      .toEqual({ city: "Typed city", phone: "new" });
  });
});
