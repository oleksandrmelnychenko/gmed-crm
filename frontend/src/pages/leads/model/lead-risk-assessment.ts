/**
 * The points-based risk assessment of a lead (trigger flow, owner spec
 * "Trigger-Ablauf im Detail" of 2026-10-07): the server scores triggers T1–T16
 * into points and a level, names the follow-up blocks A–J and keeps the
 * history; staff decide (release / request more / reject, a reason each, two
 * different reviewers at level 3). The engine never decides by itself.
 * Server: `crates/server/src/routes/lead_risk.rs`, `crates/server/src/risk/*`.
 *
 * Staff only: nothing of this reaches the lead's cabinet or the payer link.
 */
import { ApiRequestError } from "@/lib/api";

import type { Tx } from "./lead-payer";

export const RISK_TRIGGER_KEYS = [
  "T1",
  "T2",
  "T3",
  "T4",
  "T5",
  "T6",
  "T7",
  "T8",
  "T9",
  "T10",
  "T11",
  "T12",
  "T13",
  "T14",
  "T15",
  "T16",
] as const;

export type RiskTriggerKey = (typeof RISK_TRIGGER_KEYS)[number];

/** Triggers that put the lead on level 3 at once (K.o.), whatever the points. */
export const RISK_KNOCKOUT_TRIGGERS: readonly string[] = ["T14", "T15", "T16"];

/** Triggers whose points depend on the country list (list 1 / list 2). */
export const RISK_LIST_TRIGGERS: readonly string[] = ["T1", "T2", "T6"];

/** The follow-up blocks staff may request (A–J). */
export const RISK_BLOCK_KEYS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"] as const;

export type RiskBlockKey = (typeof RISK_BLOCK_KEYS)[number];

export const RISK_STATUSES = [
  "clear",
  "awaiting_answers",
  "review_required",
  "proposed",
  "released",
  "rejected",
  "grandfathered",
] as const;

export type RiskStatus = (typeof RISK_STATUSES)[number];

export const RISK_DECISIONS = ["release", "request_more", "reject"] as const;

export type RiskDecisionKind = (typeof RISK_DECISIONS)[number];

/** The minimum length of a decision's reason (server: `length(trim(reason)) >= 10`). */
export const RISK_REASON_MIN_CHARS = 10;

export type RiskLevel = 1 | 2 | 3;

export type RiskTrigger = {
  key: string;
  /** `patient` or `payer`: whose score the points add to. */
  subject: string;
  /** `list_1` / `list_2` for the country triggers, else null. */
  variant: "list_1" | "list_2" | null;
  points: number;
  /** Still true in the latest live evaluation; a fired trigger stays (sticky) either way. */
  active: boolean;
  first_fired_at: string | null;
  /** The follow-up blocks this trigger asks for. */
  blocks: string[];
  /** K.o. (T14–T16): level 3 whatever the points. */
  knockout: boolean;
};

/** One scoring: points per subject, the higher one counts, level 1–3. */
export type RiskScore = {
  level: RiskLevel;
  points: number;
  patient_points: number;
  payer_points: number;
  knockout: boolean;
  triggers: RiskTrigger[];
};

export type RiskBlockState = {
  key: string;
  open: boolean;
  /** Who answers it: the lead's cabinet or the payer's own link. */
  party: "cabinet" | "payer_link";
  answered: boolean;
  missing: string[];
};

export type RiskDecision = {
  id: string;
  decision: RiskDecisionKind;
  reason: string;
  blocks: string[];
  level: number | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  confirms_decision_id: string | null;
  withdraws_decision_id: string | null;
  /** `decision`, `proposal`, `confirmation` or `withdrawal`; null on a server that does not say. */
  kind: string | null;
  /** Of a proposal: `pending`, `confirmed` or `withdrawn`. */
  proposal_state: string | null;
};

export type RiskHistoryEvent = {
  id: string;
  at: string | null;
  /** `started`, `raised`, `follow_up_answered`, `trigger_withdrawn`, `status`. */
  kind: string;
  level: number | null;
  points: number | null;
  /** `cabinet`, `staff`, `payer_link`, `screening`, `hit_decision`, `gate`, `read`, `config`. */
  cause: string | null;
  actor_name: string | null;
  /** The status after a `status` event, when the server sends it. */
  status: string | null;
};

