import { describe, expect, it } from "vitest";

import {
  appointmentPermissions,
  appointmentReportActions,
  appointmentsReadOnlyScope,
  linkedPatientPermissions,
} from "./selectors";
import { getRequiredAppointmentDetailResourceGroups } from "./detail-resource-needs";

describe("appointment role contracts", () => {
  it("keeps CEO and Patient Manager operational controls while reserving report submission for interpreters", () => {
    for (const role of ["ceo", "patient_manager"] as const) {
      const permissions = appointmentPermissions(role);
      expect(permissions).toEqual(
        expect.objectContaining({
          canViewPage: true,
          canCreate: true,
          canDelete: true,
          canManageStatus: true,
          canAssignInterpreter: true,
          canManageChecklist: true,
          canManageReminders: true,
          canApproveReport: true,
          canRejectReport: true,
          canSubmitReport: false,
          canManageConciergeServices: true,
          canManageConciergeBilling: true,
        }),
      );
    }

    expect(appointmentPermissions("interpreter").canSubmitReport).toBe(true);
    expect(appointmentPermissions("interpreter").canRespondToAssignment).toBe(true);
    expect(appointmentPermissions("interpreter").canDelete).toBe(false);
    expect(appointmentPermissions("interpreter").canEditSchedule).toBe(false);
    expect(appointmentPermissions("teamlead_interpreter").canDelete).toBe(false);
    expect(appointmentPermissions("concierge").canDelete).toBe(false);
    expect(appointmentPermissions("teamlead_interpreter")).toEqual(
      expect.objectContaining({
        canEditSchedule: true,
        canAssignInterpreter: true,
        canApproveReport: true,
        canRejectReport: true,
        canSubmitReport: false,
        canManageChecklist: false,
        canManageConciergeServices: false,
      }),
    );
  });

  it("lets Concierge run the service side without clinical notes or reports", () => {
    expect(appointmentPermissions("concierge")).toEqual(
      expect.objectContaining({
        canViewPage: true,
        canCreate: true,
        canEditSchedule: true,
        canManageChecklist: true,
        canViewConciergeServices: true,
        canManageConciergeServices: true,
        canManageConciergeBilling: false,
        canViewNotes: false,
        canViewReport: false,
        canManageCommunications: true,
      }),
    );
  });

  it("gives the CEO assistant a read-only calendar and keeps IT admin out", () => {
    const assistant = appointmentPermissions("ceo_assistant");
    expect(assistant.canViewPage).toBe(true);
    expect(assistant.canViewReminders).toBe(true);
    expect(assistant.canViewTasks).toBe(true);
    for (const flag of [
      "canCreate",
      "canEditSchedule",
      "canDelete",
      "canManageStatus",
      "canAssignInterpreter",
      "canManageChecklist",
      "canManageReminders",
      "canSubmitReport",
      "canApproveReport",
      "canCreateTasks",
      "canManageConciergeServices",
      "canManageCommunications",
    ] as const) {
      expect(assistant[flag], flag).toBe(false);
    }

    const itAdmin = appointmentPermissions("it_admin");
    expect(Object.values(itAdmin).some(Boolean)).toBe(false);
  });

  it("does not request concierge or checklist endpoints for roles without those capabilities", () => {
    const teamlead = appointmentPermissions("teamlead_interpreter");
    const services = getRequiredAppointmentDetailResourceGroups("services", false, teamlead);
    expect(services).not.toContain("services");
    expect(services).toContain("tasks");
    const workflow = getRequiredAppointmentDetailResourceGroups("workflow", false, teamlead);
    expect(workflow).not.toContain("checklist");

    const itAdmin = appointmentPermissions("it_admin");
    expect(getRequiredAppointmentDetailResourceGroups("services", false, itAdmin)).toEqual([]);
  });

  it("derives linked patient sheet permissions from the patient model", () => {
    expect(linkedPatientPermissions("ceo")).toEqual({
      canCreateEdit: true,
      canViewAssignments: true,
      canManageAssignments: true,
    });
    expect(linkedPatientPermissions("teamlead_interpreter")).toEqual({
      canCreateEdit: false,
      canViewAssignments: true,
      canManageAssignments: true,
    });
    expect(linkedPatientPermissions("it_admin")).toEqual({
      canCreateEdit: false,
      canViewAssignments: false,
      canManageAssignments: false,
    });
  });
});

