import { useState } from "react";
import { ArrowLeft, ArrowRight, CircleAlert, Info, LoaderCircle, Pencil, Send, Upload } from "lucide-react";

import { Banner, SuccessBanner } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { checkboxClass } from "@/components/record-workspace/primitives/design-tokens";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import { INQUIRY_CONSENT, submitLeadRequest, type LeadRequest } from "./lead-request-api";
import { followUpAnswered, followUpShown } from "./lead-request-follow-up-model";
import { canSubmit, changedSinceSubmit, consentGiven, type SubmitField } from "./lead-request-model";
import { CabinetSection as Section, RequiredMark, StepFooter, errorBody, errorMessage, type RequestQueue, type Step } from "./lead-request-parts";
import { firstIncompleteStep, missingByStep, visibleSteps, type StepId } from "./lead-request-steps";
import { requestSummary, type SummaryGroup, type SummaryRow } from "./lead-request-summary";
import { submitFieldLabel, type LeadRequestText } from "./lead-request-text";

/**
 * Step "send": what will be sent, what is still missing, the confirmation
 * that the statements are complete and true, and the send button.
 */
export function SendStep({
  request,
  text,
  lang,
  enqueue,
  onChange,
  onEdit,
  index = 8,
  total = 8,
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  onEdit: (step: Step) => void;
  index?: number;
  total?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const guardian = request.access_kind === "guardian";
  // What is still missing, by the step it is answered in (the follow-up is sent on its own).
  const byStep = missingByStep(request);
  const missingSteps = visibleSteps(request).filter(
    (step): step is Exclude<StepId, "send" | "follow_up"> => step !== "send" && step !== "follow_up" && byStep[step].length > 0,
  );
  const missingCount = missingSteps.reduce((count, step) => count + byStep[step].length, 0);
  const inquiryConsent = consentGiven(request, INQUIRY_CONSENT);
  // After sending, GMED may ask for more: the neutral pointer to the step (never why).
  const followUpOpen = Boolean(request.submitted_at) && followUpShown(request) && !followUpAnswered(request);
  const ready = canSubmit(request, INQUIRY_CONSENT);
  const sent = Boolean(request.submitted_at);
  // Sent and unchanged: there is nothing to send. Sent and changed: send again.
  const changed = changedSinceSubmit(request);
  const sendable = !sent || changed;
  // A server that knows the GwG statements wants them confirmed with every sending.
  const needsDeclaration = request.identification !== undefined;
  const declaredAt = request.identification?.declared_correct_at ?? null;

  async function send() {
    if (needsDeclaration && !confirmed) return;
    setBusy(true);
    setError("");
    try {
      // After the last entry of step "data", which is saved when that step is left.
      onChange(await enqueue(() => submitLeadRequest(request.lead_id, needsDeclaration)));
      // The confirmation belongs to what was sent; a later change is confirmed anew.
      setConfirmed(false);
    } catch (cause) {
      setError(errorBody(cause)?.code === "declaration_required" ? text.declarationRequired : errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6" data-testid="lead-request-send">
      {request.submitted_at ? (
        <>
          <SuccessBanner>
            <p className="font-semibold">{text.sentTitle}</p>
            {/* One thank-you (QA 2026-10-10): the review notice continues the sentence of the sending,
                for every request alike until GMED sends documents for signature (contract 3.1). */}
            <p data-testid="lead-request-sent">
              {text.sentBody(formatAppDateTime(request.submitted_at))}
              {request.review_notice ? <span data-testid="lead-request-review-notice"> {text.reviewNotice}</span> : null}
            </p>
          </SuccessBanner>
          {followUpOpen ? (
            <div
              role="note"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200"
              data-testid="lead-request-follow-up-open"
            >
              {/* One short neutral pointer (QA 2026-10-10): no title, never why. */}
              <span className="flex items-start gap-2">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>{text.followUpOpen}</span>
              </span>
              <Button type="button" size="sm" className="gap-1.5" onClick={() => onEdit("follow_up")}>
                {text.followUpGo}
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </Button>
            </div>
          ) : null}
          {changed ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
              data-testid="lead-request-changed"
            >
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <p>{text.changedAfterSend}</p>
            </div>
          ) : null}
          <Section title={text.nextTitle}>
            <ol className="space-y-2.5 text-sm" data-testid="lead-request-next-steps">
              {/* "Nothing is needed meanwhile" only while no follow-up block is open (QA 2026-10-10). */}
              {[
                ...text.nextSteps,
                followUpOpen ? text.nextAfterChange : `${text.nextNothingRequired} ${text.nextAfterChange}`,
              ].map((item, index) => (
                <li key={item} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] font-mono text-[11px] font-medium text-[var(--brand)]"
                  >
                    {index + 1}
                  </span>
                  <span className="leading-snug">{item}</span>
                </li>
              ))}
            </ol>
          </Section>
        </>
      ) : null}
      <Section title={sendable ? text.sendTitle : text.sentSummaryTitle}>
        {sendable ? <p className="text-sm text-muted-foreground">{text.summaryIntro}</p> : null}
        <RequestSummary groups={requestSummary(request, text, lang)} />
        {missingCount > 0 || !inquiryConsent ? (
          <div
            className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
            data-testid="lead-request-missing"
          >
            <p className="font-medium">{text.missingTitle}</p>
            {!inquiryConsent ? (
              <ul className="list-inside list-disc">
                <li>{text.inquiryConsentMissing}</li>
              </ul>
            ) : null}
            {/* Grouped by step, each with a way there. */}
            {missingSteps.map((step) => (
              <div key={step} data-testid={`lead-request-missing-${step}`}>
                <button
                  type="button"
                  className="text-xs font-semibold underline-offset-2 hover:underline"
                  onClick={() => onEdit(step)}
                >
                  {text.steps[step]}
                </button>
                <ul className="list-inside list-disc">
                  {byStep[step].map((field) => (
                    <li key={field} className="break-words">
                      {submitFieldLabel(text, field as SubmitField, guardian, request.payer?.payer_type)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
              // To the first step that still misses something.
              onClick={() => onEdit(firstIncompleteStep(request) ?? "person")}
            >
              <Pencil aria-hidden="true" className="size-3.5" />
              {text.editData}
            </Button>
          </div>
        ) : null}
      </Section>
      {needsDeclaration && (sendable || declaredAt) ? (
        <Section title={text.declarationTitle}>
          <div className="rounded-lg border border-border bg-muted/10 px-3 py-3" data-testid="lead-request-declaration">
            <label className="flex items-start gap-3 text-sm">
              {/* Sent and unchanged: the confirmation given with that sending is shown, not asked again. */}
              <input
                type="checkbox"
                className={cn(checkboxClass, "mt-0.5")}
                checked={sendable ? confirmed : true}
                disabled={!sendable || busy}
                required
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span className="space-y-1">
                <span className="block leading-snug">
                  {text.declarationLabel}
                  {sendable ? <RequiredMark /> : null}
                </span>
                {!sendable && declaredAt ? (
                  <span className="block text-xs text-muted-foreground">
                    {text.declarationGivenAt(formatAppDateTime(declaredAt))}
                  </span>
                ) : null}
              </span>
            </label>
          </div>
        </Section>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      <StepFooter index={index} total={total} text={text}>
        {request.submitted_at ? (
          // Sent already: changing the request is the secondary path, not the next step.
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-9 gap-1.5" onClick={() => onEdit("person")}>
              <Pencil aria-hidden="true" className="size-3.5" />
              {text.editData}
            </Button>
            <Button type="button" variant="outline" className="h-9 gap-1.5" onClick={() => onEdit("documents")}>
              <Upload aria-hidden="true" className="size-3.5" />
              {text.addDocuments}
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" className="h-9" onClick={() => onEdit("documents")}>
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            {text.back}
          </Button>
        )}
        {sendable ? (
          <Button
            type="button"
            className="h-9 gap-2"
            // Without the confirmation nothing is sent: the button stays off until the box is ticked.
            disabled={!ready || busy || (needsDeclaration && !confirmed)}
            onClick={() => void send()}
            data-testid="lead-request-submit"
          >
            {busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Send aria-hidden="true" className="size-3.5" />}
            {busy ? text.sending : sent ? text.sendAgain : text.sendButton}
          </Button>
        ) : null}
      </StepFooter>
    </section>
  );
}

/** The statements of the request, read-only and grouped like the form. */
function RequestSummary({ groups }: { groups: SummaryGroup[] }) {
  return (
    <div className="divide-y divide-border rounded-lg border border-border" data-testid="lead-request-summary">
      {groups.map((group) => (
        <section key={group.id} className="px-3 py-2.5" data-testid={`lead-request-summary-${group.id}`}>
          <h4 className="text-xs font-semibold text-foreground">{group.title}</h4>
          {group.rows.length === 0 && !group.parts?.length ? (
            <p className="mt-1 text-sm text-muted-foreground">{group.empty}</p>
          ) : (
            <SummaryRows rows={group.rows} />
          )}
          {group.note ? (
            <p className="mt-2 text-xs leading-5 text-muted-foreground" data-testid={`lead-request-summary-${group.id}-note`}>
              {group.note}
            </p>
          ) : null}
          {/* The persons of the group: each representative with the own statements and files. */}
          {group.parts?.map((part) => (
            <div
              key={part.id}
              className="mt-2.5 border-t border-dashed border-border pt-2"
              data-testid={`lead-request-summary-${group.id}-${part.id}`}
            >
              <h5 className="text-xs font-medium text-foreground">{part.title}</h5>
              {part.rows.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">{group.empty}</p>
              ) : (
                <SummaryRows rows={part.rows} />
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/** Rows of the summary: label beside value, or a plain list when no row has a label. */
export function SummaryRows({ rows }: { rows: SummaryRow[] }) {
  if (rows.length === 0) return null;
  if (rows.every((row) => !row.label)) {
    // A plain list: the uploaded files.
    return (
      <ul className="mt-1.5 space-y-1 text-sm">
        {rows.map((row, index) => (
          <li key={`${row.value}-${index}`} className="break-words">
            {row.value}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <dl className="mt-1.5 space-y-1.5 text-sm">
      {rows.map((row) => (
        // Stacked on a phone, label beside value from the tablet width on.
        <div key={row.label} className="sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
          <dt className="text-xs leading-5 text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 whitespace-pre-line break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
