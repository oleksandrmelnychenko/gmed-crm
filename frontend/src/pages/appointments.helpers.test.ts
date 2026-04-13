import { describe, expect, it } from "vitest";

import {
  buildInterpreterMobileAgendaSections,
  buildAppointmentTimelineEvents,
  canResubmitInterpreterReport,
  shouldUseInterpreterMobileAgenda,
} from "./appointments.helpers";

describe("canResubmitInterpreterReport", () => {
  it("allows the assigned interpreter to resubmit a rejected report", () => {
    expect(
      canResubmitInterpreterReport({
        approvalStatus: "rejected",
        currentUserId: "user-1",
        interpreterId: "user-1",
      })
    ).toBe(true);
  });

  it("blocks resubmission for other users or non-rejected reports", () => {
    expect(
      canResubmitInterpreterReport({
        approvalStatus: "approved",
        currentUserId: "user-1",
        interpreterId: "user-1",
      })
    ).toBe(false);

    expect(
      canResubmitInterpreterReport({
        approvalStatus: "rejected",
        currentUserId: "user-2",
        interpreterId: "user-1",
      })
    ).toBe(false);
  });
});

describe("buildAppointmentTimelineEvents", () => {
  it("builds a descending timeline with workflow, clinical, follow-up and concierge entries", () => {
    const events = buildAppointmentTimelineEvents({
      detail: {
        id: "apt-1",
        title: "Follow-up consult",
        date: "2026-04-05",
        time_start: "09:30",
        time_end: "10:30",
        patient_pid: "PID-2048",
        patient_name: "Anna Schmidt",
        provider_name: "Klinik Mitte",
        doctor_name: "Dr. Weber",
        interpreter_name: "Iryna Kovalenko",
        interpreter_response: "accepted",
        created_at: "2026-04-01T08:00:00Z",
      },
      checklist: [
        {
          id: "check-1",
          phase: "follow_up",
          item_text: "[Incoming data] Review MRI result",
          is_completed: false,
          completed_at: null,
        },
      ],
      reminders: [
        {
          id: "rem-1",
          title: "Doctor-directed: confirm neurology revisit",
          description: "Call patient after the board review.",
          remind_at: "2026-04-12T08:00:00Z",
          is_completed: false,
          completed_at: null,
          user_name: "Marta PM",
        },
      ],
      tasks: [
        {
          id: "task-1",
          title: "Incoming data: triage pathology note",
          description: "Escalate if risk markers are mentioned.",
          assigned_to_name: "Nazar Teamlead",
          assigned_to_role: "teamlead_interpreter",
          due_date: "2026-04-13T09:00:00Z",
          status: "in_progress",
          priority: "high",
          completed_at: null,
          created_at: "2026-04-10T08:30:00Z",
        },
        {
          id: "task-2",
          title: "Billing handoff: patient invoice",
          description: "Invoice clinic visit and note the approved interpreter hours.",
          assigned_to_name: "Lena Billing",
          assigned_to_role: "billing",
          due_date: "2026-04-14T11:00:00Z",
          status: "open",
          priority: "normal",
          completed_at: null,
          created_at: "2026-04-12T09:00:00Z",
        },
      ],
      services: [
        {
          id: "svc-1",
          title: "VIP transfer",
          status: "scheduled",
          assigned_concierge_name: "Olha Concierge",
          starts_at: "2026-04-11T07:00:00Z",
          completed_at: null,
          created_at: "2026-04-09T10:00:00Z",
        },
      ],
      communications: [
        {
          id: "comm-1",
          target_type: "doctor",
          direction: "outbound",
          channel: "email",
          status: "answered",
          subject: "Request follow-up summary",
          message: "Please send the written findings after the board review.",
          contact_name: "Dr. Weber",
          due_at: "2026-04-11T15:00:00Z",
          responded_at: "2026-04-11T13:00:00Z",
          closed_at: null,
          created_at: "2026-04-10T12:00:00Z",
          updated_at: "2026-04-11T13:00:00Z",
          created_by_name: "Marta PM",
          provider_name: "Klinik Mitte",
          doctor_name: "Dr. Weber",
        },
      ],
      report: {
        id: "report-1",
        interpreter_name: "Iryna Kovalenko",
        hours: "2.50",
        report_text: "Interpreted consultation and follow-up questions.",
        approval_status: "approved",
        approved_by_name: "Nazar Teamlead",
        approved_at: "2026-04-14T10:00:00Z",
        created_at: "2026-04-13T14:00:00Z",
        notes: "Ready for payroll handoff.",
      },
    });

    expect(events.find((item) => item.id === "report:report-1:reviewed")).toMatchObject({
      id: "report:report-1:reviewed",
      kind: "interpreter",
      tone: "success",
    });

    expect(events.find((item) => item.id === "task:task-1")).toMatchObject({
      kind: "clinical",
      tone: "info",
    });
    expect(events.find((item) => item.id === "reminder:rem-1")).toMatchObject({
      kind: "followup",
      tone: "info",
    });
    expect(events.find((item) => item.id === "service:svc-1")).toMatchObject({
      kind: "concierge",
      tone: "info",
    });
    expect(events.find((item) => item.id === "communication:comm-1:answered")).toMatchObject({
      kind: "communication",
      tone: "success",
    });
    expect(events.find((item) => item.id === "task:task-2")).toMatchObject({
      kind: "workflow",
      tone: "info",
    });
    expect(events.map((item) => item.occurredAt)).toEqual(
      [...events.map((item) => item.occurredAt)].toSorted((left, right) =>
        right.localeCompare(left)
      )
    );
  });

  it("marks rejected review events as danger and carries reviewer notes", () => {
    const events = buildAppointmentTimelineEvents({
      detail: {
        id: "apt-2",
        title: "Second opinion",
        date: "2026-03-28",
        time_start: "11:00",
        time_end: null,
        patient_pid: "PID-5001",
        patient_name: "Max Bauer",
        provider_name: "Clinic Nord",
        doctor_name: "Dr. Lange",
        interpreter_name: "Yulia Bondar",
        interpreter_response: "discussion",
        created_at: "2026-03-20T09:00:00Z",
      },
      checklist: [],
      reminders: [],
      tasks: [],
      services: [],
      communications: [],
      report: {
        id: "report-2",
        interpreter_name: "Yulia Bondar",
        hours: "1.25",
        report_text: null,
        approval_status: "rejected",
        approved_by_name: "Marta PM",
        approved_at: "2026-03-29T13:30:00Z",
        created_at: "2026-03-28T13:00:00Z",
        notes: "Clarify the missing travel handoff.",
      },
    });

    expect(events.find((item) => item.id === "report:report-2:reviewed")).toMatchObject({
      kind: "interpreter",
      tone: "danger",
      detail: "Marta PM · Clarify the missing travel handoff.",
    });
  });
});

