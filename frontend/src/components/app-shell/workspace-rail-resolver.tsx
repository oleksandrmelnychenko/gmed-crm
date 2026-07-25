import { matchPath } from "react-router-dom";

import { CaseWorkspaceNav } from "../case-workspace-nav";
import { OrderWorkspaceNav } from "../order-workspace-nav";
import { AppointmentWorkspaceNav } from "@/pages/appointments/ui/appointment-workspace-nav";
import { DocumentWorkspaceNav } from "@/pages/documents/ui/document-workspace-nav";
import { PatientWorkspaceNav } from "@/pages/patients/ui/patient-workspace-nav";

export type WorkspaceRailKind =
  | "patient"
  | "case"
  | "patient-case"
  | "order"
  | "patient-order"
  | "appointment"
  | "documents"
  | null;

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

  if (matchPath("/orders/:orderId", pathname)) {
    const orderParams = new URLSearchParams(search);
    return orderParams.get("patient") ? "patient-order" : "order";
  }

  const appointmentParams = new URLSearchParams(search);

  if (
    userRole !== "patient" &&
    pathname === "/appointments" &&
    appointmentParams.get("appointment")
  ) {
    return "appointment";
  }

  if (
    userRole !== "patient" &&
    (matchPath("/documents", pathname) ||
      matchPath("/documents/intake", pathname) ||
      matchPath("/documents/translation-requests", pathname) ||
      matchPath("/documents/:documentId", pathname))
  ) {
    return "documents";
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
    case "order":
      return <OrderWorkspaceNav />;
    case "patient-order":
      return (
        <>
          <PatientWorkspaceNav />
          <OrderWorkspaceNav />
        </>
      );
    case "appointment":
      return <AppointmentWorkspaceNav />;
    case "documents":
      return <DocumentWorkspaceNav />;
    default:
      return null;
  }
}