export type RiskProposal = {
  id: string;
  decision: RiskDecisionKind;
  reason: string;
  blocks: string[];
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
};

/** `GET /leads/{id}/risk-assessment`. */
export type LeadRiskAssessment = RiskScore & {
  /** Null while the assessment has not started (no cabinet submit, no gated action yet). */
  started_at: string | null;
  status: RiskStatus | null;
  blocks: RiskBlockState[];
  requested_blocks: string[];
  follow_up_answered_at: string | null;
  review_notice: boolean;
  /** The live scoring before the start; never stored. */
  preview: RiskScore | null;
  decisions: RiskDecision[];
  history: RiskHistoryEvent[];
  pending_proposal: RiskProposal | null;
  config_version: number | null;
  /** The caller is a reviewer (CEO or a named deputy). */
  can_decide: boolean;
  /** The caller may confirm the pending proposal (a reviewer other than the proposer). */
  can_confirm: boolean;
  /** The caller may withdraw the pending proposal (the proposer); null when the server does not say. */
  can_withdraw: boolean | null;
  /** The caller may start a grandfathered or not-started assessment; null when the server does not say. */
  can_restart: boolean | null;
  four_eyes_required: boolean;
  reviewers_available: number;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const count = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];

function level(value: unknown, knockout: boolean): RiskLevel {
  if (knockout) return 3;
  const raw = typeof value === "number" ? Math.round(value) : Number.NaN;
  return raw >= 3 ? 3 : raw === 2 ? 2 : 1;
}

function decisionKind(value: unknown): RiskDecisionKind | null {
  return typeof value === "string" && (RISK_DECISIONS as readonly string[]).includes(value)
    ? (value as RiskDecisionKind)
    : null;
}

function letters(value: unknown): string[] {
  return strings(value)
    .map((item) => item.trim().toUpperCase())
    .filter((item, index, all) => (RISK_BLOCK_KEYS as readonly string[]).includes(item) && all.indexOf(item) === index)
    .sort();
}

function normalizeTrigger(value: unknown): RiskTrigger | null {
  const raw = record(value);
  const key = text(raw?.key);
  if (!raw || !key) return null;
  const variant = raw.variant === "list_1" || raw.variant === "list_2" ? raw.variant : null;
  return {
    key: key.toUpperCase(),
    subject: text(raw.subject) ?? "patient",
    variant,
    points: count(raw.points),
    active: raw.active !== false,
    first_fired_at: text(raw.first_fired_at),
    blocks: letters(raw.blocks),
    knockout: raw.knockout === true || RISK_KNOCKOUT_TRIGGERS.includes(key.toUpperCase()),
  };
}

/** A scoring (the stored one or the preview); null when the value is not one. */
export function normalizeRiskScore(value: unknown): RiskScore | null {
  const raw = record(value);
  if (!raw) return null;
  const triggers = Array.isArray(raw.triggers)
    ? raw.triggers.map(normalizeTrigger).filter((item): item is RiskTrigger => item !== null)
    : [];
  const knockout =
    raw.knockout === true || triggers.some((trigger) => trigger.knockout);
  const patientPoints = count(raw.patient_points);
  const payerPoints = count(raw.payer_points);
  return {
    level: level(raw.level, knockout),
    points: count(raw.points, Math.max(patientPoints, payerPoints)),
    patient_points: patientPoints,
    payer_points: payerPoints,
    knockout,
    triggers,
  };
}

function normalizeBlocks(value: unknown): RiskBlockState[] {
  const raw = record(value);
  if (!raw) return [];
  return RISK_BLOCK_KEYS.flatMap((key) => {
    const block = record(raw[key]);
    if (!block) return [];
    return [
      {
        key,
        open: block.open === true,
        party: block.party === "payer_link" ? "payer_link" : "cabinet",
        answered: block.answered === true,
        missing: strings(block.missing),
      } satisfies RiskBlockState,
    ];
  });
}

