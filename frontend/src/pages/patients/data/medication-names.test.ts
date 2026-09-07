import { describe, expect, it, vi } from "vitest";
import { checkMedicationPair, fetchMedicationNames, uniqueMedicationCounterpart } from "./medication-names";
import { apiFetch } from "@/lib/api";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

describe("saved medication names", () => {
  it("does not treat a malformed dictionary review as permission to learn names", async () => {
    for (const result of [[], {}, { known_pair: false }, { known_pair: false, handelsname: { exact: null, similar: [5] }, wirkstoff: { exact: null, similar: [] } }]) {
      vi.mocked(apiFetch).mockResolvedValue(result);
      await expect(checkMedicationPair({ handelsname: "Brand", wirkstoff: "Substance" })).rejects.toThrow("Invalid medication pair review");
    }
  });
  it("only auto-fills a complete, unambiguous result", () => {
    expect(uniqueMedicationCounterpart({ items: ["Name A"], has_more: false })).toBe("Name A");
    expect(uniqueMedicationCounterpart({ items: [], has_more: false })).toBeNull();
    expect(uniqueMedicationCounterpart({ items: ["A", "B"], has_more: false })).toBeNull();
    expect(uniqueMedicationCounterpart({ items: ["A"], has_more: true })).toBeNull();
  });

  it("encodes both names and reads fresh suggestions after a medication save", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: ["Example"], has_more: false });
    await fetchMedicationNames("handelsname", "Тест +", "A & B");
    const [path, options] = vi.mocked(apiFetch).mock.calls.at(-1)!;
    const params = new URL(`https://test${path}`).searchParams;
    expect(params.get("field")).toBe("handelsname");
    expect(params.get("q")).toBe("Тест +");
    expect(params.get("related")).toBe("A & B");
    expect(options?.cache).toBe("no-store");
  });

  it("rejects incomplete responses instead of assuming a unique match", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: ["Example"] });
    await expect(fetchMedicationNames("wirkstoff")).rejects.toThrow("Invalid medication name suggestions");
  });
});
