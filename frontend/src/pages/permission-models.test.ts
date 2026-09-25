/**
 * Table-driven check that every page permission model is a pure function of
 * the capability registry: for each of the 9 staff roles we build a `/me`
 * user from `docs/backlog/02_rbac-capability-snapshot.md` and compare the
 * model flags with the capabilities the snapshot grants.
 */

import { describe, expect, it } from "vitest";

import { snapshotUsers } from "@/lib/rbac-snapshot.test-fixture";
import { appointmentPermissions, linkedPatientPermissions } from "@/pages/appointments/model/selectors";
import { contractsPermissions } from "@/pages/contracts/model/contracts-model";
import {
  canManageDocumentIntake,
  canManageDocuments,
  canRequestTranslations,
  canUpdateTranslations,
  canUploadDocuments,
  canViewDocumentShares,
  canViewDocuments,
  canViewTranslationQueue,
} from "@/pages/documents/model/document-model";
import { canViewStaffFeedback, roleCanCaptureFeedback } from "@/pages/feedback/model/feedback-model";
import { invoicesPermissions } from "@/pages/invoices/model/invoice-model";
import { leadPermissions } from "@/pages/leads/model/leads-model";
import { orderPermissions } from "@/pages/orders/model/order-model";
import {
  canEditPatientClinicalProfile,
  canLoadPatientAssignableStaff,
  canManagePatientProfile,
  canOpenPatientDocumentsWorkspace,
  canViewPatientAppointmentsSurface,
  canViewPatientAssignmentsSurface,
  canViewPatientCareHistorySurface,
  canViewPatientClinicalProfile,
  canViewPatientContractsSurface,
  canViewPatientDocumentsSurface,
  canViewPatientFinanceSurface,
  canViewPatientInvoicesSurface,
  canViewPatientOperationalSurface,
  isPatientDetailTabReadOnly,
} from "@/pages/patients/model/detail-model";
import { canAssignTarget, patientPermissions } from "@/pages/patients/model/list-model";
import { canManageProviderPeople, providerPermissions } from "@/pages/providers/model/list-model";
import { hotelPermissions } from "@/pages/reports/hotels/model";
import { roleCanOpenReports } from "@/pages/reports/model/report-model";
import { servicesPermissions } from "@/pages/services.model";
import { roleCanCreate, roleCanOpenLearning, roleCanReview } from "@/pages/sops/model/sops-model";
import {
  assignableConciergeTaskUsers,
  canAssignConciergeTaskToRole,
  filterConciergeTaskAssignees,
} from "@/pages/concierge/model";

const users = snapshotUsers();
const STAFF_ROLES = users.map((user) => user.role);

/** Both call shapes must agree: the `/me` user and the bare role through the mirror. */
function forEachActor(
  check: (actor: { role: string; capabilities: string[] } | string, has: (capability: string) => boolean, role: string) => void,
) {
  for (const user of users) {
    const has = (capability: string) => user.capabilities.includes(capability);
    check(user, has, user.role);
    check(user.role, has, user.role);
  }
}

describe("staff roles in the snapshot", () => {
  it("cover the 9 cabinet roles", () => {
    expect(STAFF_ROLES).toEqual([
      "ceo",
      "ceo_assistant",
      "patient_manager",
      "teamlead_interpreter",
      "interpreter",
      "concierge",
      "billing",
      "sales",
      "it_admin",
    ]);
  });
});

describe("leads model", () => {
  it.each(STAFF_ROLES)("follows leads.* for %s", (role) => {
    forEachActor((actor, has, actorRole) => {
      if (actorRole !== role) return;
      expect(leadPermissions(actor)).toEqual({
        canViewPage: has("leads.view"),
        canOpen: has("leads.edit"),
        canEdit: has("leads.edit"),
        canCreate: has("leads.edit"),
        canConvert: has("leads.convert"),
      });
    });
  });
});

