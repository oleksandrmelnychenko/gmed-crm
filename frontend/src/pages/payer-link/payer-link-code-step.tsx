import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatAppDate } from "@/lib/app-time-zone";

import { PayerLinkError, type PayerLinkClient, type PayerLinkInfo, type PayerVerified } from "./payer-link-api";
import {
  codeDigits,
  codeProblemMessage,
  isFatalKind,
  payerErrorKind,
  resendAllowedAt,
  secondsLeft,
  type CodeProblem,
  type FatalKind,
} from "./payer-link-session";
import { Notice } from "./payer-link-parts";
import type { PayerLinkText } from "./payer-link-text";

// Step 0 of the payer page (contract phase 3a, 3.2/3.3, 5.1): the link alone
// shows only the patient's name and the masked address; the questionnaire
// needs the 6-digit code mailed there. The code never leaves this form except
// in the body of "confirm".

export function PayerCodeStep({
  info,
  text,
  client,
  notice,
  onVerified,
  onFatal,
}: {
  info: PayerLinkInfo;
  text: PayerLinkText;
  client: PayerLinkClient;
  /** Why the payer is here again (the session ended). */
  notice: string | null;
  onVerified: (verified: PayerVerified) => void;
  onFatal: (kind: FatalKind) => void;
}) {
  const [codeSent, setCodeSent] = useState(Boolean(info.code_sent_at));
  const [resendAt, setResendAt] = useState<number | null>(() =>
    info.code_sent_at ? resendAllowedAt(info.code_sent_at, null, Date.now()) : null,
  );
  const [now, setNow] = useState(() => Date.now());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"send" | "verify" | null>(null);
  // Kept as what went wrong, not as a text: the message follows a switch of the language.
  const [problem, setProblem] = useState<CodeProblem | null>(null);
  const error = problem ? codeProblemMessage(problem, text) : null;
  const codeInput = useRef<HTMLInputElement | null>(null);
  // Counts the codes sent from here: after each, the field takes the focus once it is shown.
  const [sentCount, setSentCount] = useState(0);
  const seconds = secondsLeft(resendAt, now);

  // The countdown of "send again" ticks while it runs.
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);

  useEffect(() => {
    if (sentCount > 0) codeInput.current?.focus();
  }, [sentCount]);

  function refused(cause: unknown) {
    const failure = cause instanceof PayerLinkError ? cause : new PayerLinkError(0, "network");
    const kind = payerErrorKind(failure.status, failure.code);
    if (isFatalKind(kind)) {
      onFatal(kind);
      return;
    }
    if (failure.code === "code_rate_limited") {
      const retry = typeof failure.body.retry_after_seconds === "number" ? failure.body.retry_after_seconds : null;
      const at = Date.now();
      setResendAt(resendAllowedAt(null, retry, at));
      setNow(at);
      // A code was sent a moment ago: it can be entered.
      setCodeSent(true);
    }
    if (failure.code === "code_expired") setCode("");
    setProblem({ kind: "refused", status: failure.status, code: failure.code, body: failure.body });
  }

  async function send() {
    setBusy("send");
    setProblem(null);
    try {
      const sent = await client.requestCode();
      const at = Date.now();
      // Counted from this browser's clock: the server's may differ.
      setResendAt(resendAllowedAt(null, sent.resend_after_seconds, at));
      setNow(at);
      setCodeSent(true);
      setCode("");
      setSentCount((count) => count + 1);
    } catch (cause) {
      refused(cause);
    } finally {
      setBusy(null);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    const digits = codeDigits(code);
    if (digits.length !== 6) {
      setProblem({ kind: "format" });
      codeInput.current?.focus();
      return;
    }
    setBusy("verify");
    setProblem(null);
    try {
      onVerified(await client.verifyCode(digits));
    } catch (cause) {
      refused(cause);
      codeInput.current?.select();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="payer-link-code-step">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold leading-tight">{text.pageTitle}</h1>
        <p className="text-sm leading-6" data-testid="payer-link-named">
          {text.namedYou(info.patient_name)}
        </p>
      </div>
      {notice ? (
        <Notice tone="warning" role="status" testId="payer-link-code-notice">
          {notice}
        </Notice>
      ) : null}
      {info.state === "submitted" ? (
        <Notice tone="neutral" role="note" testId="payer-link-submitted-note">
          {text.submittedCodeNote}
        </Notice>
      ) : null}
      <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground" data-testid="payer-link-code-target">
        <Mail aria-hidden="true" className="mt-1 size-4 shrink-0" />
        <span className="min-w-0 break-words">
          {codeSent ? text.codeSentTo(info.email_masked) : text.codeWillBeSent(info.email_masked)}
        </span>
      </p>

      {codeSent ? (
        <form className="space-y-3" onSubmit={(event) => void verify(event)} noValidate>
          <div className="space-y-1.5">
            <label htmlFor="payer-link-code" className="block text-sm font-medium">
              {text.codeLabel}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={codeInput}
                id="payer-link-code"
                name="one-time-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                // No `maxLength`: a pasted "482 915" would be cut before the spaces are dropped.
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "payer-link-code-error" : undefined}
                // 16 px and more: a smaller text makes iOS zoom into the field.
                className="h-11 w-40 rounded-lg border border-input bg-field px-3 text-center font-mono text-lg tracking-[0.35em] text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30 aria-invalid:border-destructive"
                value={code}
                onChange={(event) => setCode(codeDigits(event.target.value))}
              />
              <Button type="submit" className="h-11 gap-2 px-4" disabled={busy !== null} data-testid="payer-link-verify">
                {busy === "verify" ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
                {busy === "verify" ? text.confirming : text.confirmCode}
              </Button>
            </div>
          </div>
          <Button
            type="button"
            variant="link"
            className="h-auto px-0 py-0 text-sm"
            disabled={busy !== null || seconds > 0}
            onClick={() => void send()}
            data-testid="payer-link-resend"
          >
            {seconds > 0 ? text.resendIn(seconds) : text.resendCode}
          </Button>
        </form>
      ) : (
        <Button type="button" className="h-10 gap-2 px-4" disabled={busy !== null} onClick={() => void send()} data-testid="payer-link-send-code">
          {busy === "send" ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
          {busy === "send" ? text.sendingCode : text.sendCode}
        </Button>
      )}

      {error ? (
        <p id="payer-link-code-error" role="alert" className="text-sm text-destructive" data-testid="payer-link-code-error">
          {error}
        </p>
      ) : null}
      {info.expires_at ? <p className="text-xs text-muted-foreground">{text.linkValidUntil(formatAppDate(info.expires_at))}</p> : null}
    </div>
  );
}
