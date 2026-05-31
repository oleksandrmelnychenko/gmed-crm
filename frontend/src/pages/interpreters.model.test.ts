import { describe, expect, it } from "vitest";

import { buildInterpreterListPath } from "./interpreters.model";

describe("buildInterpreterListPath", () => {
  it("omits empty filters", () => {
    expect(
      buildInterpreterListPath({
        search: "   ",
        status: "",
        contractType: "",
      }),
    ).toBe("/interpreters");
  });

  it("maps UI filters to interpreter API query parameters", () => {
    expect(
      buildInterpreterListPath({
        search: " Daniela Tutas ",
        status: "active",
        contractType: "freelancer",
      }),
    ).toBe(
      "/interpreters?search=Daniela+Tutas&status=active&contract_type=freelancer",
    );
  });
});
