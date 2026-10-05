import React, { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "../../../src/index.css";
import { AuthProvider } from "../../../src/lib/auth";
import { PatientPayerSummaryCard } from "../../../src/pages/patients/ui/sections/patient-payer-summary";

// The card alone, as the profile tab mounts it: the signed-in user comes from
// the mocked `/me` (the lead link needs `leads.view`), the summary from the
// mocked `GET /patients/{id}/payer-summary`. "Reload patient" bumps the
// reload key the page passes as its patient detail.
const patientId = "00000000-0000-4000-8000-000000000001";

function PatientPayerSummaryFixture() {
  const [reloadKey, setReloadKey] = useState(0);
  const [navigated, setNavigated] = useState("");
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <button type="button" onClick={() => setReloadKey((value) => value + 1)}>Reload patient</button>
      {navigated ? <p role="status" data-testid="navigated">{navigated}</p> : null}
      <PatientPayerSummaryCard patientId={patientId} staffGo={setNavigated} reloadKey={reloadKey} />
    </div>
  );
}

// The app root never scrolls itself (index.css); the profile tab lives in a
// scrolling workspace. The harness lets the page scroll instead, so a full
// page screenshot shows the whole card on a phone.
for (const node of [document.documentElement, document.body, document.getElementById("root")!]) {
  node.style.height = "auto";
  node.style.overflow = "visible";
}

const fixtureWindow = window as Window & { patientPayerSummaryRoot?: Root };
fixtureWindow.patientPayerSummaryRoot ??= createRoot(document.getElementById("root")!);
fixtureWindow.patientPayerSummaryRoot.render(
  <MemoryRouter><AuthProvider><PatientPayerSummaryFixture /></AuthProvider></MemoryRouter>,
);
