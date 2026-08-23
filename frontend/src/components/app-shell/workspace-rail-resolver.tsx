import { matchPath } from "react-router-dom";

import { OrderWorkspaceNav } from "../order-workspace-nav";
import { AppointmentWorkspaceNav } from "@/pages/appointments/ui/appointment-workspace-nav";
import { PatientWorkspaceNav } from "@/pages/patients/ui/patient-workspace-nav";

export type WorkspaceRailKind =
  | "patient"
  | "order"
  | "patient-order"
  | "appointment"
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

  return null;
}

type WorkspaceRailResolverProps = {
  workspaceRailKind: WorkspaceRailKind;
};

export function WorkspaceRailResolver({ workspaceRailKind }: WorkspaceRailResolverProps) {
  switch (workspaceRailKind) {
    case "patient":
      return <PatientWorkspaceNav />;
    case "order":
      return <OrderWorkspaceNav />;
    case "patient-order":
      return <OrderWorkspaceNav />;
    case "appointment":
      return <AppointmentWorkspaceNav />;
    default:
      return null;
  }
}
