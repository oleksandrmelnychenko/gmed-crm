# Work Center intervals, hold state and child records

## Behaviour

- Task dates: `starts_at` is the planned start, `due_at` remains the planned end/deadline. Existing tasks without a start remain undated on that side; creation time is not substituted.
- Events continue using `starts_at` / `ends_at`. Both dates appear on cards, in details and in the new weekly timeline. Calendar entries span every intersected day (exclusive end at midnight).
- `on_hold` is a persistent task/event status. Assignees and existing authorized managers can pause open/in-progress work and resume into `in_progress`. Pausing does not shift dates, approve work, or propagate to children. A missed deadline remains visible. The existing reminder scheduler only sends for `open` / `in_progress`, so a paused reminder waits for resumption.
- From an active task's detail dialog: create a subtask or linked event with its own assignee, dates and status. Patient/provider/project context is prefilled. Available children are listed in the parent; the weekly timeline groups visible children below their parent.
- A parent link is immutable after creation. Only an existing non-archived, non-terminal task can be a parent. Parent authorization is checked on the server using the same collaboration policy as task details. Linking does not broaden read access to either record.
- The database prevents parent-link changes/cycles and deletion/conversion of a task with non-deleted children. The API provides a friendly conflict for these cases. Creation retries include the parent in their identity fingerprint.
- Completing/archiving a parent does not automatically complete/archive its children.
- Reduced-motion verification from `transitions-dev` caught a specificity conflict with the modal opening animation. The Work Center dialog layout now gives the existing reduced-motion override priority; no new animation was installed.

## Deployment requirement

Apply `20260910190000_work_center_schedule_and_subtasks.sql` and deploy the matching backend before using the new write operations. No DEV or production database was changed for this task. The local frontend currently proxies to the DEV backend.

## Verification

- Frontend TypeScript and ESLint passed; production Vite build passed (existing large-chunk warning).
- Full frontend unit suite: 1282 tests / 171 files passed.
- Rust unit tests: three interval and status-policy tests passed; server Clippy with warnings denied passed.
- Browser tests: 16 passed, mocking all API requests. Coverage includes dates, pause/resume payloads, child task and event creation/reload/navigation, invalid equal dates, legacy missing starts, RU/DE layouts, mobile horizontal scrolling, reduced-motion dialogs, and existing task workflow regressions.
- Added a disposable-PostgreSQL integration test covering migration-backed persistence, status history, independent deadlines, both child kinds, idempotency, authorization and database hierarchy guards. It compiled but **did not execute database assertions**: Docker Desktop was stopped and permission to start it was declined. Do not report the suite's early-return result as an integration pass.

To run that verification when Docker is available:

```powershell
cargo test -p gmed-server --test concierge_operational_items_api work_center_intervals_hold_and_children_are_persisted_and_authorized -- --nocapture
```

Use only a disposable local test database (`support::suite_context`); do not point test database environment variables at a working DEV/production database.
