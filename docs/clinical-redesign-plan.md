# Clinical module redesign — consolidated plan

Living spec for the patient clinical-module rework. Built in **phases**: each phase =
one DB migration (written here, **applied by Olek**) + backend + frontend + commit.

Status legend: ☐ todo · ◐ in progress · ☑ done

---

## Phase 1 — Diagnosen as a tree  ☑ (shipped)

Turn the flat diagnoses list into a **tree** (`patient_diagnoses` gets a self-referential
`parent_id`). Arbitrary depth.

### Node kinds & nesting rules
- `main` — Hauptdiagnose (top level / root only)
- `secondary` — Nebendiagnose (Сопутствующий)
- `prozedur` — Prozedurale Diagnose / Prozedur

Allowed children:
- **root** → `main`
- **main** → `secondary`, `prozedur`
- **secondary** → `secondary`, `prozedur`
- **prozedur** → `prozedur` only  ← a Prozedur may nest Prozedur, but **cannot** be the
  parent of a `main`/`secondary`.

### Fields per node
| Field | main/secondary | prozedur | Spec |
|---|---|---|---|
| `label` (Klinische Diagnose / Prozedur-Beschreibung) | ✅ | ✅ | 1.1 |
| `diagnosed_on` (date, `type=date`) | ✅ | ✅ | 1.2 |
| `certainty`: **V.a.** (Verdacht) / **Bestätigt** / **Z.n.** (Zustand nach) → prefix in display ("V.a. Herzinfarkt") | ✅ | — | 1.4 |
| `chronifizierung`: Akut / Chronisch / Rezidivierend | ✅ | — | 1.5 |
| `icd_code` (ICD-10) | ✅ | — | — |
| `ops_code` (OPS) | — | ✅ | — |
| **Who diagnosed** `source_mode` = intern \| extern. intern → provider + doctor from base; extern → free-text clinic + doctor, **country from list (required)** | ✅ | ✅ | 1.6 / 1.9 |
| **Behandelnder Arzt**: doctor from base **or** "kein" (no treatment here) | ✅ | — | 1.7 |
| `note` | ✅ | ✅ | 1.8 |

### Status model change
Replaces legacy `status` (active/chronic/resolved):
- `certainty` carries the diagnostic status (V.a./Bestätigt/Z.n.) and prefixes the label.
- `chronifizierung` is a separate field.
- Backfill existing rows: `certainty='bestaetigt'`, `chronifizierung` = chronisch where old
  status was chronic, else null.

### Shared contract (field/endpoint/prop names — all agents use these verbatim)
`ClinicalDiagnosis` (FE type + API JSON, flat list; FE builds the tree from `parent_id`):
`id` (server uuid, null for new) · `cid` (client id; for existing = id) · `parent_cid` (client parent ref) ·
`parent_id` (server, read-only) · `kind` `"main"|"secondary"|"prozedur"` · `label` ·
`certainty` `"verdacht"|"bestaetigt"|"zustand_nach"|null` · `chronifizierung` `"akut"|"chronisch"|"rezidivierend"|null` ·
`icd_code` · `ops_code` · `diagnosed_on` (YYYY-MM-DD) · `note` · `source_mode` `"intern"|"extern"` ·
`provider_id`/`provider_name`/`doctor_id`/`doctor_name`/`doctor_title`/`doctor_fachbereich` (intern) ·
`external_clinic`/`external_doctor`/`external_country` (extern; country = ISO alpha-2) ·
`treating_doctor_id`/`treating_doctor_name`/`treating_doctor_title`/`treating_none`.
Legacy `status`/`grade`/`laterality` stay in the API (optional) for back-compat.

Endpoints: `GET /patients/:id/clinical` → `diagnoses: ClinicalDiagnosis[]`;
`POST /patients/:id/diagnoses` body `{ items: [...] }` (ordered parent-before-child, replace-all, map cid→uuid);
`GET /doctors` → `{ id, name, title, fachbereich, provider_id, provider_name }[]` (all active).

Components: `CountrySelect({ value, onChange, lang, className?, ariaLabel?, includeEmpty? })` +
`countryLabel(code, lang)` in `components/ui/country-select.tsx`;
`DiagnosisTreeSection({ items, providers, allDoctors, canManage, lang, onSave })` in
`pages/patients/ui/sections/diagnosis-tree.tsx` (renders the whole "Диагнозы" card).

### Build checklist
- ☐ Migration `patient_diagnoses`: +`parent_id`, +`certainty`, +`chronifizierung`,
  +`source_mode`, +`external_clinic/doctor/country`, +`treating_doctor_id`, +`treating_none`;
  extend `kind` CHECK with `prozedur`; backfill; index on `parent_id`.
- ☐ Backend `GET /doctors` (all active doctors) for the Behandelnder-Arzt picker.
- ☐ Backend diagnoses save: tree-aware (client ids → parent mapping), new fields, kind rules.
- ☐ Backend diagnoses read: return tree fields + parent_id + treating doctor name.
- ☐ FE country dropdown (`Intl.DisplayNames`, RU/DE).
- ☐ FE diagnosis tree section (recursive render, add child / edit / delete, replace-all save).
- ☐ FE form: conditional intern/extern, country, behandelnder arzt, prozedur fields.
- ☐ Overview card: render tree with certainty prefixes + attribution line.

---

## Phase 2 — Anamnese (was "Анамнез и заключение")  ☑ (shipped)

