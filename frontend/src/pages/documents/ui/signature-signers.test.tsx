import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SignatureRequest, Signer } from "../data/document-signature-api";
import { signatureSignerPresentation } from "./signature-signer-status";
import { SignatureSigners } from "./signature-signers";
import { SignatureProgressChips } from "./signature-progress-chips";
import { signatureSignerProgress } from "./signature-signer-status";

const client: Signer = { first_name: "Erika", last_name: "Mustermann", email: "erika@example.org", role: "client" };
const agency: Signer = { first_name: "Max", last_name: "Muster", email: "max@example.org", role: "agency" };
function request(statuses: (string | null)[], override: Partial<SignatureRequest> = {}): SignatureRequest {
  return {
    id: "synthetic-request", status: "pending", test_mode: false, signers: [client, agency],
    result_document_id: null, has_report: false, last_error: null, created_at: "2026-10-15T12:00:00Z",
    evidence: { signatures: statuses.flatMap((status, index) => status ? [{ email: [client, agency][index].email, status, signed_at: null }] : []) },
    ...override,
  };
}

for (const lang of ["ru", "de"]) {
  describe(`signer states in ${lang}`, () => {
    it("distinguishes the ready client from the queued agency, naming the pending signature", () => {
      const item = request(["OPEN", "WAITING"]);
      const html = renderToStaticMarkup(<SignatureSigners request={item} lang={lang} />);
      expect(html).toContain('data-signature-signer="ready"');
      expect(html).toContain('data-signature-signer="waiting"');
      expect(html).toContain(lang === "ru" ? "Готов к подписи" : "Zur Unterschrift bereit");
      expect(html).toContain(lang === "ru" ? "Ждёт предыдущей подписи" : "Wartet auf vorherige Unterschrift");
      expect(signatureSignerPresentation(item, agency, lang).detail).toContain("Erika Mustermann");
      expect(html).toContain(lang === "ru" ? "Доставка E-Mail не подтверждена." : "Die E-Mail-Zustellung ist nicht bestätigt.");
      expect(html).not.toMatch(/Приглашение отправлено|Einladung wurde per E-Mail versendet/);
    });

    it.each(["DECLINED", "ERROR", "SIGNED", "WITHDRAWN", "EXPIRED"])("shows individual %s even while the overall request is pending", status => {
      const item = request(["OPEN", status]);
      const presentation = signatureSignerPresentation(item, agency, lang);
      expect(presentation.state).toBe(status === "SIGNED" ? "signed" : status.toLowerCase());
      expect(presentation.tone).toBe(["DECLINED", "ERROR"].includes(status) ? "error" : status === "SIGNED" ? "success" : "neutral");
      const html = renderToStaticMarkup(<SignatureSigners request={item} lang={lang} />);
      expect(html).toContain(presentation.label);
      expect(html).not.toContain('data-signature-signer="waiting"');
    });

    it.each([null, "NEW_PROVIDER_STATUS"])("marks missing or unknown provider evidence (%s) for review", status => {
      const presentation = signatureSignerPresentation(request(["OPEN", status]), agency, lang);
      expect(presentation.state).toBe("unconfirmed");
      expect(presentation.tone).toBe("warning");
      expect(presentation.label).toBe(lang === "ru" ? "Статус требует проверки" : "Status muss geprüft werden");
    });

    it("keeps DEMO explicit and does not imply a legally valid signature or delivered invitation", () => {
      const html = renderToStaticMarkup(<SignatureSigners request={request(["SIGNED", "OPEN"], { test_mode: true })} lang={lang} />);
      expect(html).toContain(lang === "ru" ? "DEMO · Подписано" : "DEMO · Unterzeichnet");
      expect(html).not.toContain("data-signature-provider-receipt");
    });
  });
}

describe("signer evidence and request lifecycle", () => {
  it("does not say only GMED is awaited while a payer or minor still has to sign", () => {
    const progress = { ...signatureSignerProgress(request(["SIGNED", "OPEN"])), total: 3 };
    const html = renderToStaticMarkup(<SignatureProgressChips progress={progress} testMode={false} lang="ru" />);
    expect(html).toContain("Ожидаются подписи");
    expect(html).not.toContain("ожидается GMED");
  });
  it("matches emails case-insensitively and refuses duplicate or unrelated evidence", () => {
    const item = request(["OPEN", "WAITING"]);
    item.evidence.signatures![1].email = " MAX@EXAMPLE.ORG ";
    expect(signatureSignerPresentation(item, agency, "ru").state).toBe("waiting");
    item.evidence.signatures!.push({ email: agency.email, status: "SIGNED", signed_at: null });
    expect(signatureSignerPresentation(item, agency, "ru").state).toBe("unconfirmed");
    expect(signatureSignerPresentation(request(["OPEN"], { evidence: { signatures: [{ email: "other@example.org", status: "SIGNED", signed_at: null }] } }), agency, "ru").state).toBe("unconfirmed");
  });

  it("names all currently ready parents, without assuming array order or agency role", () => {
    const secondParent: Signer = { first_name: "Anna", last_name: "Mustermann", email: "anna@example.org", role: "client" };
    const item = request([], { signers: [agency, secondParent, client], evidence: { signatures: [
      { email: agency.email, status: "WAITING", signed_at: null },
      { email: secondParent.email, status: "OPEN", signed_at: null },
      { email: client.email, status: "OPEN", signed_at: null },
    ] } });
    expect(signatureSignerPresentation(item, agency, "ru").detail).toBe("Сначала ожидаются подписи: Anna Mustermann, Erika Mustermann.");
    const reverse = request(["WAITING", "OPEN"]);
    expect(signatureSignerPresentation(reverse, client, "de").detail).toContain("Max Muster");
  });

  it("does not invent a preceding name when no signer is currently ready", () => {
    const item = request(["SIGNED", "WAITING"]);
    expect(signatureSignerPresentation(item, agency, "ru").detail).toBe("Предыдущие подписи ещё не подтверждены.");
  });

  it.each(["withdrawn", "expired", "declined", "error", "needs_review", "submission_unknown", "submitting", "completed"] as const)("does not advertise readiness from stale OPEN evidence after request %s", status => {
    const item = request(["SIGNED", "OPEN"], { status });
    expect(signatureSignerPresentation(item, client, "ru").state).toBe("signed");
    expect(["ready", "waiting"]).not.toContain(signatureSignerPresentation(item, agency, "ru").state);
    expect(renderToStaticMarkup(<SignatureSigners request={item} lang="ru" />)).not.toContain("data-signature-provider-receipt");
  });
});
