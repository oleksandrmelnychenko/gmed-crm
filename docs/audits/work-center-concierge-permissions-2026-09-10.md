# Work Center: concierge-owned tasks and subtasks

## Policy

- Concierge can create a personal task or a personal subtask on an accessible active task. The default assignee is the current concierge, including when the parent is assigned to a colleague.
- Deletion ownership is `assigned_by` (creator), never `assigned_to` (assignee). Concierge cannot delete another creator's task, even when assigned that task or owning its parent.
- A concierge creator can delete their own task/subtask in any workflow status, including after comments, checklist entries or attachments were added.
- Existing rules for other roles are unchanged. Archived tasks must first be restored. Tasks with non-deleted children cannot be deleted; no cascading deletion or permission inheritance from parent to child is introduced.
- Deletion remains a soft deletion. Comments, checklist entries, attachment metadata/blobs and audit history remain stored; attachment endpoints exclude deleted parent tasks.
- Legacy `/tasks` list, detail and status endpoints now exclude soft-deleted tasks too. Parent child counts refresh after deletion.

## Verification

- Frontend unit suite: 1285 tests / 171 files passed.
- Browser tests with mocked API requests: 26 passed across Work Center timeline, concierge ownership/self-assignment, completed visibility and existing task workflow regressions.
- Six Rust Work Center unit tests passed, including creator-only deletion and parent collaboration permissions.
- TypeScript, scoped ESLint, production Vite build, Rust formatting and server Clippy (`-D warnings`) passed.
- The PostgreSQL integration suite compiled with `--no-run`. Added coverage for creation/ownership, worked-on task deletion, preservation of attachment/comment/checklist metadata, parent guards, foreign-child protection, and deleted-task exclusion from both API families. Database assertions have **not** run: Docker was unavailable and starting it was previously declined.

## Runtime requirement

The running local frontend proxies to DEV. These server-side changes are not deployed. Deploy the matching backend and apply the existing `20260910190000_work_center_schedule_and_subtasks.sql` migration from the preceding timeline work before exercising real subtask writes. This permission change introduces no additional migration. No real task data, DEV or production database was changed during verification.

When a disposable local PostgreSQL is available:

```powershell
cargo test -p gmed-server --test concierge_operational_items_api concierge_creators_can_delete_own_worked_tasks_but_not_foreign_tasks_or_children -- --nocapture
```

Do not point integration-test database variables at a working DEV/production database.
