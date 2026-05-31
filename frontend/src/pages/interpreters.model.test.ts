import { describe, expect, it } from "vitest";

import {
  buildInterpreterLanguagesPath,
  buildInterpreterListPath,
  buildInterpreterProfileDocumentDownloadPath,
  buildInterpreterProfileDocumentsPath,
  interpreterLanguagesToPayload,
} from "./interpreters.model";

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

describe("buildInterpreterLanguagesPath", () => {
  it("targets the interpreter language replacement endpoint", () => {
    expect(buildInterpreterLanguagesPath("int-123")).toBe(
      "/interpreters/int-123/languages",
    );
  });
});

describe("interpreter profile document paths", () => {
  it("targets upload and download endpoints", () => {
    expect(buildInterpreterProfileDocumentsPath("int-123")).toBe(
      "/interpreters/int-123/profile/documents",
    );
    expect(
      buildInterpreterProfileDocumentDownloadPath("int-123", "doc-456"),
    ).toBe("/interpreters/int-123/profile/documents/doc-456/download");
  });
});

describe("interpreterLanguagesToPayload", () => {
  it("normalizes language rows and drops empty or duplicate codes", () => {
    expect(
      interpreterLanguagesToPayload([
        {
          languageCode: " DE ",
          languageLabel: " Deutsch ",
          proficiency: "fluent",
          cefrLevel: " c1 ",
          specialization: " Medizin ",
        },
        {
          languageCode: "de",
          languageLabel: "Duplicate",
          proficiency: "basic",
          cefrLevel: "a2",
          specialization: "Everyday",
        },
        {
          languageCode: " ",
          languageLabel: "Blank",
          proficiency: "working",
          cefrLevel: "",
          specialization: "",
        },
      ]),
    ).toEqual([
      {
        languageCode: "de",
        languageLabel: "Deutsch",
        proficiency: "fluent",
        cefrLevel: "C1",
        specialization: "Medizin",
      },
    ]);
  });
});
