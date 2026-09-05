import { describe, expect, it } from "vitest"
import { hasFormChanges } from "./form-changes"

describe("form changes", () => {
  it("ignores object key order but detects nested values", () => {
    expect(hasFormChanges({ name: "A", contact: { email: "a", active: true } }, {
      contact: { active: true, email: "a" }, name: "A",
    })).toBe(false)
    expect(hasFormChanges({ contact: { email: "b" } }, { contact: { email: "a" } })).toBe(true)
  })

  it("detects adding, deleting and reordering rows without input events", () => {
    const initial = [{ id: "a", text: "First" }, { id: "b", text: "Second" }]
    expect(hasFormChanges([...initial].reverse(), initial)).toBe(true)
    expect(hasFormChanges(initial.slice(1), initial)).toBe(true)
    expect(hasFormChanges([...initial, { id: "c", text: "" }], initial)).toBe(true)
    expect(hasFormChanges(initial.map((row) => ({ ...row })), initial)).toBe(false)
  })
})
