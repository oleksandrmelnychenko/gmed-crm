import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/toast";
import { useLang } from "@/lib/i18n";
import { useNavState } from "@/lib/nav-state";
import { cn } from "@/lib/utils";

import { NavPanel } from "../nav-panel";
import { Topbar } from "../topbar";
import { WorkspaceRailResolver, type WorkspaceRailKind } from "./workspace-rail-resolver";

type AppShellFrameProps = {
  children: ReactNode;
  workspaceRailKind: WorkspaceRailKind;
};

export function AppShellFrame({ children, workspaceRailKind }: AppShellFrameProps) {
  const { collapsed, toggle } = useNavState();
  const { lang, t } = useLang();
  const skipToContentLabel = lang === "de" ? "Zum Inhalt springen" : "Перейти к содержанию";

  return (
    <div className="h-dvh overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only fixed left-3 top-3 z-[60] rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background focus:not-sr-only focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {skipToContentLabel}
      </a>
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <Topbar />
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-muted/35">
          <NavPanel />
          {!collapsed ? (
            <button
              type="button"
              className="fixed inset-x-0 bottom-0 top-12 z-30 bg-foreground/20 lg:hidden"
              aria-label={t.ui_toggle_sidebar}
              onClick={toggle}
            />
          ) : null}
          <WorkspaceRailResolver workspaceRailKind={workspaceRailKind} />
          <main
            id="main-content"
            tabIndex={-1}
            className={cn(
              "min-w-0 flex-1 overflow-auto overscroll-contain bg-card px-3 py-4 sm:px-5 sm:py-5 lg:px-7 lg:py-6",
              workspaceRailKind === "appointment" && "bg-white",
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
