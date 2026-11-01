import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Banner } from "./banner";

describe("Banner", () => {
  it("passes data-testid through (QA 2026-11-01, U-9)", () => {
    expect(renderToStaticMarkup(<Banner tone="warning" data-testid="hint">Text</Banner>)).toContain('data-testid="hint"');
  });
});
