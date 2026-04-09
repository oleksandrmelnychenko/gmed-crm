import { createContext, useContext, useState, type ReactNode } from "react";

interface NavStateValue {
  collapsed: boolean;
  toggle: () => void;
}

const NavStateContext = createContext<NavStateValue | null>(null);

export function useNavState() {
  const ctx = useContext(NavStateContext);
  if (!ctx) throw new Error("useNavState must be inside NavStateProvider");
  return ctx;
}

export function NavStateProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("gmed_nav_collapsed") === "true"
  );

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
