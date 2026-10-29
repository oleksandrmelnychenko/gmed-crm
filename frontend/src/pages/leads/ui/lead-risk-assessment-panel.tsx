import { useState } from "react";
import { CalendarDays, Check, ChevronDown, History, Info, LoaderCircle, RotateCcw, ShieldAlert, Undo2, UserRound, X } from "lucide-react";

import { DataTable } from "@/components/data-table/data-table";
import type { ColumnDef } from "@/components/data-table/types";

import { Section, checkboxClass, tokens } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { countryLabel } from "@/components/ui/country-select";
import { leadRequestText } from "@/pages/patient-lead/lead-request-text";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";
import { SanctionsReasonDialog } from "@/pages/sanctions/components";

import type { Tx } from "../model/lead-payer";
import { REPRESENTATIVE_COUNTRY_FIELDS, REPRESENTATIVE_QUESTIONS } from "@/pages/patient-lead/lead-request-representative-questions-model";
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
  riskDisplayedScore,
  riskEventLabel,
  riskLevelLabel,
  riskLevelTone,
  riskMissingLabel,
  riskPartyLabel,
  riskPointsLine,
  riskShowsPreview,
  riskStatusLabel,
  riskStatusTone,
  riskSubjectLabel,
  riskSuggestedBlocks,
  riskTriggerLabel,
  riskTriggerStateLabel,
  riskVariantLabel,
  type LeadRiskAssessment,
  type RiskBlockState,
  type RiskDecision,
  type RiskDecisionKind,
  type RiskTrigger,
} from "../model/lead-risk-assessment";
import type { LeadRiskController } from "../model/use-lead-risk-assessment";

const SECTION_CLASS = "@container/risk rounded-xl border border-border/70 bg-card p-3.5";
const WARNING_TEXT = "text-amber-700 dark:text-amber-300";

type DialogState =
  | { kind: "decide"; decision: RiskDecisionKind }
  | { kind: "confirm"; decisionId: string; decision: RiskDecisionKind }
  | { kind: "withdraw"; decisionId: string }
  | null;

function Caption({ children }: { children: string }) {
  return <h4 className="text-sm font-semibold text-foreground">{children}</h4>;
}

