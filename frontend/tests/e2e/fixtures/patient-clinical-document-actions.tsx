import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/index.css";
import { PatientClinicalDocumentActions } from "../../../src/pages/patients/ui/sections/patient-clinical-document-actions";

const params = new URLSearchParams(window.location.search);
const lang = params.get("lang") === "de" ? "de" : "ru";
localStorage.setItem("gmed_lang", lang);

function Fixture() {
  const [scanning, setScanning] = useState(false);
  return <main className="space-y-4 p-4">
    <h1 className="text-xl font-semibold">Test Patient</h1>
    <PatientClinicalDocumentActions
      patientId="patient-one"
      lang={lang}
      canViewClinical={params.get("clinical") !== "false"}
      canManageDocuments={params.get("scan") !== "false"}
      importAttentionCount={2}
      onScan={() => setScanning(true)}
    />
    {scanning ? <p role="status">Scan opened</p> : null}
  </main>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
