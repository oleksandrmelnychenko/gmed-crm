import { createContext, use, useEffect, useState, type ReactNode } from "react";

interface NavStateValue {
  collapsed: boolean;
  toggle: () => void;
}

const NavStateContext = createContext<NavStateValue | null>(null);

const COMPACT_NAV_QUERY = "(max-width: 1023px)";

function readInitialCollapsedState() {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.(COMPACT_NAV_QUERY).matches) return true;
  return localStorage.getItem("gmed_nav_collapsed") === "true";
}

export function useNavState() {
  const ctx = use(NavStateContext);
  if (!ctx) throw new Error("useNavState must be inside NavStateProvider");
  return ctx;
}

export function NavStateProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(readInitialCollapsedState);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.(COMPACT_NAV_QUERY);
    if (!mediaQuery) return;

    const collapseForCompactViewport = () => {
      if (mediaQuery.matches) setCollapsed(true);
    };
    collapseForCompactViewport();
    mediaQuery.addEventListener("change", collapseForCompactViewport);
    return () => mediaQuery.removeEventListener("change", collapseForCompactViewport);
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("gmed_nav_collapsed", String(next));
  };

  return (
    <NavStateContext.Provider value={{ collapsed, toggle }}>
      {children}
    </NavStateContext.Provider>
  );
}
