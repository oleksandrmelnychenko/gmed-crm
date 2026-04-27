import { matchPath } from "react-router-dom";

import { CaseWorkspaceNav } from "../case-workspace-nav";
import { AppointmentWorkspaceNav } from "@/pages/appointments/ui/appointment-workspace-nav";
import { PatientWorkspaceNav } from "@/pages/patients/ui/patient-workspace-nav";

export type WorkspaceRailKind = "patient" | "case" | "patient-case" | "appointment" | null;

type ResolveWorkspaceRailKindOptions = {
  pathname: string;
  search: string;
  userRole?: string | null;
};

export function resolveWorkspaceRailKind({
  pathname,
  search,
  userRole,
}: ResolveWorkspaceRailKindOptions): WorkspaceRailKind {
  if (matchPath("/patients/:id", pathname)) {
    return "patient";
  }

  if (matchPath("/cases/:caseId", pathname)) {
    const caseParams = new URLSearchParams(search);
    return caseParams.get("patient") ? "patient-case" : "case";
  }

  const appointmentParams = new URLSearchParams(search);

  if (
    userRole !== "patient" &&
    pathname === "/appointments" &&
    appointmentParams.get("appointment")
  ) {
    return "appointment";
  }

  return null;
}

type WorkspaceRailResolverProps = {
  workspaceRailKind: WorkspaceRailKind;
};

export function WorkspaceRailResolver({ workspaceRailKind }: WorkspaceRailResolverProps) {
  switch (workspaceRailKind) {
    case "patient":
      return <PatientWorkspaceNav />;
    case "case":
      return <CaseWorkspaceNav />;
    case "patient-case":
      return (
        <>
          <PatientWorkspaceNav />
          <CaseWorkspaceNav />
        </>
      );
    case "appointment":
      return <AppointmentWorkspaceNav />;
    default:
      return null;
  }
}
