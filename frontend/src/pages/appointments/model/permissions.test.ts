import { describe, expect, it } from "vitest";

import { appointmentPermissions, linkedPatientPermissions } from "./selectors";
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
