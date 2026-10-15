import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";

/** Keep bookmarks working after moving disclosure into the request wizard. */
export function LeadTrustedPersonsPage() {
  const { user } = useAuth();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set("step", "disclosure");
  return <Navigate replace to={`${user?.portal_mode === "lead" ? "/" : "/request"}?${params}`} />;
}