function normalizeDecision(value: unknown): RiskDecision | null {
  const raw = record(value);
  const id = text(raw?.id);
  const decision = decisionKind(raw?.decision);
  if (!raw || !id || !decision) return null;
  return {
    id,
    decision,
    reason: text(raw.reason) ?? "",
    blocks: letters(raw.blocks),
    level: numberOrNull(raw.level),
    decided_by: text(raw.decided_by),
    decided_by_name: text(raw.decided_by_name),
    decided_at: text(raw.decided_at),
    confirms_decision_id: text(raw.confirms_decision_id),
    withdraws_decision_id: text(raw.withdraws_decision_id),
    kind: text(raw.kind),
    proposal_state: text(raw.proposal_state),
  };
}

function normalizeEvent(value: unknown, index: number): RiskHistoryEvent | null {
  const raw = record(value);
  const kind = text(raw?.kind);
  if (!raw || !kind) return null;
  return {
    id: text(raw.id) ?? `${kind}-${index}`,
    at: text(raw.at),
    kind,
    level: numberOrNull(raw.level),
    points: numberOrNull(raw.points),
    cause: text(raw.cause),
    actor_name: text(raw.actor_name),
    status: text(raw.status),
  };
}

function normalizeProposal(value: unknown): RiskProposal | null {
  const raw = record(value);
  const id = text(raw?.id);
  const decision = decisionKind(raw?.decision);
  if (!raw || !id || !decision) return null;
  return {
    id,
    decision,
    reason: text(raw.reason) ?? "",
    blocks: letters(raw.blocks),
    decided_by: text(raw.decided_by),
    decided_by_name: text(raw.decided_by_name),
    decided_at: text(raw.decided_at),
  };
}

/**
 * The server's answer with every key present; null for anything that is not
 * one (an older server without the route, a proxy page, a test mock).
 */
export function normalizeLeadRiskAssessment(value: unknown): LeadRiskAssessment | null {
  const raw = record(value);
  if (!raw) return null;
  const status =
    typeof raw.status === "string" && (RISK_STATUSES as readonly string[]).includes(raw.status)
      ? (raw.status as RiskStatus)
      : null;
  const startedAt = text(raw.started_at);
  const preview = normalizeRiskScore(raw.preview);
  // Neither a status nor a preview: not an assessment.
  if (!status && !preview && !startedAt) return null;
  const score = normalizeRiskScore(raw) ?? {
    level: 1 as RiskLevel,
    points: 0,
    patient_points: 0,
    payer_points: 0,
    knockout: false,
    triggers: [],
  };
  return {
    ...score,
    started_at: startedAt,
    status,
    blocks: normalizeBlocks(raw.blocks),
    requested_blocks: letters(raw.requested_blocks),
    follow_up_answered_at: text(raw.follow_up_answered_at),
    review_notice: raw.review_notice === true,
    preview,
    decisions: Array.isArray(raw.decisions)
      ? raw.decisions.map(normalizeDecision).filter((item): item is RiskDecision => item !== null)
      : [],
    history: Array.isArray(raw.history)
      ? raw.history.map(normalizeEvent).filter((item): item is RiskHistoryEvent => item !== null)
      : [],
    pending_proposal: normalizeProposal(raw.pending_proposal),
    config_version: numberOrNull(raw.config_version),
    can_decide: raw.can_decide === true,
    can_confirm: raw.can_confirm === true,
    can_withdraw: typeof raw.can_withdraw === "boolean" ? raw.can_withdraw : null,
    can_restart: typeof raw.can_restart === "boolean" ? raw.can_restart : null,
    four_eyes_required: raw.four_eyes_required === true || score.level === 3,
    reviewers_available: count(raw.reviewers_available),
  };
}

/**
 * Whether the assessment runs (stored scoring that staff decide on). Not yet
 * started, or grandfathered (a lead already qualified before the trigger
 * flow): only the live preview is shown.
 */
export function riskAssessmentStarted(assessment: LeadRiskAssessment): boolean {
  return assessment.status !== "grandfathered" && Boolean(assessment.started_at);
}

/** Whether the panel shows the live preview instead of the stored scoring. */
export function riskShowsPreview(assessment: LeadRiskAssessment): boolean {
  return !riskAssessmentStarted(assessment) && assessment.preview !== null;
}

/** The scoring to show: the stored one once started, else the live preview. */
export function riskDisplayedScore(assessment: LeadRiskAssessment): RiskScore {
  return riskShowsPreview(assessment) && assessment.preview ? assessment.preview : assessment;
}

