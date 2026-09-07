# Medication name autocomplete — 2026-09-07

The medication editors now share linked, editable autocomplete inputs for
`handelsname` and `wirkstoff`. Selecting a name or committing an exact typed name
looks up the opposite field. A complete result with one counterpart fills it;
multiple counterparts open the opposite input for an explicit choice. Choosing
both sides finishes the pair even when the relationship is many-to-many.

New names remain valid free text. The normal medication-save transaction records
the names in `medication_name_pairs`, with case/whitespace deduplication. Failed
or cancelled saves do not add names. A substance without an optional trade name
is remembered too; empty trade names never appear as suggestions.

Migration `20260907180000_medication_name_pairs.sql` initializes suggestions from
existing medication records. The dictionary contains names only, with no patient
links, and does not change verified drug-product identities. Search access matches
the CEO-only clinical medication editor.

The `/medication-names` endpoint accepts `field`, `q`, and optional `related` (an
exact name in the opposite field). It returns distinct `items` and `has_more`.
Lists are bounded to 50, and truncated lists cannot trigger unique auto-fill.
Search reads bypass the frontend cache so newly saved pairs are available when
the editor is reopened.

Validation:

- TypeScript, targeted ESLint and the Vite production build passed.
- 36 frontend unit/render tests passed.
- 2 server normalization/search unit tests passed.
- All 8 browser tests passed using the real medication editor: both directions,
  many-to-many choices, saving/reopening a new pair, stale-result protection,
  lookup failure, keyboard selection and mobile layout. Escape closes the
  suggestion list without opening the medication form's discard confirmation.
- The server integration test binary compiled. Windows Application Control
  blocked execution (OS error 4551), so the database assertions have not yet run.
  The tests cover atomic remembering/rollback, normalization, optional trade
  names, bounded results, literal wildcard searches and access control.

DEV has not been updated by this task. Apply the migration with the backend,
then deploy the frontend. The database integration suite must run in a supported
environment before deployment: `cargo test -p gmed-server --test medication_names_api
-- --nocapture`; verify that the test database is available and no suite is skipped.
