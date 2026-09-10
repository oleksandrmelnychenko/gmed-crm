# Hotel negotiation statistics

The standalone staff screen is `/hotels`, with its own Hotels entry in the CRM
sidebar. The earlier `/reports/hotels` address redirects to `/hotels`. It uses
`GET /api/v1/stats/reports/hotels?from=YYYY-MM-DD&to=YYYY-MM-DD`.
CEO, CEO assistant, Billing and Concierge can read the complete hotel report. Patient managers
see bookings for their currently assigned patients. CEO assistant is read-only.

The header's Add hotel action uses the standard provider creation API with the
non-medical type and the active `nonmedical_hotels` taxonomy node fixed in the form.
CEO, PatientManager and Concierge may create; other reporting roles retain read-only directory
access. The form keeps entered details after a failed save and requires a valid
hotel taxonomy before submitting. Successful creation opens the hotel's documents.
`GET /api/v1/stats/reports/hotels/directory` lists active hotel providers independently
of bookings. Registered hotels without matching stays remain available in the default
list and hotel/city search; booking-specific status or breakfast filters exclude them.
They contribute no stays, patients, nights, or money to the report.

## Measurement contract

- Grain: one hotel booking. A legacy concierge service and its canonical task
  are one booking. Task-only hotel bookings are included. Deleted tasks are
  excluded; archived bookings remain historical evidence.
  Native booking context takes precedence over older linked helper tasks. A deleted
  native booking or a cleared native patient does not resurrect legacy facts. Read,
  room-count and breakfast mutations apply the same canonical ordering and scope.
- Cohort: arrival date in Europe/Berlin, inclusive date bounds. Nights and costs
  cover the entire stay, including departures after the selected period. Missing
  arrival dates are reported separately and excluded from period totals.
- Default population: confirmed, in-service and completed bookings; currency EUR.
  Status, currency, city, hotel, breakfast and search filters intersect. There is no 200-row
  cap. Date range is limited to three years.
- Patients: distinct patient IDs, recalculated across the whole selection.
  Hotel patient counts are not added to obtain the overall patient count.
- Stay nights: calendar departure date minus arrival date. Invalid/missing dates
  are unknown. Cancelled bookings contribute no nights.
- Room nights: stay nights times explicitly recorded room count. Legacy quantity
  is not treated as room count. Missing room counts remain unknown.
- Stay cost: recorded `actual_cost`, otherwise `cost_estimate`, otherwise unknown.
  Actual and estimated contributions remain separate. A cancelled estimate is
  excluded; recorded cancellation costs remain included. Expense payments are
  not added to the stay price or used to guess the full stay cost.
- Average room-night price: summed stay costs divided by room nights for the
  same priced bookings with known room counts/dates. Includes estimates; coverage
  is shown. No averaging of per-hotel averages.
- Payment figures: only posted concierge expenses linked to the booking. Direct
  patient payments are separated from company payments. Company payment and
  remaining provider liability come from the canonical settlement balance view,
  so partial payments and reversals are respected. Pending submissions are shown
  separately; rejected and reversed postings contribute nothing. These figures
  cover linked expenses, not every independently entered provider invoice.
- Money is aggregated in integer cents. Currency groups are never combined.
- Charts, table and CSV use the same selected cohort. Unpriced bookings do not
  become zero-cost observations. Hotel room/cost coverage accompanies partial
  metrics. CSV is quoted, UTF-8 BOM encoded and formula-injection escaped.
- Stay detail includes patient name/public number and native booking reference.
  Its search and separate stay-level CSV match names, patient numbers and references.
  Filtering keeps editors mounted, preserving hidden drafts; export uses saved facts.
  Both close controls use the shared unsaved-change guard.

## Room-count correction

Migration `20260910210000_hotel_stay_statistics.sql` introduces reporting metadata
keyed by either concierge service or task, with real foreign keys and an exclusive
source constraint. It does not alter financial transactions or old room counts.
`PUT /api/v1/stats/reports/hotels/{service|task}/{id}/rooms` accepts `room_count`
(1–1000 or null), checks source identity and patient scope within the SQL mutation,
and records the editor and time. Updates are idempotent upserts. A legacy-linked
task cannot create a second report identity.

## Breakfasts and contracts

The hotel profile opens by clicking any table row. The hotel list uses the shared
DataTableSurface (column controls, sorting, filtering, pagination and mobile cards).
Page filters use compact widths and a single wrapping toolbar; the header contains
only Add hotel. The former report refresh and summary export actions are removed.