describe("appointments read-only scope", () => {
  it("keeps the interpreter read-only without the view-only banner above its response buttons", () => {
    expect(appointmentsReadOnlyScope("interpreter")).toEqual({ active: true, banner: false });
  });

  it("shows the banner to view-only roles and no scope to schedulers", () => {
    expect(appointmentsReadOnlyScope("ceo_assistant")).toEqual({ active: true, banner: true });
    expect(appointmentsReadOnlyScope("patient_manager").active).toBe(false);
    expect(appointmentsReadOnlyScope("teamlead_interpreter").active).toBe(false);
  });
});

describe("appointment report actions", () => {
  const interpreterId = "interpreter-1";
  const reportFor = (approval_status: string) => ({ approval_status });

  it("lets the assigned interpreter submit a first report and resubmit a returned one on the read-only page", () => {
    const permissions = appointmentPermissions("interpreter");
    expect(appointmentsReadOnlyScope("interpreter").active).toBe(true);

    expect(
      appointmentReportActions({
        permissions,
        currentUserId: interpreterId,
        interpreterId,
        report: null,
      }),
    ).toEqual({
      canSubmitInterpreterReport: true,
      canResubmitRejectedReport: false,
      showReportReviewActions: false,
    });
    expect(
      appointmentReportActions({
        permissions,
        currentUserId: interpreterId,
        interpreterId,
        report: reportFor("rejected"),
      }),
    ).toEqual({
      canSubmitInterpreterReport: true,
      canResubmitRejectedReport: true,
      showReportReviewActions: false,
    });
    for (const status of ["pending", "approved"]) {
      expect(
        appointmentReportActions({
          permissions,
          currentUserId: interpreterId,
          interpreterId,
          report: reportFor(status),
        }).canSubmitInterpreterReport,
        status,
      ).toBe(false);
    }
  });

  it("keeps report submission with the assigned interpreter only", () => {
    const interpreter = appointmentPermissions("interpreter");
    for (const assignee of ["interpreter-2", null, undefined]) {
      expect(
        appointmentReportActions({
          permissions: interpreter,
          currentUserId: interpreterId,
          interpreterId: assignee,
          report: reportFor("rejected"),
        }),
        String(assignee),
      ).toEqual({
        canSubmitInterpreterReport: false,
        canResubmitRejectedReport: false,
        showReportReviewActions: false,
      });
    }
    expect(
      appointmentReportActions({
        permissions: interpreter,
        currentUserId: undefined,
        interpreterId: undefined,
        report: null,
      }).canSubmitInterpreterReport,
    ).toBe(false);

    // The server accepts reports from the `interpreter` role only.
    expect(
      appointmentReportActions({
        permissions: appointmentPermissions("teamlead_interpreter"),
        currentUserId: interpreterId,
        interpreterId,
        report: null,
      }).canSubmitInterpreterReport,
    ).toBe(false);
  });

  it("offers the review decision to approvers while the report is pending", () => {
    for (const role of ["ceo", "patient_manager", "teamlead_interpreter"]) {
      const permissions = appointmentPermissions(role);
      expect(
        appointmentReportActions({
          permissions,
          currentUserId: "reviewer-1",
          interpreterId,
          report: reportFor("pending"),
        }).showReportReviewActions,
        role,
      ).toBe(true);
      expect(
        appointmentReportActions({
          permissions,
          currentUserId: "reviewer-1",
          interpreterId,
          report: reportFor("approved"),
        }).showReportReviewActions,
        role,
      ).toBe(false);
    }
    expect(
      appointmentReportActions({
        permissions: appointmentPermissions("interpreter"),
        currentUserId: interpreterId,
        interpreterId,
        report: reportFor("pending"),
      }).showReportReviewActions,
    ).toBe(false);
  });
});