function TriggerTable({ assessment, tx }: { assessment: LeadRiskAssessment; tx: Tx }) {
  const score = riskDisplayedScore(assessment);
  const representatives = assessment.representatives ?? [];
  if (score.triggers.length === 0) {
    return null;
  }
  const columns: ColumnDef<RiskTrigger>[] = [
    {
      id: "trigger",
      label: tx("Триггер", "Auslöser"),
      accessor: (trigger) => riskTriggerLabel(trigger.key, tx, trigger.subject),
      minWidth: 360,
      cellClassName: "whitespace-normal break-words leading-4",
      render: (trigger) => {
        const variant = riskVariantLabel(trigger.variant, tx);
        return (
          <span className="flex flex-wrap items-center gap-2" data-testid={`lead-risk-trigger-${trigger.key}`} data-active={trigger.active ? "true" : "false"}>
            <StatusChip className="border-violet-200 bg-violet-50 font-mono text-violet-700 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200">{trigger.key}</StatusChip>
            <span className="font-medium">{riskTriggerLabel(trigger.key, tx, trigger.subject)}</span>
            {variant ? <StatusChip>{variant}</StatusChip> : null}
          </span>
        );
      },
    },
    {
      id: "subject", label: tx("Кого касается", "Betrifft"),
      accessor: (trigger) => riskSubjectLabel(trigger.subject, tx, trigger.variant, representatives, trigger),
      width: 150, cellClassName: "whitespace-normal break-words leading-4",
      render: (trigger) => <StatusChip tone="info"><UserRound />{riskSubjectLabel(trigger.subject, tx, trigger.variant, representatives, trigger)}</StatusChip>,
    },
    {
      id: "points",
      label: tx("Баллы", "Punkte"),
      accessor: (trigger) => trigger.points,
      width: 72,
      align: "right",
      render: (trigger) => trigger.knockout
        ? <StatusChip tone="error">K.o.</StatusChip>
        : <StatusChip tone="warning" className="font-mono font-semibold tabular-nums">{trigger.points}</StatusChip>,
    },
    {
      id: "state",
      label: tx("Состояние", "Zustand"),
      accessor: (trigger) => riskTriggerStateLabel(trigger, tx, (value) => formatAppDate(value)),
      width: 240,
      cellClassName: "whitespace-normal break-words leading-4",
      render: (trigger) => (
        <div data-testid={`lead-risk-trigger-${trigger.key}-state`} className="flex flex-wrap items-center gap-1.5">
          <StatusChip tone={trigger.active ? "warning" : "neutral"} className="whitespace-normal text-left">
            {riskTriggerStateLabel({ ...trigger, inactive_since: null }, tx, (value) => formatAppDate(value))}
          </StatusChip>
          {!trigger.active && trigger.inactive_since ? <StatusChip tone="info"><CalendarDays />{formatAppDate(trigger.inactive_since)}</StatusChip> : null}
        </div>
      ),
    },
    {
      id: "first_fired_at",
      label: tx("Впервые", "Erstmals"),
      accessor: (trigger) => trigger.first_fired_at,
      width: 145,
      cellClassName: "whitespace-nowrap font-mono tabular-nums",
      render: (trigger) => trigger.first_fired_at ? <StatusChip tone="info"><CalendarDays />{formatAppDate(trigger.first_fired_at)}</StatusChip> : "—",
    },
  ];
  return (
    <div data-testid="lead-risk-triggers">
      <DataTable
        rows={score.triggers}
        columns={columns}
        rowId={(trigger) => `${trigger.key}-${trigger.subject}`}
        density="compact"
        rowHeightOverrides={{ compact: 56 }}
        mobilePrimaryColumnId="trigger"
        mobileDetailColumnIds={["subject", "points", "state", "first_fired_at"]}
        className="shadow-none sm:max-h-[440px] [&_.data-table-row]:cursor-default"
      />
    </div>
  );
}

function BlockRow({ block, requested, beforeSubmit = false, tx, representatives }: { block: RiskBlockState; requested: boolean; beforeSubmit?: boolean; tx: Tx; representatives: LeadRiskAssessment["representatives"] }) {
  return (
    <li className="min-w-0 space-y-2 rounded-lg border border-border/60 bg-card px-3 py-2.5" data-testid={`lead-risk-block-${block.key}`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip className="border-violet-200 bg-violet-50 font-mono text-violet-700 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200">{block.key}</StatusChip>
        <span className="text-sm font-semibold text-foreground">{riskBlockLabel(block.key, tx)}</span>
        <StatusChip>{riskPartyLabel(block.party, tx)}</StatusChip>
        {/* "запрошено · ждём ответ" or "ответ получен", never both. */}
        {requested && !block.answered ? <StatusChip tone="info">{tx("запрошено", "angefordert")}</StatusChip> : null}
        <StatusChip tone={block.answered ? "success" : "warning"}>
          {block.answered ? <Check /> : <Info />}{beforeSubmit
            ? block.answered ? tx("заполнено", "ausgefüllt") : tx("нужен ответ", "Antwort erforderlich")
            : block.answered ? tx("ответ получен", "beantwortet") : tx("ждём ответ", "offen")}
        </StatusChip>
        </div>
      {block.missing.length > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200" data-testid={`lead-risk-block-${block.key}-missing`}>
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>{tx("Не хватает", "Fehlt")}: {block.missing.map((key) => riskMissingLabel(key, tx, representatives)).join(", ")}</span>
        </div>
      ) : null}
    </li>
  );
}