Hotel-wide breakfast terms are separate from actual stay breakfast records.
`GET/PUT /api/v1/stats/reports/hotels/{id}/breakfast-terms` stores unknown, included,
extra, or unavailable; optional price per person per breakfast, its currency, and
notes. CEO, PatientManager and Concierge can edit. Reporting roles can read.
The server requires a non-medical hotel provider, validates the mode/price/currency,
and patches only `providers.taxonomy_attributes.hotel_breakfast_terms`, recording
editor/time while preserving other attributes. Included/unavailable breakfast has
no extra price. Changing hotel terms never rewrites past or future stay records,
adds charges, or posts payments. No additional migration is needed for these terms.

Migration `20260910220000_hotel_breakfast_details.sql` adds breakfast conditions to
the same booking metadata. `PUT /api/v1/stats/reports/hotels/{service|task}/{id}/breakfast`
uses the same source and assignment scope as room counts. It stores the arrangement
(unknown, included in stay, hotel extra, independently outside hotel, none), total
portions for the stay, actual total cost, original currency, payer (unknown, patient,
GMED, shared), and notes. Unknown quantities/costs stay null. Included breakfast cannot
carry an extra amount; none/unknown cannot imply a quantity. Switching arrangements
clears inapplicable values. Room and breakfast updates preserve one another's fields.

Breakfast counts/portions exclude cancellations and are booking-based, not patient
counts. Separately recorded hotel extras and outside-hotel spending have distinct
totals and coverage in the screen and CSV. These reporting totals never increase stay
price or generate ledger transactions. The displayed stay price may already include
the hotel breakfast charge. Breakfast amount currency is checked at save time and
retained if the booking currency later changes; mismatches are flagged and excluded
from monetary aggregates, with no implicit conversion. Mixed payment responsibility
is recorded as shared, without inventing a financial split.

The hotel detail view attaches general contracts/tariffs through the existing
`/providers/{id}/documents` upload and `/documents/{id}/download` pipeline. General
documents have no patient association and are selected server-side using
`general_only=true`, excluding patient and medical documents. The encrypted document
store, file content validation, scan policy and existing role permissions apply.
CEO/PatientManager may upload, Billing may read; Concierge may upload and download
general hotel contracts. The Concierge grant requires a non-medical hotel provider
with `nonmedical_hotels` taxonomy, no patient association and a non-medical file;
download additionally requires no lead/order/appointment association and respects
explicit document ACLs. Other provider/medical document permissions are unchanged.
CEOAssistant does not gain document
access from access to statistics. A vendor-only booking needs a real provider selected
before attaching hotel-wide documents. Hotel contracts are independent of the report
period and shared across stays at that provider. No duplicate storage system exists.
The document download path recognizes genuine general provider contracts for
PatientManager and Billing: exact provider-document type, existing provider link,
no patient/lead/order/appointment and non-medical. It still evaluates explicit ACLs.
This fixes the mismatch between the provider list/upload role contract and the
patient-assignment/internal-document download boundary.

Concierge may also edit room counts and breakfast details for the complete hotel
cohort. This hotel workflow does not grant access to other financial workspaces.

## Verification and rollout

- Frontend: model/route-access unit tests and Playwright desktop/mobile flows in
  Russian and German, including filters, CSV, room-count persistence, failure
  recovery, empty/error and read-only states, breakfast edit/filter persistence,
  included-cost clearing, contract upload validation/retry/download, and standalone navigation.
  Hotel creation is covered in both languages, including contact/type payloads,
  failure recovery, mobile layout, and persistence in a directory without bookings.
- SQL: `scripts/test-hotel-statistics-sql.mjs` runs the production report and update
  SQL against an in-memory PGlite database with 250 fictional bookings. It checks
  migration identity, scope/revocation, Berlin date boundaries, monetary sources,
  reversals, pending/rejected receipts, room-count and breakfast constraints.
  It also checks an older linked helper task, native deletion and patient clearing,
  and the exact SQL projection distinguishing general contracts from private records.
  The production directory query is verified with active, inactive, medical and
  non-hotel providers before any stays exist.
- Browser screenshots use fictional test data only. No production fixture
  fallback is installed. Apply the migration with the backend release before
  using the screen against that backend; frontend-only deployment is insufficient.

DEV readiness checked on 2026-09-10 in a read-only database transaction: latest
successful migration was `20260910190000`; hotel metadata was absent and both native
and legacy hotel booking counts were zero. No DEV records were added or changed.
