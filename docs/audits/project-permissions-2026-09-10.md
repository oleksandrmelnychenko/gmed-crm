# Project permissions and deletion

- Concierge has Projects in navigation and may create projects.
- Concierge project list, details, workflow management and deletion use immutable
  `created_by`; ownership, manager membership and task assignment do not grant
  access to another creator's project. Transferring ownership keeps creator access.
- CEO can view/manage/delete every project. Other staff retain their existing
  owner/manager/member rules.
- Project-scoped task queries and task project-link writes enforce the same
  concierge boundary. Independent access to individually assigned tasks remains.
- Project realtime recipients exclude concierge members who did not create the
  project and include the creator after ownership/team changes.
- `POST /projects/{id}/delete` requires `expected_updated_at`, checks management
  access and archives the project. Tasks and history remain. Stale deletion
  returns 409; archived projects disappear from all project reads.
- RU/DE deletion confirmation explains preserved tasks; errors keep the dialog
  and project visible. Project editors/workflows use the same creator rule.

Validation: 18 frontend unit tests, 11 browser scenarios across permissions and
workflow, scoped ESLint, TypeScript and frontend production build pass. Rust
server/test compilation passes. The new API regression also passes against a
disposable PostgreSQL 16 instance (creator transfer/edit/delete, foreign access
denials, stale deletion, task preservation and CEO deleting another user's project).

The DEV API initially ran revision `4a12f9a6` and migrations through
`20260908010000`; `on_hold` support and migration
`20260910190000_work_center_schedule_and_subtasks.sql` require the newer server.
Deploy only with `scripts/publish-dev-current.ps1 -CommittedOnly`.