- ☐ Rename section **"Анамнез и заключение" → "Анамнез"**.
- ☐ **Remove** the **"Объективный осмотр" (Untersuchungsbefund)** field.
- ☐ Move editing into the **right sheet** (PatientSheetScaffold), like the other sections.
- ☐ **Versioning with active/inactive status**: keep history of anamnesis entries; each has
  `aktiv` / `inaktiv`.
  - Only **one** entry can be active.
  - Newest is normally the active one, BUT the user may open an **older** entry, edit it, set
    it **active**, and on save **that** entry becomes the active one (others → inactive).
- ☐ **Display: only the 1 active entry** is shown. A **"Показать историю / Verlauf anzeigen"**
  button reveals the past (inactive) entries.

### Phase 2 technical contract
- Fields kept per version: `anamnese_aktuelle`, `anamnese_vorgeschichte`, `anamnese_vegetative`,
  `anamnese_sozial`, `beurteilung`, `verlauf`. **Dropped:** `untersuchungsbefund`.
- Schema: `patient_clinical_narrative` becomes **multi-row per patient** — add `id UUID PK`,
  `is_active BOOLEAN`, `updated_at`; drop the `patient_id` primary key (keep it as an FK column);
  partial unique index `(patient_id) WHERE is_active` so only one active per patient. The existing
  single row migrates to `is_active = true`. (Keep the `untersuchungsbefund` column; stop using it.)
- API:
  - `GET /patients/:id/clinical` → `narrative` = the **active** version (or null), same field names.
  - `POST /patients/:id/narrative` body `{ id?: string|null, <6 fields>, is_active: boolean }`:
    `id` present → update that version; absent → insert a new version; `is_active:true` → deactivate
    all other versions for the patient (one transaction). Returns the saved version with its `id`.
  - `GET /patients/:id/narrative/history` → all versions (id, fields, is_active, created_at,
    updated_at), newest first.
- FE: section renamed **"Анамнез"**; shows the active version read-only with an **Edit** (right
  sheet) + **"Показать историю"** toggle; the edit form has the 6 fields + an **active** toggle.

---

## Phase 3 — Aktuelle Medikation  ☑ (shipped; lists from "аркуш 5" wired; ON HOLD shipped)

- ☐ **Einnahmeform** (route of administration) — required, dropdown (list from sheet 5).
- ☐ Rename **Form → Darreichungsform** (dosage form) — required, dropdown (list from sheet 5).
- ☐ Add **prescription date** (if any) + **prescribing doctor** (if any).
- ☐ Add **start / end date** (e.g. medication taken only for a period).
- ☐ Add a **status** (proposed values: `aktiv` / `pausiert` / `abgesetzt` / `geplant` — confirm with Olek).
- ☐ **ON HOLD** (follow-up, after Phase-3 audit): a checkbox / "Na Hold" action meaning the patient is
  temporarily NOT taking the medication. Clicking it opens a **modal** capturing a **"bis wann / до коли"**
  date (`hold_until`) and a **note** (`hold_note`). New columns `on_hold` (bool), `hold_until` (date),
  `hold_note` (text); the medication row shows a hold badge with the until-date.
- ☐ Checkboxes:
  - **Rechtlicher Status**: ☐ Apothekenpflichtig · ☐ Rezeptpflichtig (Verschreibungspflichtig) · ☐ Betäubungsmittel (BTM)
  - **Warnhinweise**: ☐ Aut-Idem-Sperre · ☐ Abgabebeschränkung · ☐ Sonstige Vermerke → free-text when checked

**NEED FROM OLEK:** the actual value lists for **Einnahmeform** and **Darreichungsform** ("аркуш 5").

---

## Phase 4 — Empfehlungen (lifecycle)  ☑ (shipped)

- ☐ Recommendation text
- ☐ Recommendation date
- ☐ Recommending doctor
- ☐ Validity period (from … to …); if only "to", reminder N days/months before
- ☐ Reminder date (to staff **and** patient)
- ☐ Status: `aktiv` · `erfolg` (done, +date +note → recommendation disappears from the list) ·
  `nicht erfolgt` (+note) · `unbekannt` (+note)
- ☐ `note` (text) + `note intern`

---

## Phase 5 — Allergien & CAVE as multi-entry CRUD  ☑ (shipped)

Today this is a single free-text field (`patients.clinical_warnings`, surfaced as "Аллергии"/CAVE
in the overview card). Make both **multi-entry lists with full CRUD** (add many / edit / delete).

- ☐ Separate lists: **Allergien** and **CAVE** (Vorsicht / contraindications / warnings).
- ☐ New table(s) (e.g. `patient_clinical_warnings` with a `kind` = `allergie` | `cave`, or two
  tables). Each entry: text/substance (+ optional reaction/severity for allergies, note for CAVE).
- ☐ Backend CRUD endpoints (replace-all per the existing clinical pattern).
- ☐ FE: a CRUD section per list (reuse the ClinicalSection add/edit/delete + right-sheet pattern).
- ☐ Overview card: render Allergien (and CAVE) from the new lists instead of the free-text split.
- ☐ Migrate existing `clinical_warnings` text into the new Allergien list (split by line/comma).

## Already covered (verify only)
- **Aktuelle Anamnese** → narrative `anamnese_aktuelle` (moves into Phase 2 versioning).
- **Befunde** → examinations section (align fields).
- **Verlauf** → narrative `verlauf`.
- **Aktuelle Therapie** → procedures / therapy section (separate from the Prozedur tree nodes).