/** Whether a reviewer may start it (a grandfathered or not-started assessment). */
export function riskCanRestart(assessment: LeadRiskAssessment): boolean {
  if (riskAssessmentStarted(assessment)) return false;
  // The server says it (a reviewer gets `can_decide` only once the assessment runs).
  return assessment.can_restart ?? assessment.can_decide;
}

/** Release / reject are effective at once up to level 2; at level 3 they are a proposal for a second reviewer. */
export function riskDecisionNeedsSecondReviewer(assessment: LeadRiskAssessment, decision: RiskDecisionKind): boolean {
  return decision !== "request_more" && (assessment.level === 3 || assessment.four_eyes_required);
}

/** Level 3 cannot be released while fewer than two reviewers exist (the owner must name a deputy). */
export function riskSecondReviewerMissing(assessment: LeadRiskAssessment): boolean {
  return assessment.level === 3 && assessment.reviewers_available < 2;
}

/**
 * Whether the caller may withdraw the pending proposal: the server's answer,
 * else the proposer is the reviewer who may decide but not confirm.
 */
export function riskCanWithdraw(assessment: LeadRiskAssessment, currentUserId?: string | null): boolean {
  const proposal = assessment.pending_proposal;
  if (!proposal) return false;
  if (assessment.can_withdraw !== null) return assessment.can_withdraw;
  if (currentUserId && proposal.decided_by) return proposal.decided_by === currentUserId;
  return assessment.can_decide && !assessment.can_confirm;
}

/** The decisions a reviewer may take now (none while a proposal waits). */
export function riskAvailableDecisions(assessment: LeadRiskAssessment): RiskDecisionKind[] {
  if (!assessment.can_decide || assessment.pending_proposal || !riskAssessmentStarted(assessment)) return [];
  return RISK_DECISIONS.filter((decision) => {
    // Level 1 needs no release, unless staff rejected it before (a release may follow a reject).
    if (decision === "release") {
      return (assessment.level > 1 || assessment.status === "rejected") && assessment.status !== "released";
    }
    if (decision === "reject") return assessment.status !== "rejected";
    return true;
  });
}

export function riskReasonValid(reason: string): boolean {
  return reason.trim().length >= RISK_REASON_MIN_CHARS;
}

/** Visual tone of a level: 1 green, 2 amber, 3 red. */
export function riskLevelTone(value: number): "success" | "warning" | "error" {
  return value >= 3 ? "error" : value === 2 ? "warning" : "success";
}

export function riskLevelLabel(value: number, tx: Tx): string {
  return tx(`Уровень ${value}`, `Stufe ${value}`);
}

export function riskTriggerLabel(key: string, tx: Tx): string {
  switch (key) {
    case "T1":
      return tx("Гражданство пациента в списке стран", "Staatsangehörigkeit des Patienten auf der Länderliste");
    case "T2":
      return tx("Проживание пациента в стране из списка", "Wohnsitz des Patienten in einem Land der Liste");
    case "T3":
      return tx("Несколько гражданств, одно из списка", "Mehrere Staatsangehörigkeiten, eine davon gelistet");
    case "T4":
      return tx("Платит третье лицо", "Zahlung durch Dritte");
    case "T5":
      return tx("Плательщик не супруг(а), родитель или ребёнок", "Zahler nicht Ehepartner, Elternteil oder Kind");
    case "T6":
      return tx("Гражданство или страна плательщика в списке", "Staatsangehörigkeit oder Sitz des Zahlers gelistet");
    case "T7":
      return tx("Платит организация или страховая", "Zahler ist Unternehmen, Organisation oder Versicherung");
    case "T8":
      return tx("Больше одного плательщика", "Mehr als ein Zahler");
    case "T9":
      return tx("Оплата наличными или криптовалютой", "Zahlung bar oder in Kryptowährung");
    case "T10":
      return tx("Сумма обращения выше порога 1", "Wert der Anfrage über Schwelle 1");
    case "T11":
      return tx("Сумма плательщика за 12 месяцев выше порога 2", "12-Monats-Summe desselben Zahlers über Schwelle 2");
    case "T12":
      return tx(
        "Документ личности: нет, нечитаем или просрочен",
        "Ausweis fehlt, ist unleserlich oder abgelaufen",
      );
    case "T13":
      return tx(
        "Несовершеннолетний, представитель или опека",
        "Minderjährig, vertreten oder unter Betreuung",
      );
    case "T14":
      return tx("PEP: ответ «да»", "PEP: Antwort „ja“");
    case "T15":
      return tx("Связи с санкционными лицами: ответ «да»", "Verbindung zu sanktionierten Personen: „ja“");
    case "T16":
      return tx("Совпадение с санкционным списком (открыто или подтверждено)", "Sanktionstreffer (offen oder bestätigt)");
    default:
      return key;
  }
}

