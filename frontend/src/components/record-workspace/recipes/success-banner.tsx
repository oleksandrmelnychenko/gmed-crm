import { type ReactNode } from "react";

export function SuccessBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
      {children}
    </div>
  );
}
