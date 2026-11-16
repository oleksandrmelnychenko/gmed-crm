import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PayerLinkError, type PayerLinkClient, type PayerLinkInfo } from "./payer-link-api";
import { PayerCodeStep } from "./payer-link-code-step";
import { CODE_POLL_INTERVAL_MS, CODE_POLL_LIMIT_MS, startCodeStatusPoll, type CodePollOptions } from "./payer-link-session";
import { PAYER_LINK_TEXTS, payerLinkText } from "./payer-link-text";

// fix-86: a code the CEO issues by hand (fix-84) shows the code field without a reload.

type Status = { code_pending?: boolean | null; code_sent_at?: string | null };

function harness(answers: Array<Status | Error>) {
  let hidden = false;
  const listeners = new Set<() => void>();
  const ask = vi.fn(async () => {
    const next = answers.length > 1 ? answers.shift()! : answers[0];
    if (next instanceof Error) throw next;
    return next;
  });
  const onPending = vi.fn();
  const onFatal = vi.fn();
  const options: CodePollOptions = {
    ask,
    onPending,
    onFatal,
    isHidden: () => hidden,
    onVisibilityChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    options,
    ask,
    onPending,
    onFatal,
    listeners,
    setHidden(value: boolean) {
      hidden = value;
      for (const listener of [...listeners]) listener();
    },
  };
}

describe("startCodeStatusPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks every 5 s and shows the field once a code waits", async () => {
    const h = harness([{ code_pending: false, code_sent_at: null }, { code_pending: true, code_sent_at: "2026-11-16T10:00:00Z" }]);
    const stop = startCodeStatusPoll(h.options);
    expect(h.ask).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CODE_POLL_INTERVAL_MS);
    expect(h.ask).toHaveBeenCalledTimes(1);
    expect(h.onPending).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CODE_POLL_INTERVAL_MS);
    expect(h.ask).toHaveBeenCalledTimes(2);
    expect(h.onPending).toHaveBeenCalledWith("2026-11-16T10:00:00Z");
    // Done: no more asking, the visibility listener is gone.
    await vi.advanceTimersByTimeAsync(CODE_POLL_INTERVAL_MS * 3);
    expect(h.ask).toHaveBeenCalledTimes(2);
    expect(h.listeners.size).toBe(0);
    stop();
  });

  it("pauses in a hidden tab and asks at once when it shows again", async () => {
    const h = harness([{ code_pending: false, code_sent_at: null }]);
    const stop = startCodeStatusPoll(h.options);
    await vi.advanceTimersByTimeAsync(CODE_POLL_INTERVAL_MS);
    expect(h.ask).toHaveBeenCalledTimes(1);
    h.setHidden(true);
    await vi.advanceTimersByTimeAsync(CODE_POLL_INTERVAL_MS * 10);
    expect(h.ask).toHaveBeenCalledTimes(1);
    h.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.ask).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(CODE_POLL_INTERVAL_MS);
    expect(h.ask).toHaveBeenCalledTimes(3);
    stop();
  });

  it("stops on unmount and after a quarter of an hour", async () => {
    const h = harness([{ code_pending: false, code_sent_at: null }]);
    const stop = startCodeStatusPoll(h.options);
    await vi.advanceTimersByTimeAsync(CODE_POLL_LIMIT_MS + CODE_POLL_INTERVAL_MS * 3);
    const asked = h.ask.mock.calls.length;
    expect(asked).toBeGreaterThan(150);
    expect(asked).toBeLessThanOrEqual(CODE_POLL_LIMIT_MS / CODE_POLL_INTERVAL_MS);
    // Showing the tab again after the time is up asks nothing.
    h.setHidden(true);
    h.setHidden(false);
    await vi.advanceTimersByTimeAsync(CODE_POLL_INTERVAL_MS * 3);
    expect(h.ask).toHaveBeenCalledTimes(asked);
    stop();

    const unmounted = harness([{ code_pending: false, code_sent_at: null }]);
    const stopNow = startCodeStatusPoll(unmounted.options);
    stopNow();
    await vi.advanceTimersByTimeAsync(CODE_POLL_INTERVAL_MS * 3);
    expect(unmounted.ask).not.toHaveBeenCalled();
    expect(unmounted.listeners.size).toBe(0);
  });

  it("stays silent on a failed ask, ends the link on a fatal one, stops on 404", async () => {
    const quiet = harness([new PayerLinkError(0, "network"), new PayerLinkError(429, ""), { code_pending: true, code_sent_at: null }]);
    startCodeStatusPoll(quiet.options);
    await vi.advanceTimersByTimeAsync(CODE_POLL_INTERVAL_MS * 3);
    expect(quiet.ask).toHaveBeenCalledTimes(3);
    expect(quiet.onFatal).not.toHaveBeenCalled();
    expect(quiet.onPending).toHaveBeenCalledWith(null);

    const revoked = harness([new PayerLinkError(410, "link_revoked")]);
    startCodeStatusPoll(revoked.options);
    await vi.advanceTimersByTimeAsync(CODE_POLL_INTERVAL_MS * 3);
    expect(revoked.onFatal).toHaveBeenCalledWith("link_revoked");
    expect(revoked.ask).toHaveBeenCalledTimes(1);

    const older = harness([new PayerLinkError(404, "")]);
    startCodeStatusPoll(older.options);
    await vi.advanceTimersByTimeAsync(CODE_POLL_INTERVAL_MS * 3);
    expect(older.ask).toHaveBeenCalledTimes(1);
    expect(older.onFatal).not.toHaveBeenCalled();
  });
});

function info(overrides: Partial<PayerLinkInfo> = {}): PayerLinkInfo {
  return {
    state: "code_required",
    patient_name: "Erika Muster",
    payer_type: "person",
    email_masked: "v***r@example.com",
    language: "uk",
    expires_at: null,
    code_sent_at: null,
    code_pending: false,
    session_valid: false,
    ...overrides,
  };
}

function render(linkInfo: PayerLinkInfo, lang = "uk") {
  return renderToStaticMarkup(
    <PayerCodeStep
      info={linkInfo}
      text={payerLinkText(lang)}
      lang={lang}
      client={{} as PayerLinkClient}
      notice={null}
      onVerified={() => undefined}
      onFatal={() => undefined}
    />,
  );
}

describe("PayerCodeStep «I already have a code»", () => {
  it("is offered next to «send code» while no code waits", () => {
    const html = render(info());
    expect(html).toContain('data-testid="payer-link-send-code"');
    expect(html).toContain('data-testid="payer-link-have-code"');
    expect(html).toContain("Я вже маю код");
    expect(html).not.toContain('id="payer-link-code"');
  });

  it("is gone once the code field shows", () => {
    const html = render(info({ code_pending: true, code_sent_at: "2026-11-16T10:00:00Z" }));
    expect(html).toContain('id="payer-link-code"');
    expect(html).not.toContain('data-testid="payer-link-have-code"');
  });

  it("is worded in every language", () => {
    expect(PAYER_LINK_TEXTS.uk.haveCode).toBe("Я вже маю код");
    expect(PAYER_LINK_TEXTS.ru.haveCode).toBe("У меня уже есть код");
    expect(PAYER_LINK_TEXTS.de.haveCode).toBe("Ich habe bereits einen Code");
    expect(PAYER_LINK_TEXTS.en.haveCode).toBe("I already have a code");
  });
});
