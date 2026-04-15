import { describe, expect, it } from "vitest";

describe("check-staff-spa-navigation stripTsCommentsForScan", () => {
  it("strips line comments so navigate( in comments is ignored", async () => {
    const { stripTsCommentsForScan } = await import(
      "../../scripts/staff-spa-navigation-shared.mjs"
    );
    const src = "const a = 1;\n// navigate(`/evil`)\nconst b = 2;";
    expect(stripTsCommentsForScan(src)).not.toContain("navigate");
  });

  it("strips block comments", async () => {
    const { stripTsCommentsForScan } = await import(
      "../../scripts/staff-spa-navigation-shared.mjs"
    );
    const src = "const x = 1; /* navigate(`/x`) */ const y = 2;";
    expect(stripTsCommentsForScan(src)).not.toContain("navigate");
  });
});
