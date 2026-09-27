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
    reminders: "followup_6m_reminders",
    offset: { months: 6 },
  },
};

export function followupMilestoneKeys(milestone: FollowupMilestone): MilestoneKeys {
  return MILESTONE_KEYS[milestone];
}

function isoLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Date (YYYY-MM-DD) a milestone should be planned for: the closure anchor
 * plus one week / one month / six months, or from today when the order has no
 * closure anchor yet.
 */
export function recommendedFollowupDate(
  flow: Pick<OrderFollowupFlow, "closure_anchor_at"> | null | undefined,
  milestone: FollowupMilestone,
  today: Date = new Date(),
): string {
  const anchor = flow?.closure_anchor_at ? new Date(flow.closure_anchor_at) : today;
  const base = Number.isNaN(anchor.getTime()) ? today : anchor;
  const { offset } = MILESTONE_KEYS[milestone];
  const target = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  if (offset.days) target.setDate(target.getDate() + offset.days);
  if (offset.months) {
    const day = target.getDate();
    target.setDate(1);
    target.setMonth(target.getMonth() + offset.months);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, lastDay));
  }
  return isoLocalDate(target);
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

/** Reminder time on the planned date: 09:00 local time, as an API timestamp. */
export function followupReminderAt(date: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const local = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 9, 0, 0);
  return Number.isNaN(local.getTime()) ? null : local.toISOString();
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
