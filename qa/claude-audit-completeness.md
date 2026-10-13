# Supplied Claude audit: coverage checklist

Date: 2026-10-13. This checklist compares the finding IDs in the four supplied `form-fix` reports with the implementation matrices. It does not replace runtime validation or authorize a release.

## Finding coverage

- A: all 22 IDs recorded — A-H1, A-H2, A-H3; A-M1, A-M2, A-M3, A-M4, A-M5, A-M6, A-M7, A-M8, A-M9; A-L1, A-L2, A-L3, A-L4, A-L5, A-L6, A-L7, A-L8, A-L9, A-L10. See `claude-audit-payer-followup.md`.
- B: all 16 IDs recorded — B-1, B-2, B-4, B-5, B-6, B-7, B-8, B-9, B-10, B-11, B-12, B-13, B-14, B-15a, B-15b, B-15c. See `claude-audit-minors-followup.md`.
- C: all 25 IDs recorded — C-1, C-2, C-3, C-4, C-5, C-6; C-M1, C-M2, C-M3, C-M4, C-M5; C-7, C-8, C-10, C-11, C-12, C-13, C-14; C-L1, C-L2, C-L4, C-L5, C-L6, C-L7, C-L8. See `claude-audit-person-identity-followup.md`.
- D: all 20 IDs recorded — D-1, D-2, D-3, D-4, D-5; D-M12, D-M13, D-M4, D-M5; D-L1, D-L2, D-L3, D-L4; D-6, D-7, D-8, D-9, D-10, D-11, D-L2b. See `claude-audit-consents-followup.md`.

There are 83 report entries, including overlaps between reports. No supplied finding ID is absent from its matrix. B-3, C-9 and C-L3 are not supplied report entries; their numbering gaps are not missing work.

## Overlaps and preserved behavior

- A-L10 = D-L2: direct payer GwG generation for a paying representative is refused with `payer_is_representative`. Implementation: `crates/server/src/routes/documents.rs`; API regression: `crates/server/tests/lead_identification_api.rs`. The representative's own sheet remains the identification document.
- A's audit/realtime overlaps are implemented with B-4/B-10. Historical payer audit erasure is the B migration; no live erasure has been performed by this audit.
- C-L2 and D-L2b share the consent-choice change marker and submission summary. D-11 privacy translations are implemented by the lifecycle worker and recorded in both B and D matrices.
- B-8 deliberately preserves the existing hidden converted-lead cabinet behavior, with writes still refused, as the supplied report requests.
- B-9 deliberately permits existing read access after adulthood while refusing guardian writes, as allowed by the supplied report.
- B-15c deliberately retains `lead_risk_decisions.reason` as AML evidence, as the supplied report requests.
- D-2 deliberately retains the historical paper-form recipient fallback only when there is no own consent choice. An explicit choice never inherits trusted contacts or staff recipient lines.
- D-M12 does not rewrite completed signature history. Pending consent invitations are invalidated locally and remote withdrawal is attempted after commit.
- C-M2 uses the existing identity-entry takeover action and identity-review API permission. Medical review chips stay medical-only; no new identity review control is invented.

## Validation and boundary still to report

Each area matrix records tests already passed. Verified frontend gates:

- Production build (TypeScript and Vite) and full ESLint / staff navigation guard passed.
- 3262 distinct unit cases verified: 3261 in the full batch plus the obsolete payer-link copy assertion corrected and its entire nine-case file passed on rerun.
- All 43 cabinet, nine representation and seven follow-up browser cases passed across the main runs and targeted retries, using mocked APIs on the built frontend.
- Sixteen admin/settings/notification/security/activity/health/sanctions browser cases passed, including 1440/390 px layouts. One outdated sheet-title selector was corrected for the new modal and its scenario rerun successfully.
- Playwright collected all 826 cases in 86 files; this is collection evidence, not a claim that all 826 were executed.

Combined Rust integration tests and workspace Clippy remain release gates. Initial runtime findings included outdated fixtures, a missing required synthetic document version root, and a real historical parent-QES attribution regression; fixes are included and the final batch must verify them. Host memory exhaustion interrupted the earlier parallel run; an interrupted build is not a passing result.

An existing patient-portal limitation lies outside the supplied finding IDs: one parent login linked to multiple converted children needs a patient-context selector. Selecting a child implicitly would be unsafe; this broader flow was reported separately to the coordinating worker.
