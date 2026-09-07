# Editable medication name catalog

CRM → Медикаменты / Medikamente (`/medications`) lists the saved trade-name and
active-substance pairs used by the medication editor's autocomplete.

- Both fields can be edited in the table; Save/Cancel and Enter/Escape are supported.
- Search covers either field across the complete catalog. Pages contain 50 rows.
- Staff can add pairs, including substance-only entries. An active substance is required.
- Names are whitespace-normalized. Duplicate pairs return a conflict; stale edits cannot overwrite a newer version.
- The dictionary and its API retain the existing CEO-only access of medication name suggestions.
- Editing dictionary names does not rewrite patient prescriptions or verified drug identities.

## Reviewed learning from patient medication forms

- The trade-name / active-substance fields check whether the pair is already saved.
- Unknown pairs show spelling suggestions where available. Suggestions require a
  deliberate click; similarity never establishes drug identity or triggers replacement.
- New names enter the shared dictionary only when staff check the explicit
  "names reviewed" box and successfully save the medication. Without that check,
  the medication is still saved for the patient, without teaching the dictionary.
- The request carries `name_pair_confirmation` with both reviewed names. Editing
  either field clears it in the UI; the server also ignores stale confirmation by
  comparing the normalized pair. Imports and older clients without this field do
  not automatically add names to the dictionary.
- Spelling lookup handles one edit for names of 4–7 characters and up to two edits
  for names of 8–100 characters, including adjacent transpositions. It returns at
  most five suggestions from a bounded candidate set; it is not a spelling or
  medical correctness guarantee. Existing exact-match autocomplete is unchanged.
- A failed review lookup still permits saving the patient medication.

## API and migration

- `GET /api/v1/medication-name-pairs?q=&page=1&page_size=50`: items and total count.
- `POST /api/v1/medication-name-pairs`: create `{handelsname, wirkstoff}`.
- `PATCH /api/v1/medication-name-pairs/{id}`: save `{handelsname, wirkstoff, version}`.
- `GET /api/v1/medication-name-pairs/check?handelsname=…&wirkstoff=…`: known pair,
  exact names and optional spelling suggestions; never writes data.
- `20260907220000_medication_catalog_editing.sql` adds stable IDs and version numbers;
  the existing normalized pair uniqueness constraint remains in force.
- Successful writes enrich the request audit event with the record and before/after values.

## Validation

- TypeScript, scoped ESLint and staff SPA navigation guard pass.
- Linux `cargo check` passes for the server library and medication API test target
  with the final catalog/review changes. Rustfmt passes for the edited route/tests.
- Production frontend bundle builds successfully.
- Eighteen Playwright scenarios pass: Russian/German catalog paging, search and
  inline edits; create/cancel/duplicate error; mobile editing; role restriction;
  existing bidirectional autocomplete; explicit name review and reset after edits;
  spelling choices and Russian mobile review layout.
- Route-access, medication suggestions and clinical data unit suites: 20 tests pass.
- The actual Rust spelling function and its regression test also pass in an
  isolated standalone test binary (no full server linking required).
- Server integration tests cover catalog writes, unchanged prescriptions, refreshed
  suggestions, stale edits, validation, duplicates, pagination, literal search,
  authorization, spelling review, unreviewed names and stale name confirmations.
  Execution was attempted in an isolated Linux container, but compiling the server
  exceeded its 4.5 GiB memory limit (SIGKILL; cgroup OOM counter confirmed).
  These API tests have not run successfully and are not counted as passing.
- PostgreSQL 16 migration and SQL checks pass against a schema-only copy of DEV:
  existing rows receive IDs/version zero; edits retain IDs and advance versions;
  normalized duplicates are rejected; autocomplete inserts remain idempotent;
  substance-only entries, pagination and literal wildcard searches work.
  The temporary database contained only synthetic test records and was removed.

DEV needs the API and migration deployed together through `scripts/publish-dev-current.ps1 -CommittedOnly`.
