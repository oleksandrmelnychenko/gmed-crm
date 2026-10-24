import { describe, expect, it } from "vitest";

import { uploadEach } from "./upload-each";

describe("uploadEach", () => {
  it("keeps uploading after a refused or too large file", async () => {
    const sent: string[] = [];
    const files = [
      { name: "a.pdf", size: 10 },
      { name: "big.pdf", size: 100 },
      { name: "bad.jpg", size: 10 },
      { name: "c.png", size: 10 },
    ];
    const result = await uploadEach(
      files,
      async (file) => {
        if (file.name === "bad.jpg") throw new Error("unsupported_file_type");
        sent.push(file.name);
      },
      50,
    );
    expect(sent).toEqual(["a.pdf", "c.png"]);
    expect(result.uploaded.map((file) => file.name)).toEqual(["a.pdf", "c.png"]);
    expect(result.tooLarge.map((file) => file.name)).toEqual(["big.pdf"]);
    expect(result.failed.map(({ file }) => file.name)).toEqual(["bad.jpg"]);
  });
});
