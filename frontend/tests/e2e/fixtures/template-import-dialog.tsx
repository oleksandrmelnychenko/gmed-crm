import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "../../../src/index.css";
import { AuthProvider } from "../../../src/lib/auth";
import { TemplateImportDialog } from "../../../src/pages/documents/ui/template-import-dialog";

function TemplateImportFixture() {
  const [catalogChanges, setCatalogChanges] = useState(0);
  return (
    <main className="p-4">
      <p data-testid="catalog-changes">{catalogChanges}</p>
      <TemplateImportDialog
        open
        onOpenChange={() => undefined}
        onCatalogChanged={() => setCatalogChanges((count) => count + 1)}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <MemoryRouter><AuthProvider><TemplateImportFixture /></AuthProvider></MemoryRouter>,
);
