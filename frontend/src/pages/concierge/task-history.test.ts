import { describe, expect, it } from "vitest";

import { conciergeTaskHistoryDetail } from "./task-history";

const event = (event_type: string, payload: Record<string, unknown>) => ({ event_type, payload });

describe("task history detail (concierge QA 2026-11-12 A F1)", () => {
  it("tells pause, resume, completion and reopen apart", () => {
    expect(conciergeTaskHistoryDetail(event("status_changed", { previous_status: "in_progress", status: "on_hold" }), "ru"))
      .toBe("В работе → На паузе");
    expect(conciergeTaskHistoryDetail(event("status_changed", { previous_status: "on_hold", status: "in_progress" }), "de"))
      .toBe("Pausiert → In Arbeit");
    expect(conciergeTaskHistoryDetail(event("status_changed", { previous_status: "completed", status: "in_progress" }), "ru"))
      .toBe("Выполнено → В работе");
    expect(conciergeTaskHistoryDetail(
      event("status_changed", { previous_status: "open", status: "completed", reason: "parent_closed" }),
      "ru",
    )).toBe("Открыто → Выполнено (вместе с основной задачей)");
  });

  it("names moved dates in Berlin time and DD.MM.YYYY", () => {
    expect(conciergeTaskHistoryDetail(event("updated", {
      previous_status: "open",
      status: "open",
      previous_due_at: "2026-11-12T09:00:00+00:00",
      due_at: "2026-11-11T08:00:00Z",
      previous_starts_at: null,
      starts_at: null,
    }), "ru")).toBe("Срок: 12.11.2026 10:00 → 11.11.2026 09:00");
    // Older entries without the previous values add nothing.
    expect(conciergeTaskHistoryDetail(event("updated", { status: "open", previous_status: "open" }), "ru")).toBeNull();
  });

  it("names the checklist step and the file", () => {
    expect(conciergeTaskHistoryDetail(event("checklist_item_toggled", { checklist_id: "c-1", completed: true, label: "Rollstuhl" }), "ru"))
      .toBe("«Rollstuhl» — выполнен");
    // Entries written before the label was stored fall back to the current step.
    expect(conciergeTaskHistoryDetail(
      event("checklist_item_added", { checklist_id: "c-2" }),
      "de",
      [{ id: "c-2", label: "Kindersitz" }],
    )).toBe("«Kindersitz»");
    expect(conciergeTaskHistoryDetail(event("checklist_item_deleted", { checklist_id: "c-3", previous_label: "Alt" }), "ru"))
      .toBe("«Alt»");
    expect(conciergeTaskHistoryDetail(event("checklist_item_edited", { previous_label: "Alt", label: "Neu" }), "ru"))
      .toBe("«Alt» → «Neu»");
    expect(conciergeTaskHistoryDetail(event("attachment_added", { file_name: "voucher.pdf" }), "ru")).toBe("voucher.pdf");
    expect(conciergeTaskHistoryDetail(event("expense_submitted", { vendor_name: "Taxi Berlin" }), "de")).toBe("Taxi Berlin");
  });

  it("marks a task the system created", () => {
    expect(conciergeTaskHistoryDetail(event("created", { system: true, concierge_service_id: "s-1" }), "ru"))
      .toBe("создана автоматически из консьерж-сервиса");
    expect(conciergeTaskHistoryDetail(event("created", { status: "open" }), "ru")).toBeNull();
  });
});
