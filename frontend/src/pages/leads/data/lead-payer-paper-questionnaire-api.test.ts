import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api";
import { PayerLinkError } from "@/pages/payer-link/payer-link-api";

const api = vi.hoisted(() => ({ calls: [] as { path: string; init: RequestInit | undefined }[], result: null as unknown }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  apiFetch: async (path: string, init?: RequestInit) => {
    api.calls.push({ path, init });
    if (api.result instanceof Error) throw api.result;
    return api.result;
  },
}));

import { asPayerLinkError, createStaffPayerClient } from "./lead-payer-paper-questionnaire-api";

const questionnaire = { patient_name: "Mia Muster", payer_type: "company", answers: {}, state: "draft" };

afterEach(() => {
  api.calls = [];
  api.result = null;
});

describe("staff's client of the payer questionnaire (owner 2026-10-30)", () => {
  it("binds the payer page's calls to the lead's staff routes", async () => {
    api.result = questionnaire;
    const client = createStaffPayerClient("lead-1");
    await client.questionnaire();
    await client.saveAnswers({ representative_first_name: "Vera" });
    await client.consent(["phone"], "ru");
    await client.submit();
    expect(api.calls.map((call) => [call.path, call.init?.method ?? "GET"])).toEqual([
      ["/leads/lead-1/payer-questionnaire", "GET"],
      ["/leads/lead-1/payer-questionnaire", "POST"],
      ["/leads/lead-1/payer-questionnaire/consent", "POST"],
      ["/leads/lead-1/payer-questionnaire/submit", "POST"],
    ]);
    expect(JSON.parse(String(api.calls[3].init?.body))).toEqual({ declared_correct: true });
    // The code step and the payer's own withdrawal do not exist for staff.
    await expect(client.verifyCode("123456")).rejects.toBeInstanceOf(PayerLinkError);
  });

  it("hands the form the payer page's error with the server's code and extras", async () => {
    api.result = new ApiRequestError("refused", { status: 422, code: "invalid_field", body: { code: "invalid_field", field: "first_name" } });
    const client = createStaffPayerClient("lead-1");
    const error = await client.saveAnswers({ first_name: "Vera" }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PayerLinkError);
    expect((error as PayerLinkError).code).toBe("invalid_field");
    expect((error as PayerLinkError).body.field).toBe("first_name");
    expect(asPayerLinkError(new Error("offline")).code).toBe("network");
  });
});
