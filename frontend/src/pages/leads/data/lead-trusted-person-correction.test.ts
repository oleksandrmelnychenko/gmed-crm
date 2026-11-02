import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ calls: [] as { path: string; init: RequestInit | undefined }[] }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  apiFetch: async (path: string, init?: RequestInit) => {
    api.calls.push({ path, init });
    return { trusted_persons: [], action: "corrected" };
  },
}));

import { normalizeConsentRecipients } from "../model/lead-portal-consents";
import { correctLeadTrustedPerson } from "./lead-portal-intake-api";

afterEach(() => {
  api.calls = [];
});

const stored = {
  name: "Oma Doppelpass", relation: "relative", phone: "+49 30 5550100",
  birth_date: "1955-09-09", citizenships: ["KZ", "DE"], scope_codes: ["medical"],
};

describe("staff correct a cabinet person with citizenships (QA round 14, C1-1)", () => {
  it("keeps the stored citizenships when the cabinet list is loaded", () => {
    const [person] = normalizeConsentRecipients([{ ...stored, citizenships: ["kz", "DE", "DE", 7] }]);
    expect(person?.citizenships).toEqual(["KZ", "DE"]);
    const [clinic] = normalizeConsentRecipients([{ name: "Praxis Dr. Mitte", relation: "clinic" }]);
    expect(clinic).not.toHaveProperty("citizenships");
  });

  it("sends the citizenships with the base and the corrected person", async () => {
    const [current] = normalizeConsentRecipients([stored]);
    if (!current) throw new Error("person expected");
    await correctLeadTrustedPerson("lead-1", 0, current, { ...current, phone: "+49 30 5550177" }, "Neue Nummer");
    await correctLeadTrustedPerson("lead-1", 0, current, null, "Widerruf");
    expect(api.calls.map((call) => call.path)).toEqual([
      "/leads/lead-1/trusted-persons/0",
      "/leads/lead-1/trusted-persons/0",
    ]);
    const [corrected, withdrawn] = api.calls.map((call) => JSON.parse(String(call.init?.body)));
    expect(corrected.base).toEqual({
      name: "Oma Doppelpass", relation: "relative", phone: "+49 30 5550100",
      birth_date: "1955-09-09", citizenships: ["KZ", "DE"], scope_codes: ["medical"],
    });
    expect(corrected.person.citizenships).toEqual(["KZ", "DE"]);
    expect(corrected.person.phone).toBe("+49 30 5550177");
    expect(withdrawn.base.citizenships).toEqual(["KZ", "DE"]);
    expect(withdrawn.person).toBeNull();
  });
});