export function riskSubjectLabel(subject: string, tx: Tx): string {
  if (subject === "patient") return tx("пациент", "Patient");
  if (subject === "payer") return tx("плательщик", "Zahler");
  if (subject === "representative") return tx("представитель", "Vertreter");
  return subject;
}

export function riskVariantLabel(variant: RiskTrigger["variant"], tx: Tx): string {
  if (variant === "list_1") return tx("список 1", "Liste 1");
  if (variant === "list_2") return tx("список 2", "Liste 2");
  return "";
}

export function riskBlockLabel(key: string, tx: Tx): string {
  switch (key) {
    case "A":
      return tx("Источник средств", "Herkunft der Mittel");
    case "B":
      return tx("Отношение к плательщику", "Beziehung zum Zahler");
    case "C":
      return tx("Способ и путь оплаты", "Zahlungsweg");
    case "D":
      return tx("Анкета плательщика по ссылке", "Angaben des Zahlers (Link)");
    case "E":
      return tx("Организация-плательщик", "Zahlende Organisation");
    case "F":
      return tx("Проживание и гражданства", "Aufenthalt und Staatsangehörigkeiten");
    case "G":
      return tx("Представители", "Vertretung");
    case "H":
      return tx("PEP: подробности", "PEP: Einzelheiten");
    case "I":
      return tx("Документ личности", "Ausweisdokument");
    case "J":
      return tx("Связи с санкциями: подробности", "Sanktionsbezug: Einzelheiten");
    case "K":
      return tx("Данные о рождении", "Geburtsangaben");
    default:
      return key;
  }
}

/** What a follow-up block still misses, in words; an unknown key stays as the server names it. */
const RISK_MISSING_LABELS: Record<string, [ru: string, de: string]> = {
  funds_source: ["источник средств", "Herkunft der Mittel"],
  funds_description: ["описание источника средств", "Beschreibung der Herkunft"],
  payer_funds_source: ["источник средств плательщика", "Herkunft der Mittel des Zahlers"],
  payer_funds_description: ["описание средств плательщика", "Beschreibung der Mittel des Zahlers"],
  occupation: ["профессия", "Beruf"],
  sector: ["отрасль", "Branche"],
  funds_proof_upload: ["подтверждение средств (файл)", "Nachweis der Mittel (Datei)"],
  payment_background: ["почему платит третье лицо", "Grund der Kostenübernahme"],
  relationship_since: ["с какого времени отношения", "Beziehung seit"],
  relationship_proof_upload: ["подтверждение отношений (файл)", "Nachweis der Beziehung (Datei)"],
  payment_method: ["способ оплаты", "Zahlungsart"],
  payment_method_details: ["подробности способа оплаты", "Einzelheiten der Zahlungsart"],
  account_country: ["страна счёта", "Land des Kontos"],
  account_holder: ["владелец счёта", "Kontoinhaber"],
  bank_name: ["банк", "Bank"],
  via_third_party: ["оплата через третье лицо", "Zahlung über Dritte"],
  via_third_party_details: ["подробности третьего лица", "Einzelheiten zu Dritten"],
  via_third_party_kind: ["вид третьего лица", "Art des Dritten"],
  expected_total_eur: ["ожидаемая сумма", "erwarteter Gesamtbetrag"],
  payer_link_submit: ["плательщик ещё не отправил анкету", "Zahler hat noch nicht gesendet"],
  legal_form: ["правовая форма", "Rechtsform"],
  payment_reason: ["причина оплаты организацией", "Grund der Zahlung"],
  residence_since: ["с какого времени проживает", "Wohnsitz seit"],
  stay_reason: ["причина проживания", "Grund des Aufenthalts"],
  stay_reason_details: ["подробности причины", "Einzelheiten zum Aufenthalt"],
  pep_office: ["должность PEP", "Amt (PEP)"],
  pep_country: ["страна PEP", "Land (PEP)"],
  pep_period: ["период PEP", "Zeitraum (PEP)"],
  pep_relationship: ["связь с PEP", "Beziehung (PEP)"],
  pep_wealth_origin: ["происхождение состояния PEP", "Vermögensherkunft (PEP)"],
  id_document_upload: ["второй документ личности (файл)", "weiteres Ausweisdokument (Datei)"],
  sanctions_link_name: ["имя связанного лица", "Name der Person"],
  sanctions_link_kind: ["вид связи", "Art der Verbindung"],
  sanctions_link_since_extent: ["с какого времени и объём связи", "Seit wann und Umfang"],
  birth_place: ["место рождения", "Geburtsort"],
  birth_country: ["страна рождения", "Geburtsland"],
};

