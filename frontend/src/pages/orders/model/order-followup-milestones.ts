import {
  addDaysToDateKey,
  addMonthsToDateKey,
  appDateKey,
  appDateKeyOf,
  appWallClockToInstant,
  parseDateKey,
} from "@/lib/app-time-zone";

import type { FollowupStatus, OrderFollowupFlow, OrderFollowupFormState } from "./types";

type Bilingual = (ru: string, de: string) => string;

/** The planned follow-up contacts after the closure of an order. */
export type FollowupMilestone = "post_1w" | "post_1m" | "post_6m";

export const FOLLOWUP_MILESTONES: readonly FollowupMilestone[] = ["post_1w", "post_1m", "post_6m"];

type MilestoneKeys = {
  statusField: "followup1wStatus" | "followup1mStatus" | "followup6mStatus";
  dateField: "followup1wDate" | "followup1mDate" | "followup6mDate";
  apiStatus: "followup_1w_status" | "followup_1m_status" | "followup_6m_status";
  apiDate: "followup_1w_date" | "followup_1m_date" | "followup_6m_date";
  recommended: "recommended_followup_1w_at" | "recommended_followup_1m_at" | "recommended_followup_6m_at";
  ready: "followup_1w_ready" | "followup_1m_ready" | "followup_6m_ready";
  visits: "followup_1w_visits" | "followup_1m_visits" | "followup_6m_visits";
  openVisits: "followup_1w_open_visits" | "followup_1m_open_visits" | "followup_6m_open_visits";
  openVisitDate:
    | "followup_1w_open_visit_date"
    | "followup_1m_open_visit_date"
    | "followup_6m_open_visit_date";
  reminders: "followup_1w_reminders" | "followup_1m_reminders" | "followup_6m_reminders";
  offset: { days?: number; months?: number };
};

const MILESTONE_KEYS: Record<FollowupMilestone, MilestoneKeys> = {
  post_1w: {
    statusField: "followup1wStatus",
    dateField: "followup1wDate",
    apiStatus: "followup_1w_status",
    apiDate: "followup_1w_date",
    recommended: "recommended_followup_1w_at",
    ready: "followup_1w_ready",
    visits: "followup_1w_visits",
    openVisits: "followup_1w_open_visits",
    openVisitDate: "followup_1w_open_visit_date",
    reminders: "followup_1w_reminders",
    offset: { days: 7 },
  },
  post_1m: {
    statusField: "followup1mStatus",
    dateField: "followup1mDate",
    apiStatus: "followup_1m_status",
    apiDate: "followup_1m_date",
    recommended: "recommended_followup_1m_at",
    ready: "followup_1m_ready",
    visits: "followup_1m_visits",
    openVisits: "followup_1m_open_visits",
    openVisitDate: "followup_1m_open_visit_date",
    reminders: "followup_1m_reminders",
    offset: { months: 1 },
  },
  post_6m: {
    statusField: "followup6mStatus",
    dateField: "followup6mDate",
    apiStatus: "followup_6m_status",
    apiDate: "followup_6m_date",
    recommended: "recommended_followup_6m_at",
    ready: "followup_6m_ready",
    visits: "followup_6m_visits",
    openVisits: "followup_6m_open_visits",
    openVisitDate: "followup_6m_open_visit_date",
    reminders: "followup_6m_reminders",
    offset: { months: 6 },
  },
};

export function followupMilestoneKeys(milestone: FollowupMilestone): MilestoneKeys {
  return MILESTONE_KEYS[milestone];
}

/**
 * Date (YYYY-MM-DD) a milestone should be planned for: the Berlin date of the
 * closure anchor plus one week / one month / six months, or from today when
 * the order has no closure anchor yet.
 */
export function recommendedFollowupDate(
  flow: Pick<OrderFollowupFlow, "closure_anchor_at"> | null | undefined,
  milestone: FollowupMilestone,
  today: Date = new Date(),
): string {
  const base = appDateKeyOf(flow?.closure_anchor_at) || appDateKey(today);
  const { offset } = MILESTONE_KEYS[milestone];
  let target = base;
  if (offset.days) target = addDaysToDateKey(target, offset.days);
  if (offset.months) target = addMonthsToDateKey(target, offset.months);
  return target;
}

