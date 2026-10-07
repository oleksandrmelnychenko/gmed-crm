import { useState } from "react";
import { Check, LoaderCircle, RotateCcw, ShieldAlert, Undo2, X } from "lucide-react";

import { Section, StatusBadge, checkboxClass, tokens } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";
import { SanctionsReasonDialog } from "@/pages/sanctions/components";

import type { Tx } from "../model/lead-payer";
import {
  RISK_BLOCK_KEYS,
  riskAssessmentStarted,
  riskAvailableDecisions,
  riskBlockLabel,
  riskCanRestart,
  riskCanWithdraw,
  riskCauseLabel,
  riskDecisionErrorText,
  riskDecisionLabel,
  riskDecisionNeedsSecondReviewer,
  riskDisplayedScore,
  riskEventLabel,
  riskLevelLabel,
  riskLevelTone,
  riskMissingLabel,
  riskPartyLabel,
  riskPointsLine,
  riskSecondReviewerMissing,
  riskShowsPreview,
  riskStatusLabel,
  riskStatusTone,
  riskSubjectLabel,
  riskSuggestedBlocks,
  riskTriggerLabel,
  riskVariantLabel,
  type LeadRiskAssessment,
  type RiskBlockState,
  type RiskDecision,
  type RiskDecisionKind,
} from "../model/lead-risk-assessment";
import type { LeadRiskController } from "../model/use-lead-risk-assessment";

const SECTION_CLASS = "rounded-xl border border-border/70 bg-card p-4";
const WARNING_TEXT = "text-amber-700 dark:text-amber-300";

type DialogState =
  | { kind: "decide"; decision: RiskDecisionKind }
  | { kind: "confirm"; decisionId: string; decision: RiskDecisionKind }
  | { kind: "withdraw"; decisionId: string }
  | null;

function Caption({ children }: { children: string }) {
  return <h4 className="text-xs font-semibold text-foreground">{children}</h4>;
}