function DecisionLine({ decision, tx }: { decision: RiskDecision; tx: Tx }) {
  const proposalState = decision.proposal_state === "confirmed"
    ? tx("подтверждено", "bestätigt")
    : decision.proposal_state === "withdrawn"
      ? tx("отозвано", "zurückgenommen")
      : tx("ждёт подтверждения (старое предложение)", "wartet auf Bestätigung (alter Vorschlag)");
  const kind = decision.confirms_decision_id || decision.kind === "confirmation"
    ? tx("подтверждение", "Bestätigung")
    : decision.withdraws_decision_id || decision.kind === "withdrawal"
      ? tx("отзыв предложения", "Rücknahme des Vorschlags")
      : decision.kind === "proposal"
        ? `${tx("предложение", "Vorschlag")} · ${proposalState}`
        : null;
  return (
    <li className="space-y-2 rounded-lg border border-border/60 bg-card p-3" data-testid="lead-risk-decision">
      <div className="flex flex-wrap items-center gap-2 text-foreground">
        <span className="font-semibold">{riskDecisionLabel(decision.decision, tx)}</span>
        {kind ? <StatusChip className="text-foreground">{kind}</StatusChip> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusChip tone="info"><CalendarDays aria-hidden="true" /><time dateTime={decision.decided_at ?? undefined}>{formatAppDateTime(decision.decided_at) || "—"}</time></StatusChip>
        {decision.level ? <StatusChip tone={riskLevelTone(decision.level)}>{riskLevelLabel(decision.level, tx)}</StatusChip> : null}
        {decision.decided_by_name ? <StatusChip className="text-foreground"><UserRound aria-hidden="true" />{decision.decided_by_name}</StatusChip> : null}
      </div>
      {decision.blocks.length > 0 ? (
        <div className="text-sm leading-5 text-foreground">
          {tx("Блоки", "Blöcke")}: {decision.blocks.map((key) => `${key} ${riskBlockLabel(key, tx)}`).join(", ")}
        </div>
      ) : null}
      {decision.reason ? <div className="whitespace-pre-line text-sm leading-6 text-foreground">{decision.reason}</div> : null}
    </li>
  );
}

/**
 * "Оценка риска / Risikobewertung" in the documents step of the lead wizard:
 * level (1 green, 2 amber, 3 red, K.o.), points per subject, the triggers,
 * the follow-up blocks with who answers them, status, decisions and history.
 * Reviewers decide with a mandatory reason; every decision is effective at
 * once, level 3 included (four-eyes removed by the owner on 2026-10-25). A
 * proposal recorded before that can still be confirmed or withdrawn by any
 * reviewer. Before the assessment starts the live preview is shown. Read-only
 * for everybody else. Staff only: the lead and the payer never see any of this.
 */
export function LeadRiskAssessmentPanel({
  assessment,
  controller,
  tx,
  disabled = false,
}: {
  assessment: LeadRiskAssessment | null;
  controller: LeadRiskController;
  tx: Tx;
  disabled?: boolean;
}) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [blocks, setBlocks] = useState<string[]>([]);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState("");

  if (!assessment) return null;

  const started = riskAssessmentStarted(assessment);
  const preview = riskShowsPreview(assessment);
  const questionsBeforeSubmit = !started && assessment.before_submit;
  const score = riskDisplayedScore(assessment);
  const decisions = riskAvailableDecisions(assessment);
  const proposal = assessment.pending_proposal;
  const canWithdraw = riskCanWithdraw(assessment);
  const requested = new Set(assessment.requested_blocks);
  const blocksShown = assessment.blocks.filter((block) => block.open || requested.has(block.key));
  const lang = tx("ru", "de");
  const cabinetText = leadRequestText(lang);

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      throw new Error(riskDecisionErrorText(error, tx) ?? (error instanceof Error && error.message ? error.message : tx("Ошибка", "Fehler")), { cause: error });
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
    if (dialog.decision === "release") return tx("Разрешить работу с обращением", "Anfrage freigeben");
    return tx("Отклонить обращение", "Anfrage ablehnen");
  })();

  const dialogDescription = (() => {
    if (!dialog) return "";
    if (dialog.kind === "confirm") {
      return tx(
        "Предложение записано до отмены второй проверки: после подтверждения решение вступает в силу.",
        "Der Vorschlag stammt aus der Zeit vor dem Wegfall der Zweitprüfung: Mit der Bestätigung wird die Entscheidung wirksam.",
      );
    }
    if (dialog.kind === "withdraw") return tx("Предложение снимается; затем можно принять решение заново.", "Der Vorschlag entfällt; danach kann neu entschieden werden.");
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
      );
    }
    // With a confirmed sanctions hit no permission can follow (QA 2026-10-12, round 3).
    return (assessment.sanctions_confirmed
      ? tx(
          "Отклонение ничего не отправляет пациенту. При подтверждённом совпадении с санкционным списком разрешение невозможно.",
          "Die Ablehnung wird dem Patienten nicht mitgeteilt. Bei einem bestätigten Treffer auf einer Sanktionsliste ist keine Freigabe möglich.",
        )
      : tx(
          "Отклонение ничего не отправляет пациенту; позже его можно заменить разрешением.",
          "Die Ablehnung wird dem Patienten nicht mitgeteilt; später kann eine Freigabe folgen.",
        ));
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
            variant="default"
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
            <StatusChip tone={riskLevelTone(score.level)}>{riskLevelLabel(score.level, tx)}</StatusChip>
          </span>
          {score.knockout ? (
            <span className="inline-flex" data-testid="lead-risk-knockout">
              <StatusChip tone="error">K.o.</StatusChip>
            </span>
          ) : null}
          <span className="inline-flex" data-testid="lead-risk-status">
            <StatusChip tone={riskStatusTone(assessment.status)}>{riskStatusLabel(assessment.status, tx)}</StatusChip>
          </span>
        <dl className="flex flex-wrap items-center gap-2" data-testid="lead-risk-points" aria-label={riskPointsLine(score, tx)}>
          {[
            [tx("Баллы · максимум", "Punkte · Höchstwert"), score.points],
            [score.triggers.some((trigger) => trigger.subject === "representative") ? tx("Пациент и представители", "Patient und Vertreter") : tx("Пациент", "Patient"), score.patient_points],
            [tx("Плательщик", "Zahler/in"), score.payer_points],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/20 px-2 py-0.5 text-xs leading-5 text-foreground">
              <dt>{label}:</dt>
              <dd className="font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
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

        {assessment.representatives && assessment.representatives.length > 0 ? (
          <div className="space-y-3" data-testid="lead-risk-representative-answers">
            <Caption>{riskBlockLabel("R", tx)}</Caption>
            {assessment.representatives.map((person) => (
              <section key={person.id} className="rounded-lg border border-border bg-card p-3" data-testid={`lead-risk-representative-${person.id}`}>
                <h5 className="mb-2 break-words text-sm font-semibold">{person.name || tx("Представитель", "Vertreter")}</h5>
                <dl className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {REPRESENTATIVE_COUNTRY_FIELDS.flatMap((field) => {
                    const value = person.fields[field];
                    if (value === null || value === undefined || value === "") return [];
                    const question = (REPRESENTATIVE_QUESTIONS as readonly string[]).includes(field);
                    return [<div key={field} className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{field === "pep_self" ? tx("PEP: представитель", "PEP: Vertreter") : riskMissingLabel(field, tx)}</dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words text-sm">
                        {question ? <StatusChip tone={value === true ? "warning" : "success"}>{value === true ? tx("Да", "Ja") : tx("Нет", "Nein")}</StatusChip>
                          : field === "stay_reason" ? cabinetText.stayReasonOptions[value as keyof typeof cabinetText.stayReasonOptions] ?? String(value)
                            : field === "sanctions_link_kind" ? cabinetText.sanctionsLinkKindOptions[value as keyof typeof cabinetText.sanctionsLinkKindOptions] ?? String(value)
                              : field === "pep_country" || field === "birth_country" ? countryLabel(String(value), lang) : String(value)}
                      </dd>
                    </div>];
                  })}
                </dl>
                {!Object.values(person.fields).some((value) => value !== null && value !== undefined && value !== "") ? <span className="text-xs text-muted-foreground">{tx("Не отвечено", "Nicht beantwortet")}</span> : null}
              </section>
            ))}
          </div>
        ) : null}

        {started && assessment.sanctions_confirmed ? (
          <p className={cn("text-xs leading-5", WARNING_TEXT)} data-testid="lead-risk-sanctions-confirmed">
            {tx(
              "Подтверждённое совпадение с санкционным списком: блокировка окончательная, разрешение по оценке риска её не снимает.",
              "Bestätigter Sanktionstreffer: Die Sperre ist endgültig, eine Freigabe der Risikobewertung hebt sie nicht auf.",
            )}
          </p>
        ) : null}

        {(started || questionsBeforeSubmit) && blocksShown.length > 0 ? (
          <div className="space-y-3" data-testid="lead-risk-blocks">
            <Caption>{questionsBeforeSubmit
              ? tx("Вопросы до отправки анкеты", "Fragen vor dem Absenden der Anfrage")
              : tx("Дополнительные сведения", "Ergänzende Angaben")}</Caption>
            {questionsBeforeSubmit ? <p className="text-xs leading-5 text-muted-foreground" data-testid="lead-risk-questions-preview">
              {tx(
                "Эти вопросы уже доступны пациенту в кабинете по текущим данным о стране. Ниже — заполненность ответов; оценка риска ещё не начата.",
                "Diese Fragen stehen im Portal aufgrund der aktuellen Länderangaben bereits zur Verfügung. Unten ist der Ausfüllstand zu sehen; die Risikobewertung wurde noch nicht gestartet.",
              )}
            </p> : null}
            <ul className="grid items-start gap-2 @3xl/risk:grid-cols-2">
              {blocksShown.map((block) => (
                <BlockRow key={block.key} block={block} requested={requested.has(block.key)} beforeSubmit={questionsBeforeSubmit} tx={tx} representatives={assessment.representatives} />
              ))}
            </ul>
            {started && assessment.follow_up_answered_at ? (
              <StatusChip tone="info" data-testid="lead-risk-follow-up-answered">
                <CalendarDays />
                {tx("Пациент отправил сведения", "Angaben gesendet am")} {formatAppDateTime(assessment.follow_up_answered_at)}
              </StatusChip>
            ) : null}
          </div>
        ) : null}

        {proposal ? (
          <div
            className={cn("space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs dark:border-amber-500/30 dark:bg-amber-500/10")}
            data-testid="lead-risk-proposal"
          >
            <div className="font-semibold text-foreground">
              {tx("Старое предложение", "Alter Vorschlag")}: {riskDecisionLabel(proposal.decision, tx)}
              {" — "}
              {proposal.decided_by_name ?? "—"}, {formatAppDateTime(proposal.decided_at)}
            </div>
            {proposal.reason ? <div className="whitespace-pre-line text-foreground">{proposal.reason}</div> : null}
            <p className={WARNING_TEXT} data-testid="lead-risk-old-proposal">
              {tx(
                "Записано до отмены второй проверки: подтвердите его или отзовите, затем можно принять новое решение.",
                "Vor dem Wegfall der Zweitprüfung erfasst: bestätigen oder zurücknehmen, danach kann neu entschieden werden.",
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

        {started && score.level === 3 && assessment.status !== "released" && assessment.status !== "rejected" ? (
          <p className={cn("text-xs font-medium leading-5", WARNING_TEXT)} data-testid="lead-risk-level3-stop">
            {score.knockout
              ? tx(
                  "K.o.: уровень 3 независимо от баллов. Подписи, квалификация и конвертация остановлены до решения проверяющего.",
                  "K.o.: Stufe 3 unabhängig von den Punkten. Unterschriften, Qualifizierung und Konvertierung sind bis zur Entscheidung angehalten.",
                )
              : tx(
                  "Уровень 3: подписи, квалификация и конвертация остановлены до решения проверяющего.",
                  "Stufe 3: Unterschriften, Qualifizierung und Konvertierung sind bis zur Entscheidung angehalten.",
                )}
          </p>
        ) : null}

        {decisions.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/50 pt-2.5" data-testid="lead-risk-actions">
            {decisions.some((decision) => decision !== "request_more") ? (
              <StatusChip tone="warning" className="min-w-0 flex-[1_1_26rem] items-start whitespace-normal rounded-xl px-3 py-2" data-testid="lead-risk-decision-hint">
                <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>{tx(
                  "Решение вступает в силу сразу, на любом уровне. Причина обязательна (минимум 10 символов).",
                  "Die Entscheidung wird sofort wirksam, auf jeder Stufe. Eine Begründung ist Pflicht (mindestens 10 Zeichen).",
                )}</span>
              </StatusChip>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {decisions.map((decision) => (
                <Button
                  key={decision}
                  type="button"
                  size="sm"
                  className="h-8"
                  variant={decision === "reject" ? "destructive" : "default"}
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
          <details className="group/risk-history overflow-hidden rounded-lg border border-border/60 text-sm" data-testid="lead-risk-history">
            <summary className="flex cursor-pointer list-none items-center gap-2 bg-muted/20 px-3 py-2 text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <History aria-hidden="true" className="size-4 shrink-0" />
              <span className="flex-1">{tx("Решения и история", "Entscheidungen und Verlauf")}</span>
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 transition-transform group-open/risk-history:rotate-180" />
            </summary>
            <div className="grid gap-4 border-t border-border/60 bg-muted/10 p-3 @3xl/risk:grid-cols-2">
              <div className="min-w-0 space-y-3">
                <Caption>{tx("Решения", "Entscheidungen")}</Caption>
                {assessment.decisions.length > 0 ? (
                  <ul className="space-y-2">
                    {assessment.decisions.map((decision) => (
                      <DecisionLine key={decision.id} decision={decision} tx={tx} />
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed border-border bg-card p-3 text-sm text-foreground">{tx("Решений ещё нет", "Noch keine Entscheidungen")}</p>
                )}
              </div>
              <div className="min-w-0 space-y-3">
                <Caption>{tx("История", "Verlauf")}</Caption>
                <ul className="space-y-2">
                  {assessment.history.map((event) => (
                    <li key={event.id} className="space-y-2 rounded-lg border border-border/60 bg-card p-3" data-testid="lead-risk-event">
                      <p className="font-semibold text-foreground">{riskEventLabel(event, tx)}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusChip tone="info"><CalendarDays aria-hidden="true" /><time dateTime={event.at ?? undefined}>{formatAppDateTime(event.at) || "—"}</time></StatusChip>
                        {event.level ? <StatusChip tone={riskLevelTone(event.level)}>{riskLevelLabel(event.level, tx)}</StatusChip> : null}
                        {event.points !== null ? <StatusChip className="text-foreground">{event.points} {tx("б.", "P.")}</StatusChip> : null}
                        {event.cause ? <StatusChip className="text-foreground">{riskCauseLabel(event.cause, tx)}</StatusChip> : null}
                        {event.actor_name ? <StatusChip className="text-foreground"><UserRound aria-hidden="true" />{event.actor_name}</StatusChip> : null}
                      </div>
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
            <legend className={cn(tokens.text.label, "mb-1 font-mono")}>{tx("Какие сведения запросить", "Welche Angaben anfordern")}</legend>
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
