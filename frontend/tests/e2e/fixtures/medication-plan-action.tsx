import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/index.css";
import { MedicationPlanPdfAction } from "../../../src/pages/patients/ui/sections/medication-plan-pdf-action";

function Fixture() {
  const [patientId, setPatientId] = useState("patient-one");
  const lang = new URLSearchParams(window.location.search).get("lang") === "de" ? "de" : "ru";
  return <main className="p-4">
    <MedicationPlanPdfAction patientId={patientId} lang={lang} />
    <button onClick={() => setPatientId("patient-two")}>Switch patient</button>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
