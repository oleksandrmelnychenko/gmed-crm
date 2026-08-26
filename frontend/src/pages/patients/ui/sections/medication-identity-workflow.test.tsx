import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  MedicationIdentityCandidateSet,
  MedicationIdentityPermissions,
} from "@/lib/api/medication-intelligence";

import {
  MedicationIdentityAction,
  MedicationIdentityWorkflow,
  buildMedicationIdentityConfirmationInput,
} from "./medication-identity-workflow";

function permissions(
  overrides: Partial<MedicationIdentityPermissions> = {},
): MedicationIdentityPermissions {
  return {
    can_search_candidates: true,
    can_confirm_identity: true,
    reason_code: null,
    ...overrides,
  };
}

function candidateSet(
  overrides: Partial<MedicationIdentityCandidateSet> = {},
): MedicationIdentityCandidateSet {
  return {
    medication: {
      id: "med-1",
      name: "Eliquis unbekannt",
      substance: "Apixaban",
      strength: "5 mg",
      form: "Filmtablette",
      pzn: null,
      atc_code: "B01AF02",
      version: "med-v4",
      identity_status: "unresolved",
    },
    candidate_set: {
      id: "set-1",
      generated_at: "2026-08-26T10:00:00Z",
      expires_at: "2026-08-26T10:15:00Z",
      query_basis: ["Apixaban", "5 mg"],
    },
    candidates: [
      {
        id: "candidate-official",
        product: {
          id: "product-1",
          brand_name: "Eliquis 5 mg Filmtabletten",
          substances: ["Apixaban"],
          strength: "5 mg",
          form: "Filmtablette",
          pzn: "12345678",
          atc_code: "B01AF02",
          country_code: "DE",
          manufacturer: "Bristol-Myers Squibb",
        },
        match_basis: ["exact_substance", "exact_strength", "exact_form"],
        confirmable: true,
        blocking_reasons: [],
        provenance: {
          source_state: "official_snapshot",
          source_id: "bfarm-products",
          source_label: "BfArM Arzneimitteldaten",
          authority: "BfArM",
          official_url: "https://www.bfarm.de/product/12345678",
          snapshot_id: "snapshot-1",
          snapshot_version: "2026-08-26",
          snapshot_fetched_at: "2026-08-26T09:00:00Z",
          snapshot_published_at: "2026-08-26T08:00:00Z",
        },
      },
      {
        id: "candidate-internal",
        product: {
          id: "product-2",
          brand_name: "Internal candidate",
          substances: ["Apixaban"],
          strength: "5 mg",
          form: "Filmtablette",
          pzn: null,
          atc_code: "B01AF02",
          country_code: "DE",
          manufacturer: null,
        },
        match_basis: ["exact_substance"],
        confirmable: false,
        blocking_reasons: ["source_unavailable"],
        provenance: {
          source_state: "internal_curated",
          source_id: "internal-drug-catalog",
          source_label: "GMED Drug Reference",
          authority: null,
          official_url: "https://not-official.example/product",
          snapshot_id: null,
          snapshot_version: null,
          snapshot_fetched_at: null,
          snapshot_published_at: null,
        },
      },
    ],
    permissions: permissions(),
    ...overrides,
  };
}

describe("MedicationIdentityAction", () => {
  it("shows Identify only when server capabilities allow candidate search", () => {
    const allowed = renderToStaticMarkup(
      <MedicationIdentityAction
        medication={{ name: "Eliquis", identity_status: "unresolved" }}
        permissions={permissions()}
        onIdentify={() => undefined}
        language="ru"
      />,
    );
    const denied = renderToStaticMarkup(
      <MedicationIdentityAction
        medication={{ name: "Eliquis", identity_status: "unresolved" }}
        permissions={permissions({
          can_search_candidates: false,
          can_confirm_identity: false,
          reason_code: "role_not_allowed",
        })}
        onIdentify={() => undefined}
        language="de"
      />,
    );

    expect(allowed).toContain("Идентифицировать");
    expect(denied).not.toContain("Identifizieren</button>");
    expect(denied).toContain("für diese Rolle nicht verfügbar");
  });
});