/** Title of a follow-up reminder or visit; the follow-up gate recognizes it. */
export function followupMilestoneTitle(milestone: FollowupMilestone, tx: Bilingual): string {
  switch (milestone) {
    case "post_1w":
      return tx("Контроль через 1 неделю", "Nachsorge nach 1 Woche");
    case "post_1m":
      return tx("Контроль через 1 месяц", "Nachsorge nach 1 Monat");
    default:
      return tx("Контроль через 6 месяцев", "Nachsorge nach 6 Monaten");
  }
}

export function followupMilestoneLabel(milestone: FollowupMilestone, tx: Bilingual): string {
  switch (milestone) {
    case "post_1w":
      return tx("Через 1 неделю", "Nach 1 Woche");
    case "post_1m":
      return tx("Через 1 месяц", "Nach 1 Monat");
    default:
      return tx("Через 6 месяцев", "Nach 6 Monaten");
  }
}

/** Reminder time on the planned date: 09:00 Berlin time, as an API timestamp. */
export function followupReminderAt(date: string): string | null {
  const parts = parseDateKey(date);
  return parts ? appWallClockToInstant(parts.year, parts.month, parts.day, 9).toISOString() : null;
}

/**
 * The form after choosing a milestone status: "scheduled" gets the
 * recommended date when none is set yet, so the milestone counts right away.
 */
export function withFollowupMilestoneStatus(
  form: OrderFollowupFormState,
  milestone: FollowupMilestone,
  status: FollowupStatus,
  flow: Pick<OrderFollowupFlow, "closure_anchor_at"> | null | undefined,
  today: Date = new Date(),
): OrderFollowupFormState {
  const { statusField, dateField } = MILESTONE_KEYS[milestone];
  return {
    ...form,
    [statusField]: status,
    [dateField]:
      status === "scheduled" && !form[dateField]
        ? recommendedFollowupDate(flow, milestone, today)
        : form[dateField],
  };
}

/** A milestone marked scheduled needs a date to count for the follow-up gate. */
export function followupMilestoneNeedsDate(
  form: OrderFollowupFormState,
  milestone: FollowupMilestone,
): boolean {
  const { statusField, dateField } = MILESTONE_KEYS[milestone];
  return form[statusField] === "scheduled" && !form[dateField];
}

/** Why a milestone cannot be marked completed yet. */
export type FollowupCompletionBlock =
  /** A visit of the milestone (earliest on `date`) is not held or cancelled yet. */
  | { kind: "open_visit"; date: string; count: number }
  /** The milestone has no visit and is planned for a later date. */
  | { kind: "before_date"; date: string };

/**
 * The server's rule for "completed" (see `followup_completion_block` in
 * orders.rs): every visit of the milestone must be held or cancelled; a
 * contact without a visit cannot be completed before its planned date (the
 * date in the form; a cleared date keeps the saved one).
 */
export function followupMilestoneCompletionBlock(
  flow: Pick<
    OrderFollowupFlow,
    | "followup_1w_date"
    | "followup_1m_date"
    | "followup_6m_date"
    | "followup_1w_visits"
    | "followup_1m_visits"
    | "followup_6m_visits"
    | "followup_1w_open_visits"
    | "followup_1m_open_visits"
    | "followup_6m_open_visits"
    | "followup_1w_open_visit_date"
    | "followup_1m_open_visit_date"
    | "followup_6m_open_visit_date"
  >,
  form: OrderFollowupFormState,
  milestone: FollowupMilestone,
  today: Date = new Date(),
): FollowupCompletionBlock | null {
  const keys = MILESTONE_KEYS[milestone];
  const openVisits = flow[keys.openVisits] ?? 0;
  if (openVisits > 0) {
    return { kind: "open_visit", date: flow[keys.openVisitDate] ?? "", count: openVisits };
  }
  if ((flow[keys.visits] ?? 0) > 0) return null;
  const date = form[keys.dateField] || flow[keys.apiDate] || "";
  return date && date > appDateKey(today) ? { kind: "before_date", date } : null;
}
