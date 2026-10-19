import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api";
import {
  checkEmailDomain,
  isKnownNoMailEmail,
  knownEmailDomainStatus,
  resetEmailDomainCheckCache,
} from "./email-domain-check";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

describe("e-mail domain check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEmailDomainCheckCache();
  });

  it("asks the server once per domain and keeps the answer", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ format_valid: true, domain: "no_mail" });
    expect(await checkEmailDomain("max@Nomail.example")).toBe("no_mail");
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith("/me/email-check?email=max%40Nomail.example", { forceFresh: true });
    expect(await checkEmailDomain("erika@nomail.example")).toBe("no_mail");
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(knownEmailDomainStatus("other@NOMAIL.example")).toBe("no_mail");
    expect(isKnownNoMailEmail("other@nomail.example")).toBe(true);
    expect(isKnownNoMailEmail("other@unasked.example")).toBe(false);
  });

  it("shares one request between concurrent callers of a domain", async () => {
    let resolve: (value: unknown) => void = () => {};
    vi.mocked(apiFetch).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const first = checkEmailDomain("a@mail.example");
    const second = checkEmailDomain("b@mail.example");
    resolve({ format_valid: true, domain: "accepts_mail" });
    expect(await Promise.all([first, second])).toEqual(["accepts_mail", "accepts_mail"]);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("answers unknown on errors and asks again later", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("network"));
    expect(await checkEmailDomain("a@flaky.example")).toBe("unknown");
    vi.mocked(apiFetch).mockResolvedValueOnce({ format_valid: true, domain: "unknown" });
    expect(await checkEmailDomain("a@flaky.example")).toBe("unknown");
    vi.mocked(apiFetch).mockResolvedValueOnce({ format_valid: true, domain: "accepts_mail" });
    expect(await checkEmailDomain("a@flaky.example")).toBe("accepts_mail");
    expect(apiFetch).toHaveBeenCalledTimes(3);
    expect(isKnownNoMailEmail("a@flaky.example")).toBe(false);
  });

  it("never sends an invalid address", async () => {
    expect(await checkEmailDomain("not-an-email")).toBe("unknown");
    expect(await checkEmailDomain("a@b.c")).toBe("unknown");
    expect(knownEmailDomainStatus("a@b")).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