describe("MedicationIdentityWorkflow", () => {
  it("visibly distinguishes official snapshots from internal curated candidates", () => {
    const html = renderToStaticMarkup(
      <MedicationIdentityWorkflow
        candidateSet={candidateSet()}
        status="ready"
        selectedCandidateId={null}
        acknowledged={false}
        language="ru"
        onSelectCandidate={() => undefined}
      />,
    );

    expect(html).toContain("Официальный снимок");
    expect(html).toContain("Внутренний курируемый каталог");
    expect(html).toContain("Открыть официальный источник");
    expect(html).toContain('href="https://www.bfarm.de/product/12345678"');
    expect(html).not.toContain("not-official.example");
    expect(html).not.toContain("confidence");
    expect(html).not.toContain("уверенност");
  });

  it("requires explicit selection, acknowledgement, and server permission before confirmation", () => {
    const set = candidateSet();
    const candidate = set.candidates[0];

    expect(buildMedicationIdentityConfirmationInput(set, candidate, false)).toBeNull();
    expect(
      buildMedicationIdentityConfirmationInput(
        { ...set, permissions: permissions({ can_confirm_identity: false }) },
        candidate,
        true,
      ),
    ).toBeNull();
    expect(buildMedicationIdentityConfirmationInput(set, candidate, true)).toEqual({
      candidate_set_id: "set-1",
      candidate_id: "candidate-official",
      medication_version: "med-v4",
      source_snapshot_id: "snapshot-1",
      staff_acknowledged: true,
    });

    const beforeAcknowledgement = renderToStaticMarkup(
      <MedicationIdentityWorkflow
        candidateSet={set}
        status="ready"
        selectedCandidateId="candidate-official"
        acknowledged={false}
        language="ru"
        onConfirm={() => undefined}
      />,
    );
    const acknowledged = renderToStaticMarkup(
      <MedicationIdentityWorkflow
        candidateSet={set}
        status="ready"
        selectedCandidateId="candidate-official"
        acknowledged
        language="ru"
        onConfirm={() => undefined}
      />,
    );

    const disabledConfirm = beforeAcknowledgement.match(
      /<button[^>]*>Подтвердить связь<\/button>/,
    )?.[0];
    const enabledConfirm = acknowledged.match(
      /<button[^>]*>Подтвердить связь<\/button>/,
    )?.[0];
    expect(disabledConfirm).toMatch(/\sdisabled=/);
    expect(enabledConfirm).not.toMatch(/\sdisabled=/);
    expect(acknowledged).toContain("Запись пациента");
    expect(acknowledged).toContain("Выбранный кандидат");
    expect(acknowledged).toContain("не изменяет лечение");
  });

  it("explains deterministic backend blocking reasons instead of collapsing them", () => {
    const set = candidateSet();
    set.candidates[1] = {
      ...set.candidates[1],
      blocking_reasons: [
        "exact_brand_required",
        "substance_mismatch",
        "strength_contradiction",
        "insufficient_identity_evidence",
      ],
    };
    const html = renderToStaticMarkup(
      <MedicationIdentityWorkflow
        candidateSet={set}
        status="ready"
        selectedCandidateId={null}
        acknowledged={false}
        language="de"
      />,
    );

    expect(html).toContain("Handelsname stimmt nicht exakt");
    expect(html).toContain("Wirkstoff stimmt nicht überein");
    expect(html).toContain("Stärke widerspricht");
    expect(html).toContain("ausreichende exakte Merkmale");
  });

  it("keeps confirmation blocked in the 409 stale state and offers an explicit reload", () => {
    const html = renderToStaticMarkup(
      <MedicationIdentityWorkflow
        candidateSet={candidateSet()}
        status="stale"
        selectedCandidateId="candidate-official"
        acknowledged
        language="de"
        onConfirm={() => undefined}
        onReload={() => undefined}
      />,
    );

    expect(html).toContain("haben sich geändert");
    expect(html).toContain("Kandidaten neu laden");
    expect(
      html.match(/<button[^>]*>Verknüpfung bestätigen<\/button>/)?.[0],
    ).toMatch(/\sdisabled=/);
    expect(html).toContain("sm:grid-cols-2");
    expect(html).toContain("sticky bottom-0");
    expect(html).toContain("min-h-11");
  });

  it("renders a deterministic no-candidate state and never implies auto-confirmation", () => {
    const html = renderToStaticMarkup(
      <MedicationIdentityWorkflow
        candidateSet={candidateSet({ candidates: [] })}
        status="ready"
        selectedCandidateId={null}
        acknowledged={false}
        language="ru"
      />,
    );

    expect(html).toContain("Детерминированные кандидаты не найдены");
    expect(html).toContain("Автоматическая связь не создаётся");
    expect(html).not.toContain("Подтвердить связь");
  });
});
