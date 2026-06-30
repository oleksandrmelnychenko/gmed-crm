import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { NavPanel } from "../nav-panel";
import { Topbar } from "../topbar";
import { WorkspaceRailResolver, type WorkspaceRailKind } from "./workspace-rail-resolver";

type AppShellFrameProps = {
  children: ReactNode;
  workspaceRailKind: WorkspaceRailKind;
};

export function AppShellFrame({ children, workspaceRailKind }: AppShellFrameProps) {
  return (
    <div className="h-dvh bg-background p-2 overflow-hidden">
      <div className="h-full rounded-2xl border border-border bg-card overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)] flex flex-col">
        <Topbar />
        <div className="flex-1 flex overflow-hidden gap-[6px] p-[6px] bg-muted/50">
          <NavPanel />
          <WorkspaceRailResolver workspaceRailKind={workspaceRailKind} />
          <main
            className={cn(
              "flex-1 overflow-auto rounded-xl px-7 py-6 transition-[padding] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
              workspaceRailKind === "appointment" ? "bg-white" : "bg-card",
            )}
          >
            {children}
          </main>
        </div>
      </div>
      <Toaster />
    </div>
  );
}
