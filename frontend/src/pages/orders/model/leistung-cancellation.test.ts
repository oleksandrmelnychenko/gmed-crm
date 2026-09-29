import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import {
  LEISTUNG_CANCEL_REASON_MAX,
  canCancelLeistung,
  isStaleLeistungCancelError,
  isValidLeistungCancelReason,
  leistungCancelErrorMessage,
  leistungCancelReasonLength,
  leistungCancellationNote,
} from "./leistung-cancellation";

const ru = (ruText: string) => ruText;
const de = (_ruText: string, deText: string) => deText;

function apiError(
  status: number,
  code = "http_error",
  message = "server text",
  body: Record<string, unknown> | null = null,
) {
  return new ApiRequestError(message, { status, code, body });
}

describe("isValidLeistungCancelReason", () => {
  it("requires 3 to 1000 characters after trimming", () => {
    expect(isValidLeistungCancelReason("")).toBe(false);
    expect(isValidLeistungCancelReason("  ab  ")).toBe(false);
    expect(isValidLeistungCancelReason(" abc ")).toBe(true);
    expect(isValidLeistungCancelReason("x".repeat(LEISTUNG_CANCEL_REASON_MAX))).toBe(true);
    expect(isValidLeistungCancelReason("x".repeat(LEISTUNG_CANCEL_REASON_MAX + 1))).toBe(false);
  });

  it("counts characters like the server, not UTF-16 units", () => {
    expect(leistungCancelReasonLength("😀😀")).toBe(2);
    expect(isValidLeistungCancelReason("😀😀")).toBe(false);
    expect(isValidLeistungCancelReason("😀😀😀")).toBe(true);
  });
});

describe("canCancelLeistung", () => {
  it("allows every line that is not cancelled yet to users who may cancel services", () => {
    for (const status of ["planned", "delivered", "approved", "invoiced"] as const) {
      expect(canCancelLeistung({ status }, true)).toBe(true);
      expect(canCancelLeistung({ status }, false)).toBe(false);
    }
    expect(canCancelLeistung({ status: "cancelled" }, true)).toBe(false);
  });
});

describe("leistungCancelErrorMessage", () => {
  it("localizes conflict and validation responses instead of showing server text", () => {
    expect(leistungCancelErrorMessage(apiError(409), de)).toContain("nicht mehr storniert");
    expect(leistungCancelErrorMessage(apiError(409), ru)).toContain("нельзя отменить");
    expect(
      leistungCancelErrorMessage(
        apiError(409, "http_error", "x", { code: "order_service_on_draft_invoice" }),
        de,
      ),
    ).toContain("Rechnungsentwurf");
    expect(
      leistungCancelErrorMessage(
        apiError(403, "http_error", "x", { code: "order_service_reversal_requires_finance" }),
        ru,
      ),
    ).toContain("Кредит-ноту");
    expect(leistungCancelErrorMessage(apiError(422), de)).toBe(
      "Bitte einen Stornogrund angeben (3–1000 Zeichen).",
    );
    expect(leistungCancelErrorMessage(apiError(422), ru)).toBe(
      "Укажите причину отмены (3–1000 символов).",
    );
    expect(leistungCancelErrorMessage(apiError(403), de)).toContain("Keine Berechtigung");
    expect(leistungCancelErrorMessage(apiError(404), ru)).toContain("не найдена");
  });

  it("keeps localized transport messages and falls back for anything else", () => {
    expect(
      leistungCancelErrorMessage(apiError(0, "network", "Keine Verbindung"), de),
    ).toBe("Keine Verbindung");
    expect(leistungCancelErrorMessage(apiError(500), de)).toBe(
      "Die Leistung konnte nicht storniert werden.",
    );
    expect(leistungCancelErrorMessage(new Error("boom"), ru)).toBe(
      "Не удалось отменить услугу.",
    );
  });
});

describe("isStaleLeistungCancelError", () => {
  it("flags conflicts and missing lines so the order reloads", () => {
    expect(isStaleLeistungCancelError(apiError(409))).toBe(true);
    expect(isStaleLeistungCancelError(apiError(404))).toBe(true);
    expect(isStaleLeistungCancelError(apiError(422))).toBe(false);
    expect(isStaleLeistungCancelError(new Error("409"))).toBe(false);
  });
});

describe("leistungCancellationNote", () => {
  it("returns date and reason for cancelled lines only", () => {
    expect(
      leistungCancellationNote({
        status: "cancelled",
        cancelled_at: "2026-09-25T10:00:00+00:00",
        cancellation_reason: "  Bereits über Dolmetscherbericht abgerechnet  ",
      }),
    ).toEqual({
      cancelledAt: "2026-09-25T10:00:00+00:00",
      reason: "Bereits über Dolmetscherbericht abgerechnet",
    });
    expect(leistungCancellationNote({ status: "cancelled" })).toEqual({
      cancelledAt: null,
      reason: null,
    });
    expect(
      leistungCancellationNote({ status: "planned", cancellation_reason: "stale" }),
    ).toBeNull();
  });
});