function TriggerTable({ assessment, tx }: { assessment: LeadRiskAssessment; tx: Tx }) {
  const score = riskDisplayedScore(assessment);
  if (score.triggers.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="lead-risk-no-triggers">
        {tx("Триггеры не сработали", "Keine Auslöser")}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-xs" data-testid="lead-risk-triggers">
        <thead className="text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
          <tr className="border-b border-border/70">
            <th className="py-1.5 pr-3 font-medium">{tx("Триггер", "Auslöser")}</th>
            <th className="py-1.5 pr-3 font-medium">{tx("Кого касается", "Betrifft")}</th>
            <th className="py-1.5 pr-3 text-right font-medium">{tx("Баллы", "Punkte")}</th>
            <th className="py-1.5 pr-3 font-medium">{tx("Состояние", "Zustand")}</th>
            <th className="py-1.5 font-medium">{tx("Впервые", "Erstmals")}</th>
          </tr>
        </thead>
        <tbody>
          {score.triggers.map((trigger) => {
            const knockout = trigger.knockout;
            const variant = riskVariantLabel(trigger.variant, tx);
            return (
              <tr
                key={`${trigger.key}-${trigger.subject}`}
                className="border-b border-border/50 last:border-b-0"
                data-testid={`lead-risk-trigger-${trigger.key}`}
                data-active={trigger.active ? "true" : "false"}
              >
                <td className="py-1.5 pr-3 align-top">
                  <span className="font-mono text-[11px] text-muted-foreground">{trigger.key}</span>{" "}
                  <span className="font-medium text-foreground">{riskTriggerLabel(trigger.key, tx)}</span>
                  {variant ? <span className="text-muted-foreground"> · {variant}</span> : null}
                </td>
                <td className="py-1.5 pr-3 align-top">{riskSubjectLabel(trigger.subject, tx)}</td>
                <td className="py-1.5 pr-3 text-right align-top font-semibold tabular-nums">
                  {knockout ? <span className="text-rose-700 dark:text-rose-300">K.o.</span> : trigger.points}
                </td>
                <td className="py-1.5 pr-3 align-top">
                  {trigger.active
                    ? tx("действует", "aktiv")
                    : tx("зафиксирован (данные изменились)", "festgehalten (Daten geändert)")}
                </td>
                <td className="py-1.5 align-top tabular-nums">{formatAppDate(trigger.first_fired_at) || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BlockRow({ block, requested, tx }: { block: RiskBlockState; requested: boolean; tx: Tx }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" data-testid={`lead-risk-block-${block.key}`}>
      <span className="font-mono text-[11px] font-semibold text-foreground">{block.key}</span>
      <span className="font-medium text-foreground">{riskBlockLabel(block.key, tx)}</span>
      <span className="text-muted-foreground">· {riskPartyLabel(block.party, tx)}</span>
      {requested ? <span className="text-muted-foreground">· {tx("запрошено", "angefordert")}</span> : null}
      <span className={block.answered ? "text-emerald-700 dark:text-emerald-300" : WARNING_TEXT}>
        · {block.answered ? tx("ответ получен", "beantwortet") : tx("ждём ответ", "offen")}
      </span>
      {block.missing.length > 0 ? (
        <span className="w-full text-xs text-muted-foreground" data-testid={`lead-risk-block-${block.key}-missing`}>
          {tx("не хватает", "fehlt")}: {block.missing.map((key) => riskMissingLabel(key, tx)).join(", ")}
        </span>
      ) : null}
    </li>
  );
}

function DecisionLine({ decision, tx }: { decision: RiskDecision; tx: Tx }) {
  const proposalState = decision.proposal_state === "confirmed"
    ? tx("подтверждено", "bestätigt")
    : decision.proposal_state === "withdrawn"
      ? tx("отозвано", "zurückgenommen")
      : tx("ждёт второго проверяющего", "wartet auf Zweitprüfung");
  const kind = decision.confirms_decision_id || decision.kind === "confirmation"
    ? tx("подтверждение", "Bestätigung")
    : decision.withdraws_decision_id || decision.kind === "withdrawal"
      ? tx("отзыв предложения", "Rücknahme des Vorschlags")
      : decision.kind === "proposal"
        ? `${tx("предложение", "Vorschlag")} · ${proposalState}`
        : null;
  return (
    <li className="space-y-0.5" data-testid="lead-risk-decision">
      <div className="flex flex-wrap gap-x-2 text-foreground">
        <span className="tabular-nums text-muted-foreground">{formatAppDateTime(decision.decided_at) || "—"}</span>
        <span className="font-medium">{riskDecisionLabel(decision.decision, tx)}</span>
        {kind ? <span className="text-muted-foreground">({kind})</span> : null}
        {decision.level ? <span className="text-muted-foreground">· {riskLevelLabel(decision.level, tx)}</span> : null}
        {decision.decided_by_name ? <span className="text-muted-foreground">· {decision.decided_by_name}</span> : null}
      </div>
      {decision.blocks.length > 0 ? (
        <div className="text-muted-foreground">
          {tx("Блоки", "Blöcke")}: {decision.blocks.map((key) => `${key} ${riskBlockLabel(key, tx)}`).join(", ")}
        </div>
      ) : null}
      {decision.reason ? <div className="whitespace-pre-line text-foreground">{decision.reason}</div> : null}
    </li>
  );
}

/**
 * "Оценка риска / Risikobewertung" in the documents step of the lead wizard:
 * level (1 green, 2 amber, 3 red, K.o.), points per subject, the triggers,
 * the follow-up blocks with who answers them, status, decisions and history.
 * Reviewers decide with a reason; at level 3 a release or a reject is a
 * proposal until a second reviewer confirms it. Before the assessment starts
 * the live preview is shown. Read-only for everybody else. Staff only: the
 * lead and the payer never see any of this.
 */
export function LeadRiskAssessmentPanel({
  assessment,
  controller,
  tx,
  disabled = false,
  currentUserId = null,
}: {
  assessment: LeadRiskAssessment | null;
  controller: LeadRiskController;
  tx: Tx;
  disabled?: boolean;
  currentUserId?: string | null;
}) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [blocks, setBlocks] = useState<string[]>([]);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState("");

  if (!assessment) return null;

  const started = riskAssessmentStarted(assessment);
  const preview = riskShowsPreview(assessment);
  const score = riskDisplayedScore(assessment);
  const decisions = riskAvailableDecisions(assessment);
  const proposal = assessment.pending_proposal;
  const canWithdraw = riskCanWithdraw(assessment, currentUserId);
  const secondReviewerMissing = riskSecondReviewerMissing(assessment);
  const requested = new Set(assessment.requested_blocks);
  const blocksShown = assessment.blocks.filter((block) => block.open || requested.has(block.key));

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      throw new Error(riskDecisionErrorText(error, tx) ?? (error instanceof Error && error.message ? error.message : tx("Ошибка", "Fehler")));
    }
  };

  const openDecision = (decision: RiskDecisionKind) => {
    setBlocks(decision === "request_more" ? riskSuggestedBlocks(assessment) : []);
    setDialog({ kind: "decide", decision });
  };

  const restart = async () => {
    setRestarting(true);
    setRestartError("");
    try {
      await controller.restart();
    } catch (error) {
      setRestartError(riskDecisionErrorText(error, tx) ?? (error instanceof Error ? error.message : tx("Ошибка", "Fehler")));
    } finally {
      setRestarting(false);
    }
  };

  const dialogTitle = (() => {
    if (!dialog) return "";
    if (dialog.kind === "confirm") return `${tx("Подтвердить решение", "Entscheidung bestätigen")}: ${riskDecisionLabel(dialog.decision, tx)}`;
    if (dialog.kind === "withdraw") return tx("Отозвать предложение", "Vorschlag zurücknehmen");
    if (dialog.decision === "request_more") return tx("Запросить дополнительные сведения", "Weitere Angaben anfordern");
    const proposalOnly = riskDecisionNeedsSecondReviewer(assessment, dialog.decision);
    if (dialog.decision === "release") {
      return proposalOnly ? tx("Предложить разрешение", "Freigabe vorschlagen") : tx("Разрешить работу с обращением", "Anfrage freigeben");
    }
    return proposalOnly ? tx("Предложить отклонение", "Ablehnung vorschlagen") : tx("Отклонить обращение", "Anfrage ablehnen");
  })();

  const dialogDescription = (() => {
    if (!dialog) return "";
    if (dialog.kind === "confirm") {
      return tx(
        "Вы второй проверяющий: после подтверждения решение вступает в силу.",
        "Sie sind die zweite prüfende Person: Mit der Bestätigung wird die Entscheidung wirksam.",
      );
    }
    if (dialog.kind === "withdraw") return tx("Предложение снимается; решение можно предложить заново.", "Der Vorschlag entfällt; er kann neu gestellt werden.");
    const fourEyes = riskDecisionNeedsSecondReviewer(assessment, dialog.decision)
      ? ` ${tx(
          "Уровень 3: решение вступит в силу после подтверждения другим проверяющим (принцип четырёх глаз).",
          "Stufe 3: Die Entscheidung wird erst mit der Bestätigung einer anderen prüfenden Person wirksam (Vier-Augen-Prinzip).",
        )}`
      : "";
    if (dialog.decision === "request_more") {
      return tx(
        "Пациент (или плательщик по своей ссылке) увидит только нейтральные вопросы выбранных блоков — без баллов, уровня и причин.",
        "Patient bzw. Zahler (über den eigenen Link) sehen nur die neutralen Fragen der gewählten Blöcke – ohne Punkte, Stufe und Gründe.",
      );
    }
    if (dialog.decision === "release") {
      return tx(
        "Разрешение снимает удержание подписей, квалификации и конвертации. Новый триггер или рост баллов отменяет его.",
        "Die Freigabe hebt das Zurückhalten von Unterschriften, Qualifizierung und Konvertierung auf. Ein neuer Auslöser oder mehr Punkte heben sie wieder auf.",
      ) + fourEyes;
    }
    return tx(
      "Отклонение ничего не отправляет пациенту; позже его можно заменить разрешением.",
      "Die Ablehnung wird dem Patienten nicht mitgeteilt; später kann eine Freigabe folgen.",
    ) + fourEyes;
  })();

  return (
    <div
      data-testid="lead-risk-assessment"
      data-level={score.level}
      data-status={assessment.status ?? "not_started"}
    >
      <Section
        className={SECTION_CLASS}
        title={tx("Оценка риска", "Risikobewertung")}
        accessory={riskCanRestart(assessment) ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg"
            disabled={disabled || restarting}
            onClick={() => void restart()}
            data-testid="lead-risk-restart"
          >
            {restarting ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : <RotateCcw aria-hidden className="size-3.5" />}
            {tx("Начать оценку", "Bewertung starten")}
          </Button>
        ) : null}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex" data-testid="lead-risk-level" data-level={score.level}>
            <StatusBadge tone={riskLevelTone(score.level)}>{riskLevelLabel(score.level, tx)}</StatusBadge>
          </span>
          {score.knockout ? (
            <span className="inline-flex" data-testid="lead-risk-knockout">
              <StatusBadge tone="error">K.o.</StatusBadge>
            </span>
          ) : null}
          <span className="inline-flex" data-testid="lead-risk-status">
            <StatusBadge tone={riskStatusTone(assessment.status)}>{riskStatusLabel(assessment.status, tx)}</StatusBadge>
          </span>
          <span className="text-xs text-muted-foreground" data-testid="lead-risk-points">
            {tx("Баллы", "Punkte")}: <span className="font-semibold text-foreground tabular-nums">{riskPointsLine(score, tx)}</span>
          </span>
        </div>

        {preview ? (
          <p className="text-xs leading-5 text-muted-foreground" data-testid="lead-risk-preview">
            {assessment.status === "grandfathered"
              ? tx(
                  "Обращение квалифицировано до введения оценки: удержания нет. Ниже — предварительный расчёт по текущим данным (не сохранён).",
                  "Anfrage vor Einführung der Bewertung qualifiziert: kein Zurückhalten. Unten die Vorschau nach aktuellen Daten (nicht gespeichert).",
                )
              : tx(
                  "Предварительный расчёт (не сохранён): оценка начнётся, когда пациент отправит анкету или при первом действии с документами.",
                  "Vorschau (nicht gespeichert): Die Bewertung beginnt mit dem Senden der Anfrage durch den Patienten oder der ersten Dokumentenaktion.",
                )}
          </p>
        ) : null}
        {restartError ? (
          <p role="alert" className="text-xs font-medium text-destructive">{restartError}</p>
        ) : null}

        <TriggerTable assessment={assessment} tx={tx} />

        {started && blocksShown.length > 0 ? (
          <div className="space-y-1.5" data-testid="lead-risk-blocks">
            <Caption>{tx("Дополнительные сведения", "Ergänzende Angaben")}</Caption>
            <ul className="space-y-1 text-xs">
              {blocksShown.map((block) => (
                <BlockRow key={block.key} block={block} requested={requested.has(block.key)} tx={tx} />
              ))}
            </ul>
            {assessment.follow_up_answered_at ? (
              <p className="text-xs text-muted-foreground" data-testid="lead-risk-follow-up-answered">
                {tx("Пациент отправил сведения", "Angaben gesendet am")} {formatAppDateTime(assessment.follow_up_answered_at)}
              </p>
            ) : null}
          </div>
        ) : null}

        {proposal ? (
          <div
            className={cn("space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs dark:border-amber-500/30 dark:bg-amber-500/10")}
            data-testid="lead-risk-proposal"
          >
            <div className="font-semibold text-foreground">
              {tx("Предложение", "Vorschlag")}: {riskDecisionLabel(proposal.decision, tx)}
              {" — "}
              {proposal.decided_by_name ?? "—"}, {formatAppDateTime(proposal.decided_at)}
            </div>
            {proposal.reason ? <div className="whitespace-pre-line text-foreground">{proposal.reason}</div> : null}
            <p className={WARNING_TEXT} data-testid="lead-risk-four-eyes">
              {tx(
                "Принцип четырёх глаз: решение вступит в силу после подтверждения другим проверяющим.",
                "Vier-Augen-Prinzip: Die Entscheidung wird mit der Bestätigung einer anderen prüfenden Person wirksam.",
              )}
            </p>
            {assessment.can_confirm || canWithdraw ? (
              <div className="flex flex-wrap gap-2">
                {assessment.can_confirm ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={disabled}
                    onClick={() => setDialog({ kind: "confirm", decisionId: proposal.id, decision: proposal.decision })}
                  >
                    <Check aria-hidden className="size-3.5" />
                    {tx("Подтвердить", "Bestätigen")}
                  </Button>
                ) : null}
                {canWithdraw ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => setDialog({ kind: "withdraw", decisionId: proposal.id })}
                  >
                    <Undo2 aria-hidden className="size-3.5" />
                    {tx("Отозвать", "Zurücknehmen")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {secondReviewerMissing ? (
          <p className={cn("text-xs font-medium leading-5", WARNING_TEXT)} data-testid="lead-risk-second-reviewer-missing">
            {tx(
              "Второго проверяющего нет: уровень 3 нельзя разрешить, пока CEO не назначит заместителя (Санкционные проверки → Оценка риска).",
              "Keine zweite prüfende Person: Stufe 3 kann erst freigegeben werden, wenn der CEO eine Vertretung benennt (Sanktionsprüfung → Risikobewertung).",
            )}
          </p>
        ) : null}

        {decisions.length > 0 ? (
          <div className="space-y-1.5" data-testid="lead-risk-actions">
            {score.level === 3 && !proposal ? (
              <p className="text-xs leading-5 text-muted-foreground">
                {tx(
                  "Уровень 3: разрешение и отклонение — это предложение; в силу вступает после подтверждения вторым проверяющим.",
                  "Stufe 3: Freigabe und Ablehnung sind Vorschläge; wirksam erst nach Bestätigung durch eine zweite prüfende Person.",
                )}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {decisions.map((decision) => (
                <Button
                  key={decision}
                  type="button"
                  size="sm"
                  variant={decision === "release" ? "default" : decision === "reject" ? "destructive" : "outline"}
                  disabled={disabled}
                  onClick={() => openDecision(decision)}
                  data-testid={`lead-risk-decide-${decision}`}
                >
                  {decision === "release" ? <Check aria-hidden className="size-3.5" /> : decision === "reject" ? <X aria-hidden className="size-3.5" /> : <ShieldAlert aria-hidden className="size-3.5" />}
                  {riskDecisionLabel(decision, tx)}
                </Button>
              ))}
            </div>
          </div>
        ) : !assessment.can_decide && started ? (
          <p className="text-xs text-muted-foreground" data-testid="lead-risk-read-only">
            {tx(
              "Решения принимают CEO и назначенные им заместители.",
              "Entscheidungen treffen der CEO und die von ihm benannten Vertreter.",
            )}
          </p>
        ) : null}

        {assessment.decisions.length > 0 || assessment.history.length > 0 ? (
          <details className="text-xs" data-testid="lead-risk-history">
            <summary className={cn("cursor-pointer select-none", tokens.text.label)}>
              {tx("Решения и история", "Entscheidungen und Verlauf")}
            </summary>
            <div className="mt-2 grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Caption>{tx("Решения", "Entscheidungen")}</Caption>
                {assessment.decisions.length > 0 ? (
                  <ul className="space-y-2">
                    {assessment.decisions.map((decision) => (
                      <DecisionLine key={decision.id} decision={decision} tx={tx} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">{tx("Решений ещё нет", "Noch keine Entscheidungen")}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Caption>{tx("История", "Verlauf")}</Caption>
                <ul className="space-y-1">
                  {assessment.history.map((event) => (
                    <li key={event.id} className="flex flex-wrap gap-x-2" data-testid="lead-risk-event">
                      <span className="tabular-nums text-muted-foreground">{formatAppDateTime(event.at) || "—"}</span>
                      <span className="font-medium text-foreground">{riskEventLabel(event, tx)}</span>
                      {event.level ? <span className="text-muted-foreground">· {riskLevelLabel(event.level, tx)}</span> : null}
                      {event.points !== null ? <span className="text-muted-foreground">· {event.points} {tx("б.", "P.")}</span> : null}
                      {event.cause ? <span className="text-muted-foreground">· {riskCauseLabel(event.cause, tx)}</span> : null}
                      {event.actor_name ? <span className="text-muted-foreground">· {event.actor_name}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        ) : null}
      </Section>

      <SanctionsReasonDialog
        open={dialog !== null}
        title={dialogTitle}
        description={dialogDescription}
        confirmLabel={
          dialog?.kind === "confirm"
            ? tx("Подтвердить", "Bestätigen")
            : dialog?.kind === "withdraw"
              ? tx("Отозвать", "Zurücknehmen")
              : dialog
                ? riskDecisionLabel(dialog.decision, tx)
                : ""
        }
        destructive={dialog?.kind === "decide" && dialog.decision === "reject"}
        onConfirm={async (reason) => {
          const current = dialog;
          if (!current) return;
          if (current.kind === "confirm") {
            await run(() => controller.confirm(current.decisionId, reason));
          } else if (current.kind === "withdraw") {
            await run(() => controller.withdraw(current.decisionId, reason));
          } else if (current.decision === "request_more") {
            if (blocks.length === 0) throw new Error(tx("Выберите хотя бы один блок.", "Bitte mindestens einen Block auswählen."));
            await run(() => controller.decide({ decision: "request_more", reason, blocks }));
          } else {
            await run(() => controller.decide({ decision: current.decision, reason }));
          }
        }}
        onClose={() => setDialog(null)}
      >
        {dialog?.kind === "decide" && dialog.decision === "request_more" ? (
          <fieldset className="space-y-1.5" data-testid="lead-risk-block-chooser">
            <legend className={cn(tokens.text.label, "mb-1")}>{tx("Какие сведения запросить", "Welche Angaben anfordern")}</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {RISK_BLOCK_KEYS.map((key) => (
                <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={blocks.includes(key)}
                    onChange={(event) =>
                      setBlocks((current) =>
                        event.target.checked
                          ? RISK_BLOCK_KEYS.filter((item) => item === key || current.includes(item))
                          : current.filter((item) => item !== key),
                      )
                    }
                  />
                  <span>
                    <span className="font-mono text-xs font-semibold">{key}</span> {riskBlockLabel(key, tx)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </SanctionsReasonDialog>
    </div>
  );
}
