import { useLocation } from "react-router-dom";

export function StubPage() {
  const { pathname } = useLocation();
  const name = pathname
    .split("/")
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" / ");

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">{name || "Page"}</h1>
      <p className="text-muted-foreground">This page is not yet implemented.</p>
    </div>
  );
}