describe("patients list model", () => {
  it.each(STAFF_ROLES)("follows patients.* for %s", (role) => {
    forEachActor((actor, has, actorRole) => {
      if (actorRole !== role) return;
      const participates = ["ceo", "patient_manager", "teamlead_interpreter", "interpreter", "concierge"].includes(role);
      expect(patientPermissions(actor)).toEqual({
        canViewPage: has("patients.view"),
        canCreateEdit: has("patients.edit"),
        canFilterLifecycle: has("patients.edit"),
        canViewAssignments: has("patients.view") && participates,
        canManageAssignments: has("patients.assign") || role === "teamlead_interpreter",
        canViewFinancialBalance: has("invoices.view"),
      });
    });
  });

  it("keeps the assignment hierarchy role-based and without IT admin", () => {
    expect(canAssignTarget("ceo", "patient_manager")).toBe(true);
    expect(canAssignTarget("patient_manager", "concierge")).toBe(true);
    expect(canAssignTarget("teamlead_interpreter", "interpreter")).toBe(true);
    expect(canAssignTarget("teamlead_interpreter", "concierge")).toBe(false);
    expect(canAssignTarget("it_admin", "interpreter")).toBe(false);
    expect(canAssignTarget("ceo_assistant", "interpreter")).toBe(false);
  });
});

describe("patient detail model", () => {
  // Server role lists of the patient sub-resources (crates/server/src/routes/patients.rs,
  // workflow_checklists.rs): narrower than the capabilities, e.g. no CEO assistant.
  const RECORD_ROLES = ["ceo", "patient_manager", "billing", "teamlead_interpreter", "interpreter", "concierge"];
  const CARE_HISTORY_ROLES = ["ceo", "patient_manager", "billing", "teamlead_interpreter", "interpreter"];
  const APPOINTMENT_ROLES = [...CARE_HISTORY_ROLES, "concierge"];
  const ASSIGNMENT_ROLES = ["ceo", "patient_manager", "teamlead_interpreter", "interpreter", "concierge"];

  it.each(STAFF_ROLES)("derives every surface from capabilities and server role lists for %s", (role) => {
    forEachActor((actor, has, actorRole) => {
      if (actorRole !== role) return;
      const record = RECORD_ROLES.includes(role);
      expect(canViewPatientOperationalSurface(actor)).toBe(has("patients.view") && record);
      expect(canViewPatientAssignmentsSurface(actor)).toBe(
        has("patients.view") && ASSIGNMENT_ROLES.includes(role),
      );
      expect(canViewPatientDocumentsSurface(actor)).toBe(has("patients.view") && has("documents.view") && record);
      expect(canOpenPatientDocumentsWorkspace(actor)).toBe(has("patients.view") && has("documents.view") && record);
      expect(canViewPatientContractsSurface(actor)).toBe(has("contracts.view"));
      expect(canViewPatientInvoicesSurface(actor)).toBe(has("invoices.view"));
      expect(canViewPatientFinanceSurface(actor)).toBe(has("invoices.view"));
      expect(canViewPatientClinicalProfile(actor)).toBe(has("patients.medical.view"));
      expect(canEditPatientClinicalProfile(actor)).toBe(has("patients.medical.edit"));
      expect(canManagePatientProfile(actor)).toBe(has("patients.edit"));
      expect(canViewPatientCareHistorySurface(actor)).toBe(
        (has("orders.view") || has("appointments.view")) && CARE_HISTORY_ROLES.includes(role),
      );
      expect(canViewPatientAppointmentsSurface(actor)).toBe(
        (has("orders.view") || has("appointments.view")) && APPOINTMENT_ROLES.includes(role),
      );
      expect(canLoadPatientAssignableStaff(actor)).toBe(has("users.view"));
    });
  });

  it.each(STAFF_ROLES)("decides the read-only tab scope for %s", (role) => {
    forEachActor((actor, has, actorRole) => {
      if (actorRole !== role) return;
      expect(isPatientDetailTabReadOnly(actor, null)).toBe(!has("patients.edit"));
      expect(isPatientDetailTabReadOnly(actor, "profile")).toBe(!has("patients.edit"));
      expect(isPatientDetailTabReadOnly(actor, "clinical")).toBe(!has("patients.medical.edit"));
      expect(isPatientDetailTabReadOnly(actor, "documents")).toBe(
        !(has("documents.upload") || has("documents.manage")),
      );
      expect(isPatientDetailTabReadOnly(actor, "contracts")).toBe(!has("contracts.edit"));
      expect(isPatientDetailTabReadOnly(actor, "invoices")).toBe(
        !(has("invoices.create") || has("invoices.finance")),
      );
      expect(isPatientDetailTabReadOnly(actor, "orders")).toBe(!has("orders.edit"));
      expect(isPatientDetailTabReadOnly(actor, "appointments")).toBe(!has("appointments.edit"));
      expect(isPatientDetailTabReadOnly(actor, "curators")).toBe(!has("patients.assign"));
    });
  });
});

