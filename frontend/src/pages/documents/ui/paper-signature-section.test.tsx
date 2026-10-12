import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PaperSignatureSection } from "./paper-signature-section";

describe("PaperSignatureSection", () => {
  it("asks for the signing day with the app's DD.MM.YYYY field, not the browser's (QA C3-02)", () => {
    const html = renderToStaticMarkup(
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <PaperSignatureSection lang="ru" onSubmit={async () => true} />
      </LocalizationProvider>,
    );
    expect(html).toContain("Дата подписи");
    expect(html).not.toMatch(/<input[^>]*type="date"/);
    expect(html).toContain('data-testid="paper-signature-date"');
  });
});
