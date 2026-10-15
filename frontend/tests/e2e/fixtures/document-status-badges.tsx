import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "../../../src/index.css";
import { DataTable } from "../../../src/components/data-table/data-table";
import { AuthProvider } from "../../../src/lib/auth";
import { useLang } from "../../../src/lib/i18n";
import { DocumentStatusBadges } from "../../../src/pages/documents/ui/document-demo-signature-badge";

function DocumentStatusFixture() {
  const { lang } = useLang();
  const rows = [
    { id: "synthetic-active", label: lang === "de" ? "Aktiv" : "Активно" },
    { id: "synthetic-archived", label: lang === "de" ? "Archiviert" : "В архиве" },
  ];
  return <main className="space-y-4 p-4">
    {(["comfortable", "compact", "condensed"] as const).map(density => (
      <section key={density} data-testid={`status-table-${density}`}>
        <DataTable
          density={density}
          rows={rows}
          rowId={row => row.id}
          columns={[{
            id: "status", label: "Status", width: 300, accessor: row => row.label,
            render: row => <DocumentStatusBadges documentId={row.id} statusLabel={row.label} statusClassName="rounded-full" />,
          }]}
        />
      </section>
    ))}
  </main>;
}

createRoot(document.getElementById("root")!).render(
  <MemoryRouter><AuthProvider><DocumentStatusFixture /></AuthProvider></MemoryRouter>,
);