describe("orders model", () => {
  it.each(STAFF_ROLES)("follows orders.* for %s", (role) => {
    forEachActor((actor, has, actorRole) => {
      if (actorRole !== role) return;
      expect(orderPermissions(actor)).toEqual({
        canViewPage: has("orders.view"),
        canCreate: has("orders.edit"),
        canManagePhase: has("orders.edit"),
        canAddLeistung: has("orders.edit"),
        canApproveLeistung: has("orders.edit"),
        canCancelLeistung: has("orders.edit"),
        canManageExternalInvoices: has("orders.edit") || has("invoices.finance"),
        canManageEconomics: has("orders.economics"),
      });
    });
  });
});

describe("contracts model", () => {
  it.each(STAFF_ROLES)("follows contracts.* for %s", (role) => {
    forEachActor((actor, has, actorRole) => {
      if (actorRole !== role) return;
      const manage = has("contracts.edit");
      expect(contractsPermissions(actor)).toEqual({
        canViewPage: has("contracts.view"),
        canCreateContract: manage,
        canManageContract: manage,
        canCreateQuote: manage,
        canManageQuote: manage,
        canManageCatalog: manage,
        canTerminateContract: has("contracts.terminate"),
      });
    });
  });
});

describe("invoices model", () => {
  it.each(STAFF_ROLES)("follows invoices.* for %s", (role) => {
    forEachActor((actor, has, actorRole) => {
      if (actorRole !== role) return;
      expect(invoicesPermissions(actor)).toEqual({
        canView: has("invoices.view"),
        canCreate: has("invoices.create"),
        canManage: has("invoices.finance"),
        canAccounting: has("accounting.view"),
      });
    });
  });
});

describe("documents model", () => {
  it.each(STAFF_ROLES)("follows documents.* for %s", (role) => {
    forEachActor((actor, has, actorRole) => {
      if (actorRole !== role) return;
      expect(canViewDocuments(actor)).toBe(has("documents.view"));
      expect(canUploadDocuments(actor)).toBe(has("documents.upload"));
      expect(canManageDocuments(actor)).toBe(has("documents.manage"));
      expect(canManageDocumentIntake(actor)).toBe(has("documents.intake"));
      expect(canRequestTranslations(actor)).toBe(has("documents.upload"));
      expect(canUpdateTranslations(actor)).toBe(has("documents.upload"));
      expect(canViewTranslationQueue(actor)).toBe(has("documents.view"));
      expect(canViewDocumentShares(actor)).toBe(has("documents.shares.view"));
    });
  });
});

