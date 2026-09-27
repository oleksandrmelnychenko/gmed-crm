import { describe, expect, it } from "vitest";

import { orderBlockingReasonAnchor, orderBlockingReasonSection } from "./blocking-reasons";
import { blankOrderFollowupForm } from "./order-model";
import {
  followupMilestoneNeedsDate,
  followupMilestoneTitle,
  followupReminderAt,
  recommendedFollowupDate,
  withFollowupMilestoneStatus,
} from "./order-followup-milestones";

const tx = (...texts: [ru: string, de: string]) => texts[0];
const txDe = (...texts: [ru: string, de: string]) => texts[1];

describe("recommendedFollowupDate", () => {
  const flow = { closure_anchor_at: "2026-09-28T10:00:00+02:00" };

  it("plans one week, one month and six months after the closure anchor", () => {
    expect(recommendedFollowupDate(flow, "post_1w")).toBe("2026-10-05");
    expect(recommendedFollowupDate(flow, "post_1m")).toBe("2026-10-28");
    expect(recommendedFollowupDate(flow, "post_6m")).toBe("2027-03-28");
  });

  it("keeps the end of a shorter month and starts from today without an anchor", () => {
    expect(recommendedFollowupDate({ closure_anchor_at: "2026-01-31T12:00:00Z" }, "post_1m")).toBe(
      "2026-02-28",
    );
    expect(recommendedFollowupDate(null, "post_1w", new Date(2026, 8, 27))).toBe("2026-10-04");
  });
});

describe("withFollowupMilestoneStatus", () => {
  it("prefills the recommended date when a milestone becomes scheduled", () => {
    const form = withFollowupMilestoneStatus(
      blankOrderFollowupForm(),
      "post_1w",
      "scheduled",
      { closure_anchor_at: "2026-09-28T10:00:00+02:00" },
    );
    expect(form.followup1wStatus).toBe("scheduled");
    expect(form.followup1wDate).toBe("2026-10-05");
    expect(followupMilestoneNeedsDate(form, "post_1w")).toBe(false);
  });

  it("keeps a date already chosen and flags a scheduled milestone without one", () => {
    const form = withFollowupMilestoneStatus(
      { ...blankOrderFollowupForm(), followup1mDate: "2026-11-02" },
      "post_1m",
      "scheduled",
      null,
    );
    expect(form.followup1mDate).toBe("2026-11-02");
    expect(
      followupMilestoneNeedsDate({ ...blankOrderFollowupForm(), followup6mStatus: "scheduled" }, "post_6m"),
    ).toBe(true);
  });
});

describe("follow-up milestone reminders", () => {
  it("uses titles the follow-up gate recognizes", () => {
    expect(followupMilestoneTitle("post_1w", tx)).toBe("Контроль через 1 неделю");
    expect(followupMilestoneTitle("post_6m", txDe)).toBe("Nachsorge nach 6 Monaten");
  });

  it("reminds at 09:00 local time on the planned date", () => {
    const at = followupReminderAt("2026-10-05");
    expect(at).not.toBeNull();
    const local = new Date(at ?? "");
    expect([local.getFullYear(), local.getMonth(), local.getDate(), local.getHours()]).toEqual([
      2026, 9, 5, 9,
    ]);
    expect(followupReminderAt("05.10.2026")).toBeNull();
  });
});

describe("follow-up blockers open the milestone planner", () => {
  it("links the milestone blockers to the planner of the follow-up section", () => {
    for (const reason of [
      "1-week follow-up is not scheduled yet",
      "6-month follow-up is not scheduled yet",
      "No follow-up reminder, task or appointment has been launched yet",
    ]) {
      expect(orderBlockingReasonSection(reason)).toBe("followup");
      expect(orderBlockingReasonAnchor(reason)).toBe("order-followup-milestones");
    }
    expect(orderBlockingReasonAnchor("Results, Arztbrief or final patient handoff still need to be released")).toBeNull();
  });
});
