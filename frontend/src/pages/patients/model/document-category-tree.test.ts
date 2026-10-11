import { describe, expect, it } from "vitest";

import { orderCategoryTree } from "./document-category-tree";

describe("orderCategoryTree", () => {
  // Sort orders as the migrations write them: levels share number ranges.
  const categories = [
    { key: "administrative", parent_key: null, sort_order: 10 },
    { key: "finance", parent_key: null, sort_order: 30 },
    { key: "medical", parent_key: null, sort_order: 40 },
    { key: "personal", parent_key: null, sort_order: 50 },
    { key: "translation", parent_key: null, sort_order: 60 },
    { key: "other", parent_key: null, sort_order: 100 },
    { key: "consent", parent_key: "administrative", sort_order: 16 },
    { key: "lab_analysis", parent_key: "medical", sort_order: 20 },
    { key: "medical_report", parent_key: "medical", sort_order: 30 },
    { key: "invoice", parent_key: "finance", sort_order: 34 },
    { key: "medical_schreiben", parent_key: "medical", sort_order: 50 },
    { key: "treatment_plan", parent_key: "medical", sort_order: 60 },
    { key: "medical_radiology", parent_key: "medical", sort_order: 407 },
    { key: "medical_ct", parent_key: "medical_radiology", sort_order: 54 },
    { key: "identity", parent_key: "personal", sort_order: 70 },
    { key: "personal_passport", parent_key: "personal", sort_order: 71 },
    { key: "portal_upload", parent_key: "other", sort_order: 90 },
  ];

  it("puts every child under its own parent (QA 2026-10-11 B-12)", () => {
    const ordered = orderCategoryTree(categories);
    expect(ordered.map((category) => `${"-".repeat(category.depth)}${category.key}`)).toEqual([
      "administrative",
      "-consent",
      "finance",
      "-invoice",
      "medical",
      "-lab_analysis",
      "-medical_report",
      "-medical_schreiben",
      "-treatment_plan",
      "-medical_radiology",
      "--medical_ct",
      "personal",
      "-identity",
      "-personal_passport",
      "translation",
      "other",
      "-portal_upload",
    ]);
  });

  it("keeps a category whose parent is unknown on the top level", () => {
    const ordered = orderCategoryTree([
      { key: "medical", parent_key: null, sort_order: 40 },
      { key: "conclusion", parent_key: "gone", sort_order: 30 },
      { key: "current_value", sort_order: -1 },
    ]);
    expect(ordered.map((category) => [category.key, category.depth])).toEqual([
      ["current_value", 0],
      ["conclusion", 0],
      ["medical", 0],
    ]);
  });

  it("shows every category once even with a parent cycle", () => {
    const ordered = orderCategoryTree([
      { key: "a", parent_key: "b", sort_order: 1 },
      { key: "b", parent_key: "a", sort_order: 2 },
    ]);
    expect(ordered.map((category) => category.key).sort()).toEqual(["a", "b"]);
  });
});
