import { describe, expect, it } from "vitest";

import {
  blankAppointmentFormForCurrentUser,
  defaultAppointmentOwnerUserId,
} from "./form-factories";

describe("appointment form factories", () => {
  it("defaults the owner to the current non-interpreter user", () => {
    expect(defaultAppointmentOwnerUserId("user-1", "patient_manager")).toBe(
      "user-1",
    );
    expect(blankAppointmentFormForCurrentUser("it-1", "it_admin").ownerUserId).toBe(
      "it-1",
    );
  });

  it("keeps interpreter-created forms without an owner default", () => {
    expect(defaultAppointmentOwnerUserId("interpreter-1", "interpreter")).toBe(
      "",
    );
    expect(
      blankAppointmentFormForCurrentUser("interpreter-1", "interpreter")
        .ownerUserId,
    ).toBe("");
  });
});