export function riskMissingLabel(key: string, tx: Tx): string {
  const label = RISK_MISSING_LABELS[key];
  return label ? tx(label[0], label[1]) : key;
}

export function riskPartyLabel(party: RiskBlockState["party"], tx: Tx): string {
  return party === "payer_link" ? tx("ссылка плательщика", "Zahler-Link") : tx("кабинет пациента", "Patientenportal");
}

export function riskStatusLabel(status: RiskStatus | null, tx: Tx): string {
  switch (status) {
    case "clear":
      return tx("Решение не требуется", "Keine Entscheidung nötig");
    case "awaiting_answers":
      return tx("Ждём ответы", "Warten auf Angaben");
    case "review_required":
      return tx("Нужно решение", "Entscheidung erforderlich");
    case "proposed":
      return tx("Ждёт второго проверяющего", "Wartet auf Zweitprüfung");
    case "released":
      return tx("Разрешено", "Freigegeben");
    case "rejected":
      return tx("Отклонено", "Abgelehnt");
    case "grandfathered":
      return tx("До введения оценки", "Bestand vor Einführung");
    default:
      return tx("Не начата", "Nicht gestartet");
  }
}

export function riskStatusTone(status: RiskStatus | null): "success" | "warning" | "error" | "info" | "neutral" {
  switch (status) {
    case "released":
    case "clear":
      return "success";
    case "review_required":
    case "proposed":
      return "warning";
    case "rejected":
      return "error";
    case "awaiting_answers":
      return "info";
    default:
      return "neutral";
  }
}

export function riskDecisionLabel(decision: RiskDecisionKind, tx: Tx): string {
  switch (decision) {
    case "release":
      return tx("Разрешить", "Freigeben");
    case "request_more":
      return tx("Запросить сведения", "Weitere Angaben anfordern");
    case "reject":
      return tx("Отклонить", "Ablehnen");
  }
}

export function riskEventLabel(event: RiskHistoryEvent, tx: Tx): string {
  switch (event.kind) {
    case "started":
      return tx("Оценка начата", "Bewertung gestartet");
    case "raised":
      return tx("Риск повышен", "Risiko erhöht");
    case "follow_up_answered":
      return tx("Пациент отправил доп. сведения", "Ergänzende Angaben gesendet");
    case "trigger_withdrawn":
      return tx("Триггер снят (ложное совпадение)", "Auslöser zurückgenommen (falsch positiv)");
    case "status":
      return event.status
        ? `${tx("Статус", "Status")}: ${riskStatusLabel(event.status as RiskStatus, tx)}`
        : tx("Статус изменён", "Status geändert");
    default:
      return event.kind;
  }
}

export function riskCauseLabel(cause: string | null, tx: Tx): string {
  switch (cause) {
    case "cabinet":
      return tx("кабинет пациента", "Patientenportal");
    case "staff":
      return tx("сотрудник", "Mitarbeiter");
    case "payer_link":
      return tx("ссылка плательщика", "Zahler-Link");
    case "screening":
      return tx("санкционная проверка", "Sanktionsprüfung");
    case "hit_decision":
      return tx("решение по совпадению", "Entscheidung zum Treffer");
    case "gate":
      return tx("действие с документами", "Dokumentenaktion");
    case "read":
      return tx("пересчёт", "Neuberechnung");
    case "config":
      return tx("настройки", "Einstellungen");
    default:
      return cause ?? "";
  }
}

