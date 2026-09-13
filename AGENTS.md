# GMed repository guidance

## Scope and completion

Complete the requested change through relevant verification and fixes. Continue routine local work within the user's authorization; ask only when a missing decision, access, or authorization prevents the next step. A request to review is read-only unless the user also asks for changes.

Read documentation for the affected area, not the entire documentation set before every edit. Preserve unrelated work in the shared checkout. Report what changed, what was verified, and any remaining blocker.

## Context by task

- Product requirements or scope conflicts: [source hierarchy](docs/00_source-of-truth_ua.md). German client originals take precedence over translations; incorporate explicit user changes without silently rewriting generated backlog files.
- Service boundaries: [target architecture](docs/architecture/01_target-architecture_ua.md). Use [documentation map](docs/README.md) to locate domain-specific guidance. Dated status reports are historical evidence; check current code and workflows for implementation status.
- Access control: [RBAC matrix](docs/backlog/02_rbac-matrix_ua.md) and existing server authorization. Hiding UI controls does not replace server checks.
- Audit changes: [audit migration policy](docs/engineering/02_audit-migration-policy_ua.md). Preserve append-only history and transaction-coupled audit semantics.
- DATEV or invoice integration: [integration design](docs/architecture/datev-invoice-integration_ua.md). Distinguish demo/preflight results from verified external connectivity.

## Validation

Choose checks for the changed behavior. Documentation-only edits need link/content checks, not application builds. For code, run affected tests and required checks; broaden testing when failures or shared behavior warrant it. Release gates remain defined by [CI](.github/workflows/ci.yml) and [Release Build](.github/workflows/release.yml).

- Frontend commands run from `frontend/`: `npm run typecheck`, `npm test -- <test-file>`, `npm run test:e2e -- <spec-file>`. See [package.json](frontend/package.json) for lint/build commands and supported Node/npm versions.
- Rust commands run from the repository root: `cargo fmt --all -- --check`, targeted `cargo test --locked`, and relevant Clippy checks. Database tests need a disposable database; [isolated test runner](scripts/run-rust-tests-isolated.sh) provides the full Docker-based gate.
- Before live browser/API tests, check the configured backend and whether the test writes data. A localhost frontend can proxy a remote environment; it does not imply disposable data.

## Environments and deployment

Repository edits do not authorize a deployment. Honor deployment authorization already given for the active task, including its target environment.

- DEV: use [publisher](scripts/publish-dev-current.ps1) and [runner](scripts/deploy-dev-current.sh); preserve deployment locking, migration rehearsal, and recovery behavior.
- PROD: use [release workflow](.github/workflows/release.yml), signed digest-pinned images, and [deployment script](scripts/deploy-prod.sh). Preserve backup and migration preflight gates; do not substitute the DEV deployment path.
- Keep credentials, medical documents, and real patient data out of committed fixtures and logs. Use synthetic fixtures for reproducible tests.