describe("shouldUseInterpreterMobileAgenda", () => {
  it("enables the compact mobile agenda only for interpreter roles on mobile", () => {
    expect(shouldUseInterpreterMobileAgenda("interpreter", true)).toBe(true);
    expect(shouldUseInterpreterMobileAgenda("teamlead_interpreter", true)).toBe(
      true,
    );
    expect(shouldUseInterpreterMobileAgenda("patient_manager", true)).toBe(
      false,
    );
    expect(shouldUseInterpreterMobileAgenda("interpreter", false)).toBe(false);
  });
});

describe("buildInterpreterMobileAgendaSections", () => {
  it("groups visible appointments by day in ascending slot order and skips cancelled rows", () => {
    const sections = buildInterpreterMobileAgendaSections(
      [
        {
          id: "apt-2",
          date: "2026-04-14",
          time_start: "12:00",
          status: "confirmed",
          interpreter_response: "accepted",
        },
        {
          id: "apt-1",
          date: "2026-04-14",
          time_start: "08:30",
          status: "planned",
          interpreter_response: "pending",
        },
        {
          id: "apt-3",
          date: "2026-04-15",
          time_start: null,
          status: "planned",
          interpreter_response: null,
        },
        {
          id: "apt-4",
          date: "2026-04-15",
          time_start: "07:00",
          status: "cancelled",
          interpreter_response: "pending",
        },
      ],
      "2026-04-14",
    );

    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({
      date: "2026-04-14",
      label: "Today",
      itemCount: 2,
      pendingResponseCount: 1,
    });
    expect(sections[0].items.map((item) => item.id)).toEqual([
      "apt-1",
      "apt-2",
    ]);
    expect(sections[1]).toMatchObject({
      date: "2026-04-15",
      itemCount: 1,
      pendingResponseCount: 0,
    });
    expect(sections[1].items.map((item) => item.id)).toEqual(["apt-3"]);
  });
});
