import { describe, expect, it } from "vitest";

import { securityReviewUiDe, securityReviewUiRu } from "@/lib/i18n/catalogs/security-review-ui";
import { privacyExecutionSummary } from "@/pages/admin-compliance-execution";

describe("privacyExecutionSummary (QA 2026-11-13 F-B4)", () => {
  it("names the next step of an access request instead of the raw answer", () => {
    const payload = {
      execution: { mode: "manual_fulfilment", request_type: "access" },
      ok: true,
    };
    const ru = privacyExecutionSummary(payload, securityReviewUiRu);
    expect(ru).toContain("«Экспорт данных (ст. 15)»");
    expect(ru).not.toContain("{");
    const de = privacyExecutionSummary(payload, securityReviewUiDe);
    expect(de).toContain("„Daten exportieren (Art. 15)“");
  });

  it("counts what an erasure and a third-party revocation did", () => {
    expect(
      privacyExecutionSummary(
        { execution: { mode: "erasure", erased_document_files: 3, disabled_portal_accounts: 1 } },
        securityReviewUiRu,
      ),
    ).toBe(
      "Данные пациента анонимизированы (ст. 17): удалено файлов документов — 3, закрыто доступов к порталу — 1.",
    );
    expect(
      privacyExecutionSummary(
        { execution: { mode: "third_party_revoke", revoked_count: 2, revoked_document_share_count: 0 } },
        securityReviewUiRu,
      ),
    ).toBe("Передача третьим лицам отозвана: согласий — 2, доступов к документам — 0.");
  });

  it("falls back to a plain sentence for an unknown answer", () => {
    expect(privacyExecutionSummary({ ok: true, export_id: "x" }, securityReviewUiRu)).toBe(
      "Запрос исполнен.",
    );
    expect(privacyExecutionSummary(null, securityReviewUiDe)).toBe("Der Antrag ist ausgeführt.");
  });
});
