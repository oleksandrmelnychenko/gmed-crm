import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Tabs } from "@/components/ui/tabs";

import { canCompletePatientChecklistItem } from "../../model/detail-model";
import { PatientWorkflowTab } from "./patient-workflow-section";

const noop = () => undefined;

function renderEmpty(canManageWorkflowChecklist: boolean) {
  return renderToStaticMarkup(
    <Tabs value="workflow">
      <PatientWorkflowTab
        l={(key) => key}
        commonNotSet="—"
        tabLoading={false}
        workflowChecklist={null}
        workflowChecklistGroups={[]}
        workflowItemCount={0}
        workflowBusy={false}
        workflowForm={{ itemText: "", ownerUserId: "", priority: "normal", dueDate: "" }}
        activeWorkflowAssignees={[]}
        canManageWorkflowChecklist={canManageWorkflowChecklist}
        statusColors={{}}
        statusLabel={(status) => status}
        formatDateTime={(value) => value ?? ""}
        roleLabel={(value) => value ?? ""}
        priorityLabel={(priority) => priority}
        priorityBadgeClass={() => ""}
        onCompleteWorkflowItem={noop}
        onSubmitWorkflowItem={noop}
        onWorkflowItemTextChange={noop}
        onWorkflowOwnerChange={noop}
        onWorkflowPriorityChange={noop}
        onWorkflowDueDateChange={noop}
      />
    </Tabs>,
  );
}

describe("PatientWorkflowTab", () => {
  it("offers the first checklist item from the empty state", () => {
    const html = renderEmpty(true);
    expect(html).toContain("patients_no_patient_workflow_checklist_yet");
    expect(html).toMatch(/<button[^>]*>.*patients_add_item<\/button>/);
  });

  it("offers «Завершить» only to roles the server lets complete the item (QA F-C10)", () => {
    const item = { owner_user_id: "u-1", owner_role: "concierge" };
    expect(canCompletePatientChecklistItem({ role: "patient_manager", id: "x" }, item)).toBe(true);
    expect(canCompletePatientChecklistItem({ role: "concierge", id: "x" }, item)).toBe(true);
    expect(canCompletePatientChecklistItem({ role: "billing", id: "u-1" }, item)).toBe(true);
    expect(canCompletePatientChecklistItem({ role: "billing", id: "x" }, item)).toBe(false);
    expect(canCompletePatientChecklistItem({ role: "ceo_assistant", id: "u-1" }, item)).toBe(false);
  });

  it("keeps the empty state read-only without the manage permission", () => {
    const html = renderEmpty(false);
    expect(html).toContain("patients_no_patient_workflow_checklist_yet");
    expect(html).not.toContain("patients_add_item");
  });
});
