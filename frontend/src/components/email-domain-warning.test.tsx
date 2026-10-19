import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api";
import { checkEmailDomain, resetEmailDomainCheckCache } from "@/lib/email-domain-check";
import { EmailDomainWarning, emailDomainWarningText, knownNoMailEmailError } from "./email-domain-warning";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

describe("EmailDomainWarning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEmailDomainCheckCache();
  });

  it("names the domain in every language", () => {
    expect(emailDomainWarningText("max@Dead.example", "de")).toBe("Die Domain „dead.example“ empfängt keine E-Mails – bitte Adresse prüfen");
    expect(emailDomainWarningText("max@dead.example", "ru")).toBe("Домен «dead.example» не принимает почту — проверьте адрес");
    expect(emailDomainWarningText("max@dead.example", "uk")).toBe("Домен «dead.example» не приймає пошту — перевірте адресу");
    expect(emailDomainWarningText("max@dead.example", "en")).toBe("The domain “dead.example” does not receive e-mail — please check the address");
  });

  it("shows one alert line only for a domain known not to accept mail", async () => {
    expect(renderToStaticMarkup(<EmailDomainWarning email="max@dead.example" lang="de" />)).toBe("");
    expect(knownNoMailEmailError("max@dead.example", "de")).toBeNull();
    vi.mocked(apiFetch).mockResolvedValueOnce({ format_valid: true, domain: "no_mail" });
    await checkEmailDomain("max@dead.example");
    const markup = renderToStaticMarkup(<EmailDomainWarning email="max@dead.example" lang="en" />);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("text-destructive");
    expect(markup).toContain("The domain “dead.example” does not receive e-mail");
    expect(renderToStaticMarkup(<EmailDomainWarning email="max@dead.example" lang="en" enabled={false} />)).toBe("");
    expect(knownNoMailEmailError("other@dead.example", "ru")).toBe("Домен «dead.example» не принимает почту — проверьте адрес");
  });
});