describe("appointments model", () => {
  it.each(STAFF_ROLES)("follows appointments.* for %s", (role) => {
    forEachActor((actor, has, actorRole) => {
      if (actorRole !== role) return;
      const view = has("appointments.view");
      const edit = has("appointments.edit");
      const status = has("appointments.status");
      const approve = has("appointments.report.approve");
      const submit = has("appointments.report.submit");
      expect(appointmentPermissions(actor)).toEqual({
        canViewPage: view,
        canCreate: edit,
        canEditSchedule: edit,
        canDelete: has("appointments.delete"),
        canManageStatus: status,
        canAssignInterpreter: has("appointments.assign_interpreter"),
        canManageChecklist: status || (edit && has("services.edit")),
        canViewReminders: view,
        canManageReminders: status,
        canRespondToAssignment: submit && ["interpreter", "teamlead_interpreter"].includes(role),
        canSubmitReport: submit && role === "interpreter",
        canViewReport: approve || submit,
        canApproveReport: approve,
        canRejectReport: approve,
        canViewNotes: view && has("patients.medical.view"),
        canViewTasks: view && has("tasks.use"),
        canCreateTasks: status && has("tasks.use"),
        canViewConciergeServices: view && has("services.view"),
        canManageConciergeServices: edit && has("services.edit"),
        canManageConciergeBilling: status,
        canViewCommunications: view,
        canManageCommunications: edit,
      });
      const patient = patientPermissions(actor);
      expect(linkedPatientPermissions(actor)).toEqual({
        canCreateEdit: patient.canCreateEdit,
        canViewAssignments: patient.canViewAssignments,
        canManageAssignments: patient.canManageAssignments,
      });
    });
  });
});

describe("providers model", () => {
  it.each(STAFF_ROLES)("follows providers.* for %s", (role) => {
    forEachActor((actor, has, actorRole) => {
      if (actorRole !== role) return;
      const edit = has("providers.edit");
      const registry = has("providers.registry");
      expect(providerPermissions(actor)).toEqual({
        canViewPage: has("providers.view"),
        canCreateProvider: edit,
        canEditProvider: edit,
        canManageRegistry: registry,
        forceNonMedical: edit && !registry,
      });
      expect(canManageProviderPeople(actor, "medical")).toBe(edit && registry);
      expect(canManageProviderPeople(actor, "non_medical")).toBe(edit);
    });
  });
});

describe("services, hotels, SOPs, feedback, reports", () => {
  it.each(STAFF_ROLES)("follow their capabilities for %s", (role) => {
    forEachActor((actor, has, actorRole) => {
      if (actorRole !== role) return;
      expect(servicesPermissions(actor)).toEqual({
        canViewPage: has("services.view"),
        canCreateService: has("services.edit"),
        canEditService: has("services.edit"),
        canEditProtectedServiceFields: has("services.edit") && has("providers.registry"),
      });
      expect(hotelPermissions(actor)).toEqual({
        canViewPage: has("hotels.view"),
        canEdit: has("hotels.edit"),
        canCreate: has("hotels.edit"),
      });
      expect(roleCanOpenLearning(actor)).toBe(has("sops.view"));
      expect(roleCanCreate(actor)).toBe(has("sops.create"));
      expect(roleCanReview(actor)).toBe(has("sops.review"));
      expect(canViewStaffFeedback(actor)).toBe(has("feedback.view"));
      expect(roleCanCaptureFeedback(actor)).toBe(has("feedback.capture"));
      expect(roleCanOpenReports(actor)).toBe(has("reports.view"));
    });
  });
});

describe("concierge task manager", () => {
  it("admits exactly the roles holding tasks.use", () => {
    const staff = users.map((user, index) => ({
      id: `u${index}`,
      name: user.role,
      email: `${user.role}@example.invalid`,
      role: user.role,
      is_active: true,
    }));
    expect(filterConciergeTaskAssignees(staff).map((user) => user.role).sort()).toEqual(
      users.filter((user) => user.capabilities.includes("tasks.use")).map((user) => user.role).sort(),
    );
    expect(canAssignConciergeTaskToRole("it_admin", "concierge")).toBe(false);
    expect(canAssignConciergeTaskToRole("ceo", "it_admin")).toBe(false);
    expect(canAssignConciergeTaskToRole("billing", "concierge")).toBe(true);
    expect(assignableConciergeTaskUsers(staff, "outsider", "it_admin")).toEqual([]);
  });
});