/** "5 (пациент 4 · плательщик 1)": the points that count and both subjects. */
export function riskPointsLine(score: RiskScore, tx: Tx): string {
  return `${score.points} (${tx("пациент", "Patient")} ${score.patient_points} · ${tx("плательщик", "Zahler")} ${score.payer_points})`;
}

/** The open blocks in letter order. */
export function riskOpenBlocks(assessment: LeadRiskAssessment): RiskBlockState[] {
  return assessment.blocks.filter((block) => block.open);
}

/** The blocks pre-selected in the "request more" chooser: the open ones not yet requested, else none. */
export function riskSuggestedBlocks(assessment: LeadRiskAssessment): string[] {
  const requested = new Set(assessment.requested_blocks);
  const suggested = new Set<string>();
  for (const trigger of riskDisplayedScore(assessment).triggers) {
    for (const block of trigger.blocks) if (!requested.has(block)) suggested.add(block);
  }
  return RISK_BLOCK_KEYS.filter((key) => suggested.has(key));
}

/** A decision error of the server in the user's language; null for other errors. */
export function riskDecisionErrorText(error: unknown, tx: Tx): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  const code = error.body?.error ?? error.code;
  switch (code) {
    case "reason_required":
      return tx("Укажите причину (минимум 10 символов).", "Bitte eine Begründung angeben (mindestens 10 Zeichen).");
    case "blocks_required":
      return tx("Выберите хотя бы один блок.", "Bitte mindestens einen Block auswählen.");
    case "four_eyes_same_user":
      return tx(
        "Подтвердить должен другой проверяющий (принцип четырёх глаз).",
        "Bestätigen muss eine andere prüfende Person (Vier-Augen-Prinzip).",
      );
    case "assessment_changed":
      return tx(
        "Оценка изменилась после предложения: проверьте данные и предложите решение заново.",
        "Die Bewertung hat sich seit dem Vorschlag geändert: bitte prüfen und neu vorschlagen.",
      );
    case "risk_review_required":
      return riskGateErrorText(error, tx);
    case "proposal_pending":
      return tx(
        "Предложение ещё ждёт второго проверяющего: сначала подтвердите или отзовите его.",
        "Ein Vorschlag wartet noch auf die Zweitprüfung: erst bestätigen oder zurücknehmen.",
      );
    case "proposal_not_pending":
      return tx("Это предложение уже подтверждено или отозвано.", "Dieser Vorschlag ist bereits bestätigt oder zurückgenommen.");
    case "not_proposer":
      return tx("Отозвать предложение может только его автор.", "Nur die vorschlagende Person kann den Vorschlag zurücknehmen.");
    case "assessment_not_started":
      return tx("Оценка риска ещё не начата.", "Die Risikobewertung hat noch nicht begonnen.");
    default:
      if (error.status === 403) {
        return tx(
          "Решения принимают CEO и назначенные заместители.",
          "Entscheidungen treffen der CEO und benannte Vertreter.",
        );
      }
      return null;
  }
}

/** 409 `risk_review_required` of the gated staff actions (qualify, convert, signatures …). */
export function riskGateErrorText(error: unknown, tx: Tx): string | null {
  if (!(error instanceof ApiRequestError) || (error.body?.error ?? error.code) !== "risk_review_required") return null;
  return tx(
    "Сначала нужно решение по оценке риска (раздел «Оценка риска» в документах).",
    "Zuerst ist eine Entscheidung zur Risikobewertung nötig (Abschnitt „Risikobewertung“ in den Unterlagen).",
  );
}

/**
 * Who may be named a reviewer (deputy) besides the CEO: a staff role with
 * `leads.view`, except sales, the CEO assistant and the interpreters
 * (contract 4.2). The server checks it again.
 */
const REVIEWER_EXCLUDED_ROLES = new Set(["sales", "ceo_assistant", "interpreter", "teamlead_interpreter", "patient"]);

export function riskReviewerRoleEligible(role: string, roleCanViewLeads: boolean): boolean {
  return roleCanViewLeads && !REVIEWER_EXCLUDED_ROLES.has(role);
}
