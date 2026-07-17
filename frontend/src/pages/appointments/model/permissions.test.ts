import { describe, expect, it } from "vitest";

import { appointmentPermissions } from "./selectors";

describe("appointment role contracts", () => {
  it("keeps CEO and IT admin operational controls while reserving report submission for interpreters", () => {
    for (const role of ["ceo", "it_admin"] as const) {
      const permissions = appointmentPermissions(role);
      expect(permissions).toEqual(
        expect.objectContaining({
          canManageStatus: true,
          canAssignInterpreter: true,
          canManageChecklist: true,
          canManageReminders: true,
          canApproveReport: true,
          canRejectReport: true,
          canSubmitReport: false,
        }),
      );
    }

    expect(appointmentPermissions("interpreter").canSubmitReport).toBe(true);
    expect(appointmentPermissions("teamlead_interpreter")).toEqual(
      expect.objectContaining({
        canApproveReport: true,
        canRejectReport: true,
        canSubmitReport: false,
      }),
    );
  });
});
