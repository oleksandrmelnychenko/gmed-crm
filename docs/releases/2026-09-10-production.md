# Prepared PROD release — 10.09.2026

Source: `61654230990ac6a6b4c4c235d388979bd3113917` on `codex/prod-20260910`.

Build: https://github.com/oleksandrmelnychenko/gmed-crm/actions/runs/34527367648

The application comes from the successful DEV deployment `9a22edbd2743-worktree-ef350b3f1742` completed on 10.09.2026 at 20:25 UTC. The Git tree of the downloaded source archive was verified as `ef350b3f174288d0d650be3ad5736a176070357c` before release fixes were applied. Subsequent wizard/catalog work in the main working directory is excluded.

Release fixes: Rust formatting; removal of an unused assignment in an integration test; the existing role-aware redirect for the legacy hotel URL; updated invoice-import test expectation for the optional provider field.

## Included changes

- Patient order preparation wizard: current patient facts, order period, services and pricing, contract coverage, documents/signatures and final checks.
- Responsive Kanban start/end date layout and Work Center scheduling, paused tasks and subtasks.
- Hotel workspace and stay statistics, including room and breakfast reporting.
- Concierge access to projects they create, plus project deletion for authorized roles.

## Local checks

- Frontend unit tests: 179 files, 1343 tests passed.
- Frontend ESLint and staff navigation guard: passed.
- TypeScript and production frontend build: passed; existing bundle-size warnings remain.
- Rust formatting: passed. Rust Clippy passed for the matching backend changes.
- Repository hygiene and print binding audit: passed.

## Migration delta from the previously pinned PROD source

- `20260910120000_patient_order_intake.sql`
- `20260910190000_work_center_schedule_and_subtasks.sql`
- `20260910210000_hotel_stay_statistics.sql`
- `20260910220000_hotel_breakfast_details.sql`

This is a source comparison with `4a12f9a67382e82346f7d93ef1de8a13bf87c34f`, not a query of the live PROD migration ledger.

## Build status

All four GitHub quality gates passed. Frontend: 1343 unit tests, 38 mocked chat browser tests, 2 live chat/realtime tests, dependency audit, lint, production build, print bindings, migration preflight unit tests and repository hygiene. Rust: formatting, Clippy and 1079 tests passed across 73 result groups; 20 tests were ignored by the existing suite configuration. The returning-patient order intake integration scenario passed. Both parser quality gates passed.

Release Build completed successfully on 10.09.2026 at 21:23 UTC. All four application images were built, pushed to GHCR, scanned with Trivy (HIGH/CRITICAL fixable vulnerabilities) and signed with keyless cosign. Both parser images passed their runtime checks before signing.

## Immutable images

The deployment manifest is `infra/terraform/environments/prod-hetzner/release-images.pins` on `codex/prod-20260910`.

```dotenv
GMED_BACKEND_IMAGE=ghcr.io/oleksandrmelnychenko/gmed-crm-server@sha256:aa26a94b9520b18f683dc8b41a42ed511ce3a21586169857e4ef60cb1c1456d9
GMED_FRONTEND_IMAGE=ghcr.io/oleksandrmelnychenko/gmed-crm-frontend@sha256:162a9a68e4a914b4422bc8beac781e86f7dfa191cebe56acc119626ab3032d98
GMED_PARSER_IMAGE=ghcr.io/oleksandrmelnychenko/gmed-crm-clinical-document-parser@sha256:8d198315f810195df5b8716b1dced639a80f68d26db272199ef2a84595507986
GMED_INVOICE_PARSER_IMAGE=ghcr.io/oleksandrmelnychenko/gmed-crm-invoice-parser@sha256:0cf25c4f5799e20674a2e13a8a420990d4459cc9d58a03bc5504b05b5ec8f309
```

## Deployment state

Prepared and published images only: PROD deployment and PROD database migrations have not been run. Release metadata is kept on `codex/prod-20260910`; ongoing main-branch changes are outside this release.

When deployment is requested, the existing `scripts/deploy-prod.sh --upgrade-only` must use this release branch via `GIT_BRANCH=codex/prod-20260910`, or a subsequently reviewed commit containing these exact image pins. Its default branch is `main`, which does not yet contain this release manifest. The application image source remains `61654230990ac6a6b4c4c235d388979bd3113917` even after the metadata commit.
