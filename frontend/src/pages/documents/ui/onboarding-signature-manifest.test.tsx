import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { OnboardingManifest } from "../data/document-signature-api";
import { OnboardingSignatureManifest } from "./onboarding-signature-manifest";
import { OutdatedSignatureDocuments } from "./signature-status";

vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "ru" }) }));

const manifest: OnboardingManifest = {
  expected_count: 2,
  items: [
    { template: "framework_contract", document_id: "contract", title: "Rahmenvertrag", version: 1, state: "signed", reason: null, paper_signed: true, pending_elsewhere: false },
    { template: "single_order", document_id: "order", title: "Einzelauftrag", version: 2, state: "signed", reason: null, paper_signed: true, pending_elsewhere: false },
  ],
};

describe("OnboardingSignatureManifest", () => {
  it("names an outdated version as such, not as signed (QA 2026-11-01, U-3)", () => {
    const html = renderToStaticMarkup(
      <OutdatedSignatureDocuments.Provider value={["contract"]}>
        <OnboardingSignatureManifest manifest={manifest} />
      </OutdatedSignatureDocuments.Provider>,
    );
    expect(html.match(/Устарел, нужна новая версия/g)).toHaveLength(1);
    expect(html.match(/Подписан на бумаге/g)).toHaveLength(1);
  });

  it("does not offer an outdated paper copy for the package", () => {
    const html = renderToStaticMarkup(
      <OutdatedSignatureDocuments.Provider value={["contract", "order"]}>
        <OnboardingSignatureManifest manifest={manifest} availableIds={["contract", "order"]} onSelect={() => undefined} />
      </OutdatedSignatureDocuments.Provider>,
    );
    expect(html).not.toContain("Выбрать доступные");
    expect(html).toContain("Для первичного оформления нужен полный комплект");
  });
});
