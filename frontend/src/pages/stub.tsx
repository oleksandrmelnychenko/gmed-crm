import { useLocation } from "react-router-dom";

import { useLang } from "@/lib/i18n";

export function StubPage() {
  const { t } = useLang();
  const { pathname } = useLocation();
  const name = pathname
    .split("/")
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" / ");

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">{name || "—"}</h1>
      <p className="text-muted-foreground">{t.stub_not_implemented}</p>
    </div>
  );
}
