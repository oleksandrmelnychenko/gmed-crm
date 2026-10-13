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

## Verified checks and remaining release gates

Each area matrix records tests already passed. Verified frontend gates:

- Production build (TypeScript and Vite) and full ESLint / staff navigation guard passed.
- 3262 distinct unit cases verified: 3261 in the full batch plus the obsolete payer-link copy assertion corrected and its entire nine-case file passed on rerun.
- All 43 cabinet, nine representation and seven follow-up browser cases passed across the main runs and targeted retries, using mocked APIs on the built frontend.
- Sixteen admin/settings/notification/security/activity/health/sanctions browser cases passed, including 1440/390 px layouts. One outdated sheet-title selector was corrected for the new modal and its scenario rerun successfully.
- Playwright collected all 826 cases in 86 files; this is collection evidence, not a claim that all 826 were executed.

Local backend verification completed:

- Server library: 912 passed; one explicitly opt-in PostgreSQL provider test remained ignored.
- 188 distinct API cases passed across the combined batch and targeted retries: admin compliance 18, identification 9, payer 11, payer links 9, cabinet 31, representatives 6, risk 6, leads 71, signature packages 14, signature closure 3, and documents 10.
- Full workspace Clippy with `-D warnings`, rustfmt, and diff checks passed after the final fixture corrections.
- Repository hygiene, print bindings and three production migration-preflight unit tests passed.

Initial runtime failures included old fixtures and expectations, the missing payer-link revocation CHECK values, database/application timestamp ordering, and historical parent-QES attribution. Corrections were verified, including complete recipient details, protected adult representatives, health consent before concern text, and the base-submission gate before follow-up submission. The initial combined batch is not represented as green: its failed cases passed in the documented targeted retries. Logs are retained under `.tmp/release-audit/` (`cabinet-rust-verified`, `erasure-regression-retry`, `portal-regressions-retry`, `paying-parent-route-retry`, `representation-risk-retry`, `risk-follow-up-retry`, `signature-regressions`, `minor-signature-fixture-rerun`, `document-consent-regressions`, and `clippy-fixtures-final`).

CI and the signed Release Build remain deployment gates for production; local checks do not replace them. Docker prebuild completed for all four DEV services from committed application code. No live patient data was changed by validation. The disposable PostgreSQL instance used a five-second authentication timeout to clean up abandoned test connections promptly; live database settings were not changed.

An existing patient-portal limitation lies outside the supplied finding IDs: one parent login linked to multiple converted children needs a patient-context selector. Selecting a child implicitly would be unsafe; this broader flow was reported separately to the coordinating worker.

## Deployment verification

DEV published committed source `9666a83aa1f1e29d6d060a29109c6a7a3af5ae56` on 2026-10-13 at 08:30 UTC through `publish-dev-current.ps1 -CommittedOnly`. All four application images were rebuilt and their running image IDs verified. The unrelated, uncommitted parser training work was excluded.

The migration rehearsal passed with 469 existing migrations and two pending migrations (`20261013140000`, `20261013141000`). The database backup is retained at `/home/gmed/deploy/backups/database-20261013T083007Z`; the preceding source release is retained at `/home/gmed/deploy/backups/gmed-crm.before-20261013T083007Z`. Deployment exited zero; the public health endpoint returned HTTP 200. Backend, frontend, invoice parser and machine translation reported healthy; the clinical parser worker was running. Evidence: `.tmp/release-audit/dev-publish-final.log`.

Production promotion is gated by [Release Build 38369141127](https://github.com/oleksandrmelnychenko/gmed-crm/actions/runs/38369141127) for that exact source. It has not yet been promoted at this checkpoint.

The release frontend quality gate completed successfully: all 3262 unit cases passed in one clean batch, all 38 mocked chat browser cases passed, and both live chat/realtime cases passed. Lint, production build, dependency audit, print binding audit, three migration-preflight checks and repository hygiene also passed. Evidence: `.tmp/release-audit/release-frontend-final.log`.

CI run 38369140533 passed 42 of 43 cabinet browser cases, then identified an outdated exact payload assertion: the complete payer fixture now includes `city` and `country`. The expected payload now includes both fields, preserving the strict equality check; the scenario passed against an isolated current-source Vite server with its API proxy disabled. Evidence: `.tmp/release-audit/cabinet-ci-fixture-retry.log`. This correction changes only the browser test and this report; application source remains the release source above. A follow-up CI run is required for the corrected test commit.
