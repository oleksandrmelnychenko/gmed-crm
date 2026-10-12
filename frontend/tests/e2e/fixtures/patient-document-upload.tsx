import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "../../../src/index.css";
import { AuthProvider } from "../../../src/lib/auth";
import { useLang } from "../../../src/lib/i18n";
import { MemoizedPatientDocumentUploadDialog } from "../../../src/pages/patients/ui/sheets/patient-document-upload-dialog";

// "Upload document" of the patient card as the documents tab mounts it. The
// spec mocks `POST /documents/upload` and reads what the dialog sends.
function Fixture() {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(0);
  const dictionary = t as unknown as Record<string, string>;
  return (
    <main className="p-4">
      <p data-testid="upload-saved">{saved}</p>
      {error ? <p role="alert">{error}</p> : null}
      <MemoizedPatientDocumentUploadDialog
        open={open}
        patientId="00000000-0000-4000-8000-000000000301"
        orders={[]}
        appointments={[]}
        dictionary={dictionary}
        l={(key) => t.uiText[key] ?? key}
        lang={lang}
        textareaClassName="w-full rounded border"
        statusLabel={(status) => status}
        formatDate={(value) => value ?? ""}
        onOpenChange={setOpen}
        onSaved={() => setSaved((count) => count + 1)}
        onError={setError}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <AuthProvider>
      <Fixture />
    </AuthProvider>
  </MemoryRouter>,
);
