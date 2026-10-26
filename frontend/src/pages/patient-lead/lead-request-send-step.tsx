import { useState } from "react";
import { ArrowLeft, ArrowRight, Info, LoaderCircle, LogOut, Pencil, Send, Upload } from "lucide-react";

import { Banner, SuccessBanner } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { checkboxClass } from "@/components/record-workspace/primitives/design-tokens";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { useAuth } from "@/lib/auth";
import { rememberSignOutNotice } from "@/lib/login-redirect";
import { cn } from "@/lib/utils";

import { FOLLOW_UP_INCOMPLETE, INQUIRY_CONSENT, submitLeadRequest, type LeadRequest } from "./lead-request-api";
import { followUpAnswered, followUpBeforeSubmit, followUpMissingAll, followUpShown, missingOfRefusal } from "./lead-request-follow-up-model";
import { canSubmit, consentGiven, type SubmitField } from "./lead-request-model";
import { CabinetSection as Section, MissingItemLink, RequiredMark, SentLockHint, StepFooter, errorBody, errorMessage, type RequestQueue, type Step } from "./lead-request-parts";
import { missingListKeys, recipientIsPayer, type CabinetTarget } from "./lead-request-field-target";
import { hasBaseFormInput, missingByStep, visibleSteps, type StepId } from "./lead-request-steps";
import { requestSummary, type SummaryGroup, type SummaryRow } from "./lead-request-summary";
import { extraWorkSubject, followUpFieldLabel, submitFieldLabel, type LeadRequestText } from "./lead-request-text";

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
}: {
  request: LeadRequest;
  text: LeadRequestText;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
  /** Opens a step and shows the field a missing item names (`CabinetGoTo`). */
  onEdit: (step: Step, target?: CabinetTarget) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { logout } = useAuth();
  const guardian = request.access_kind === "guardian";
  // "You: …" and "Other parent: …" in the lists, as on the steps (labels audit 2026-10-26, B5).
  const who = {
    mineSlot: request.representation?.representatives.find((person) => person.mine)?.slot ?? null,
    custody: request.representation?.custody ?? null,
  };
  // Base fields and live country questions share the first submission.
  // Staff follow-up after submission retains its separate send action.
  const byStep = missingByStep(request);
  for (const step of visibleSteps(request)) byStep[step] = byStep[step].filter(hasBaseFormInput);
  const missingSteps = visibleSteps(request).filter(
    (step): step is Exclude<StepId, "send" | "follow_up"> => step !== "send" && step !== "follow_up" && byStep[step].length > 0,
  );
  const shownKeys = new Set(missingSteps.flatMap((step) => byStep[step]));
  const otherMissing = request.progress.missing_for_submit.filter((key) => !shownKeys.has(key));
  // A payer key the paying recipient's field answers is listed as that field, once (QA 2026-10-24, C-1).
  const recipientPays = recipientIsPayer(request);
  for (const step of missingSteps) byStep[step] = missingListKeys(byStep[step], recipientPays);
  const previewMissing = followUpBeforeSubmit(request) ? followUpMissingAll(request) : [];
  const missingCount = shownKeys.size + otherMissing.length + previewMissing.length;
  const inquiryConsent = consentGiven(request, INQUIRY_CONSENT);
  // After sending, GMED may ask for more: the neutral pointer to the step (never why).
  const followUpOpen = Boolean(request.submitted_at) && followUpShown(request) && !followUpAnswered(request);
  const ready = canSubmit(request, INQUIRY_CONSENT);
  const sent = Boolean(request.submitted_at);
  // The request is sent once (owner 2026-10-26): afterwards it is read-only, documents are
  // added on their step, and what GMED asks later goes with the follow-up's own send.
  const sendable = !sent;
  // A server that knows the GwG statements wants them confirmed with every sending.
  const needsDeclaration = request.identification !== undefined;
  const declaredAt = request.identification?.declared_correct_at ?? null;

  // «Abschließen und abmelden»: the usual sign-out; the login page thanks once.
  async function finish() {
    setSigningOut(true);
    rememberSignOutNotice(text.signedOutThanks);
    try {
      await logout();
    } finally {
      setSigningOut(false);
    }
  }

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
      const body = errorBody(cause);
      const missing = body?.code === FOLLOW_UP_INCOMPLETE ? missingOfRefusal(body) : null;
      if (missing) {
        onChange({
          ...request,
          follow_up: {
            ...request.follow_up,
            required: true,
            before_submit: !request.submitted_at,
            blocks: [...new Set([...(request.follow_up?.blocks ?? []), ...Object.keys(missing)])],
            missing,
            answered_at: request.follow_up?.answered_at ?? null,
          },
        });
        setError(text.followUpIncomplete);
      } else {
        setError(body?.code === "declaration_required" ? text.declarationRequired : errorMessage(cause, text));
      }
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
            {/* One thank-you (QA 2026-10-10). No review notice (owner 2026-10-22): it repeated the
                first items of "what happens next" below. */}
            <p data-testid="lead-request-sent">{text.sentBody(formatAppDateTime(request.submitted_at))}</p>
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
          <SentLockHint text={text} />
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
        <RequestSummary groups={requestSummary(request, text, lang)} />
        {missingCount > 0 || !inquiryConsent ? (
          <div
            className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
            data-testid="lead-request-missing"
          >
            <p className="font-medium">{text.missingTitle}</p>
            {/* Every item leads straight to its step and field (owner report 2026-10-21). */}
            {!inquiryConsent ? (
              <ul className="list-disc space-y-0.5 pl-5">
                <li>
                  <MissingItemLink field="inquiry_consent" onClick={() => onEdit("person", { field: "inquiry_consent" })}>
                    {text.inquiryConsentMissing}
                  </MissingItemLink>
                </li>
              </ul>
            ) : null}
            {/* Grouped by step, each with a way there. */}
            {otherMissing.length > 0 ? <div data-testid="lead-request-missing-other">
              <p className="text-xs font-semibold">{text.furtherDetails}</p>
              <ul className="list-disc space-y-0.5 pl-5">{otherMissing.map((field) => <li key={field}>
                {submitFieldLabel(text, field as SubmitField, guardian, request.payer?.payer_type, request.minor, who)}
              </li>)}</ul>
            </div> : null}
            {missingSteps.map((step) => (
              <div key={step} data-testid={`lead-request-missing-${step}`}>
                <button
                  type="button"
                  className="text-xs font-semibold underline-offset-2 hover:underline"
                  onClick={() => onEdit(step, { field: byStep[step][0] })}
                >
                  {text.steps[step]}
                </button>
                <ul className="list-disc space-y-0.5 pl-5">
                  {byStep[step].map((field) => (
                    <li key={field} className="break-words">
                      <MissingItemLink field={field} onClick={() => onEdit(step, { field })}>
                        {submitFieldLabel(text, field as SubmitField, guardian, request.payer?.payer_type, request.minor, who)}
                      </MissingItemLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {previewMissing.length > 0 ? <div data-testid="lead-request-missing-follow_up">
              <button type="button" className="text-xs font-semibold underline-offset-2 hover:underline" onClick={() => onEdit("follow_up", { field: `${previewMissing[0].block}:${previewMissing[0].key}` })}>{text.steps.follow_up}</button>
              <ul className="list-disc space-y-0.5 pl-5">{previewMissing.map(({ block, key }) => <li key={`${block}:${key}`} className="break-words">
                <MissingItemLink field={`${block}:${key}`} onClick={() => onEdit("follow_up", { field: `${block}:${key}` })}>
                  {followUpFieldLabel(text, key, guardian, request.follow_up?.representatives, extraWorkSubject(request))}
                </MissingItemLink>
              </li>)}</ul>
            </div> : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
              // To the first field that is still missing, in whichever step it is.
              onClick={() => {
                if (!inquiryConsent) onEdit("person", { field: "inquiry_consent" });
                else if (missingSteps[0]) onEdit(missingSteps[0], { field: byStep[missingSteps[0]][0] });
                else if (previewMissing[0]) onEdit("follow_up", { field: `${previewMissing[0].block}:${previewMissing[0].key}` });
                else onEdit("person");
              }}
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
                aria-label={text.declarationLabel}
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
          {/* Everything else is there: say why "send" is still off (the button alone does not). */}
          {sendable && ready && !confirmed ? (
            <p className="text-xs text-muted-foreground" data-testid="lead-request-declaration-hint">{text.declarationRequired}</p>
          ) : null}
        </Section>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      <StepFooter>
        {request.submitted_at ? (
          // Sent already: documents can still be added; the form itself is read-only.
          <Button type="button" variant="outline" className="h-9 gap-1.5" onClick={() => onEdit("documents")} data-testid="lead-request-go-add-documents">
            <Upload aria-hidden="true" className="size-3.5" />
            {text.addDocumentsAfterSend}
          </Button>
        ) : (
          <Button type="button" variant="outline" className="h-9" onClick={() => onEdit("documents")}>
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            {text.back}
          </Button>
        )}
        {sent ? (
          <Button type="button" className="h-9 gap-2" disabled={signingOut} onClick={() => void finish()} data-testid="lead-request-finish">
            {signingOut ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <LogOut aria-hidden="true" className="size-3.5" />}
            {text.finishAndSignOut}
          </Button>
        ) : null}
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
            {busy ? text.sending : text.sendButton}
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
      {rows.map((row, index) => (
        // Stacked on a phone, label beside value from the tablet width on. A label
        // can repeat (several trusted persons), so the position keys the row.
        <div key={`${row.label}-${index}`} className="sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
          <dt className="text-xs leading-5 text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 whitespace-pre-line break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
