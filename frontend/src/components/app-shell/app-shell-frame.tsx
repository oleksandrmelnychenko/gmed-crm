import { useEffect, useLayoutEffect, useMemo, type CSSProperties, type ReactNode } from "react";

import { CommandPalette } from "@/components/command-palette";
import { Toaster } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import { DEFAULT_THEME, themeCssVariables } from "@/lib/appearance-theme";
import { useAppearanceTheme } from "@/lib/use-appearance-theme";
import { useLang } from "@/lib/i18n";
import { useNavState } from "@/lib/nav-state";
import { isLeadPortalUser } from "@/lib/staff-route-access";
import { cn } from "@/lib/utils";
import { useLeadCabinetLang } from "@/pages/patient-lead/lead-cabinet-language";
import { leadShellText } from "@/pages/patient-lead/lead-shell-text";

import { NavPanel } from "../nav-panel";
import { Topbar } from "../topbar";
import { WorkspaceRailResolver, type WorkspaceRailKind } from "./workspace-rail-resolver";
import "./patient-portal-theme.css";
import "../ui/gmed-theme.css";
import "./gmed-shell-theme.css";
import "./staff-portal-theme.css";
import "../ui/gmed-controls.css";
import "../ui/form-labels.css";

type AppShellFrameProps = {
  children: ReactNode;
  workspaceRailKind: WorkspaceRailKind;
};

export function AppShellFrame({ children, workspaceRailKind }: AppShellFrameProps) {
  const { collapsed, toggle } = useNavState();
  const { lang, t } = useLang();
  const { user } = useAuth();
  // The lead cabinet speaks DE, EN, UA and RU; its shell follows (QA 2026-10-24, A-7).
  const cabinetLang = useLeadCabinetLang(user, lang);
  const leadShell = isLeadPortalUser(user) ? leadShellText(cabinetLang) : null;
  const skipToContentLabel = leadShell?.skipToContent ?? (lang === "de" ? "Zum Inhalt springen" : "Перейти к содержанию");
  const toggleSidebarLabel = leadShell?.toggleSidebar ?? t.ui_toggle_sidebar;
  const leadPortal = leadShell !== null;
  const patientPortal = user?.role === "patient";
  const themeScope = leadPortal || !user ? null : patientPortal ? "patient-portal-theme" : "staff-portal-theme";
  const { theme } = useAppearanceTheme(themeScope ? user?.id ?? null : null);
  // The default uses the existing stylesheet unchanged, including its legacy dark palette.
  const themeVariables = useMemo(() => theme.id === DEFAULT_THEME.id ? {} : themeCssVariables(theme), [theme]);
  // Sheets and dialogs render into document.body and need the same palette.
  // Remove the previous workspace scope on logout or a role change.
  useLayoutEffect(() => {
    if (!themeScope) return;
    document.body.classList.add("gmed-theme", themeScope);
    const previous = Object.keys(themeVariables).map((key) => [key, document.body.style.getPropertyValue(key)]);
    for (const [key, value] of Object.entries(themeVariables)) document.body.style.setProperty(key, value);
    return () => {
      document.body.classList.remove("gmed-theme", themeScope);
      for (const [key, value] of previous) {
        if (value) document.body.style.setProperty(key, value);
        else document.body.style.removeProperty(key);
      }
    };
  }, [themeScope, themeVariables]);
  // `<html lang>` follows the cabinet language, UA and EN included (QA 2026-10-25, G F-G6): screen
  // readers and hyphenation. Every `useLang` sets the portal language there; the cabinet's wins.
  useEffect(() => {
    if (!leadPortal) return;
    const root = document.documentElement;
    const apply = () => {
      if (root.lang !== cabinetLang) root.lang = cabinetLang;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["lang"] });
    return () => {
      observer.disconnect();
      root.lang = lang;
    };
  }, [leadPortal, cabinetLang, lang]);

  return (
    <div className={cn("h-dvh overflow-hidden bg-background", themeScope && "gmed-theme", themeScope)} style={themeScope ? themeVariables as CSSProperties : undefined}>
      <a
        href="#main-content"
        className="sr-only fixed left-3 top-3 z-[60] rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background focus:not-sr-only focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {skipToContentLabel}
      </a>
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <Topbar />
        <div className={cn("app-shell-body relative flex min-h-0 min-w-0 flex-1 overflow-hidden", patientPortal ? "bg-card" : "bg-muted/60")}>
          <NavPanel />
          {!collapsed ? (
            <button
              type="button"
              className="fixed inset-x-0 bottom-0 top-12 z-30 bg-foreground/20 lg:hidden"
              aria-label={toggleSidebarLabel}
              onClick={toggle}
            />
          ) : null}
          <WorkspaceRailResolver workspaceRailKind={workspaceRailKind} />
          <main
            id="main-content"
            tabIndex={-1}
            className={cn(
              "min-w-0 flex-1 overflow-auto overscroll-contain bg-card px-2.5 py-3 sm:ml-1 sm:mt-1 sm:rounded-tl-lg sm:border-t sm:border-border/40 sm:px-4 sm:py-3.5 lg:px-5 lg:py-4 [&::-webkit-scrollbar-track]:my-1.5",
              workspaceRailKind === "appointment" && "bg-card",
              // Patients and leads on a phone: a 16 px gutter, not the dense staff spacing (owner 2026-10-27).
              patientPortal && "px-4 py-4",
            )}
          >
            {children}
          </main>
        </div>
      </div>
      <CommandPalette />
      <Toaster />
    </div>
  );
}
