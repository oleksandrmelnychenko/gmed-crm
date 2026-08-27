# GMED Medication Intelligence — open-sources-only baseline

## Purpose

The first Medication Intelligence release is a traceable medication-reference
and preflight workflow for the German care context. It is not a prescribing
engine and must not represent incomplete public-source coverage as clinical
safety.

The implementation has three hard boundaries:

1. Only official public sources with an API, machine-readable download, feed,
   or clearly permitted reference use may be connected.
2. Patient-facing or staff-facing output must never state that a medication or
   combination is safe merely because no public-source warning was found.
3. Any patient-specific treatment change remains a medical-review decision and
   is never applied automatically.

## Initial API contract

`GET /patients/{patient_id}/medication-intelligence`

The endpoint returns a read-only snapshot with:

- the explicit mode `open_sources_only`;
- active medication and identity-resolution counts;
- deterministic findings (initially duplicate active substances and unresolved
  medication identity);
- missing-data items;
- current medication identity state;
- the official-source registry and ingestion state;
- a German/Russian disclaimer explaining the incomplete-coverage boundary.

The request path must not call remote sources. External data will be imported by
versioned background jobs and served from local snapshots when those connectors
are implemented.

## Official source registry

| Source | Intended use | Integration boundary |
| --- | --- | --- |
| EMA PMS Public API | EU product/substance/reference identifiers | OAuth2 FHIR R5 beta; testing/analysis only until EMA permits business use |
| BfArM PharmNet.Bund / AMIce | German authorisation and product documents | Reference/search first; bulk ingestion only where terms and interface permit |
| BfArM Rote-Hand-Briefe | Safety communications | RSS/official metadata; retain source URL and publication date |
| BfArM Lieferengpaesse | German supply shortages | Activate only after the official export endpoint and format are reviewed; retain snapshot date |
| Paul-Ehrlich-Institut | Vaccine/biologic safety communications | Official publication metadata and links |
| G-BA AIS | Machine-readable benefit-assessment decisions | Versioned XML/XSD complete import |
| G-BA Arzneimittel-Richtlinie | German reimbursement and prescribing context | Official documents and structured annexes where available |
| AWMF / NVL | German guideline discovery | Metadata and permitted content only; preserve guideline version/validity |
| KBV BMP specification | Medication-plan import and identifiers | Implement published BMP/DataMatrix specification |

Public visibility of a web page is not by itself permission for bulk copying or
commercial republication. If reuse rights are unclear, GMED stores metadata and
the official link rather than copied content.

For G-BA AIS specifically, the public download form is not an ingestion endpoint.
The G-BA publishes a complete XML delivery on the 1st and 15th of each month,
requires its general terms to be observed, and provides a separately requested
permanent URL for automated downloads. GMED therefore accepts that permanent URL
only through server-side secret configuration; it must never expose that fetch
URL in the API, store it as public provenance, or scrape/automate the consent
form. Public responses link to the ordinary official reference page.

## Source snapshot provenance

Every ingestion attempt and every successful payload is versioned independently.
A successful snapshot records the source URL, fetch and publication timestamps,
source version, SHA-256 checksum, optional item count, and metadata needed to
reproduce the import. Failed attempts retain their timestamp and sanitized error
without replacing the last successful snapshot.

The patient request path reads only local snapshots. Source health is derived as
`fresh`, `stale`, `error`, or `never`; a planned/manual source is never presented
as available merely because its public website can be opened.

### BfArM Rote-Hand RSS activation

The first live connector uses the RSS link published by the official BfArM
Rote-Hand page:

`https://www.bfarm.de/SiteGlobals/Functions/RSSFeed/DE/Pharmakovigilanz/Rote-Hand-Briefe/RSSNewsfeed.xml?nn=591002`

The connector has a fixed allowlisted host/path, bounded response size and
timeouts, validates RSS/XML before persisting a snapshot, and never runs in a
patient request. Because the feed carries a copyright notice, GMED exposes only
the minimal alert metadata, stable hash, explicit substance evidence, and the
official document link needed for traceability. A bounded raw feed payload is
retained internally for audit and reproducibility, but is never returned by the
API or republished as alert content.

A patient alert is emitted only when an explicitly extracted normalized
`Wirkstoff` exactly matches an active medication's normalized `wirkstoff`.
Substring, fuzzy, product-name, or model-inferred matches are not allowed. An
unmatched feed item remains available for provenance but creates no patient
finding.

### EMA PMS Public API activation gate

EMA published the PMS Public API beta in June 2026. Its current OpenAPI contract
is a read-only FHIR R5 API with OAuth2 Client Credentials, bounded pagination,
and server-side rate limiting. The beta-specific Terms and Conditions state that
it may be used for familiarisation, testing, and analytical exploration, but not
for business purposes. GMED therefore must not call it from production or label
internal catalogue data as EMA-verified while those terms remain in force.

## Medication identity confirmation boundary

The Phase 4 identity workflow is deliberately deterministic. A request creates
an immutable candidate set for one immutable medication version and one
catalogue/ruleset version. The API exposes exact match reasons and blocking
reasons, never a model-generated or client-supplied confidence score.

Only active `manual_curated` catalogue products are eligible. A candidate may
be confirmed only when the trade name matches exactly and the remaining
available identity fields provide sufficient exact evidence without a
substance, strength, or form contradiction. Confirmation revalidates both the
patient medication version and the complete current catalogue product snapshot,
including linked substances. Any change makes the candidate stale and requires
a new candidate set.

The server, not the UI, owns search and confirmation permissions. Confirmation
requires an explicit staff acknowledgement and an immutable audit decision, and
supports an idempotency key for safe retries. The legacy patient
medication-match endpoint may
still create or reject provisional candidates, but it must not create a new
`verified` identity outside this confirmation workflow.

The production connector stays disabled until the organisation has registered
credentials, the terms permit the intended business workflow, and a source
owner records approval. Candidate/confirmation APIs must continue to work only
with explicitly labelled local or otherwise licensed snapshots. PZN also cannot
be inferred from EMA PMS data: BfArM states that PZN is issued by IFA rather than
as part of the medicines authorisation process.

## Deterministic checks allowed in the baseline

- duplicate active medication rows with the same normalized `Wirkstoff`;
- unresolved identity when a current medication has neither a verified product
  match nor usable PZN/ATC provenance;
- missing fields required for later evaluation;
- stale or unavailable source snapshots once background ingestion exists.

The baseline must not infer:

- drug-drug or drug-food interaction absence;
- dose suitability;
- renal/hepatic adjustment;
- pregnancy/lactation safety;
- substitution equivalence;
- treatment recommendations.

Those capabilities require a separately validated evidence/rules layer and a
regulatory review of the intended purpose.

## AI boundary

An AI model may later summarize deterministic findings and retrieved evidence.
It may not create a medication fact, interaction, dose, contraindication, or
source citation that is absent from the structured evidence bundle. Model output
is a draft and requires an authorized medical reviewer before release.

Real patient identity must not be sent to an external model. The backend builds
a minimized clinical payload, stores the audit record locally, and keeps provider
selection behind a server-side adapter.

## Local Medication Evidence Review (Phase 5)

Phase 5 does not call an AI provider. It creates a versioned, immutable bundle
from the already computed Medication Intelligence response and then produces a
deterministic local draft. The provider capability is explicitly
`not_configured`, external calls are disabled, and there is no shell, model key,
client-selected provider, or fallback path.

The JSON evidence snapshot is privacy-minimized. It contains opaque patient
medication row IDs, deterministic findings, missing-data reasons, official
source provenance, and an internal citation registry. It does not contain the
patient ID, name, contact data, date of birth, medication brand names, or other
demographic identifiers. Finding detail and missing-data labels are deliberately
excluded because the existing Medication Intelligence text may contain a
medication display name. Once those labels are removed, identical missing-data
code/reason tuples are stored once in the privacy-minimized list; the summary's
`missing_data_total` still preserves the number reported by Medication
Intelligence.

Every draft item can contain only bilingual evidence text and citation
references. Draft citations must be members of the immutable bundle registry;
the transaction rejects any reference outside that set. The only draft sections
are `evidence_summary`, `verification_questions`, `limitations`, and their
`citation_refs`. There is no dosage, treatment-change, new-fact, or clinical
approval field. Category templates may ask staff to verify duplicate active
entries or review a linked BfArM original, but never instruct treatment.

The client first obtains a preview fingerprint, then submits it with an
idempotency key. Creation returns `409` when the current deterministic evidence
has changed. A retry with the same actor/key and same patient/fingerprint returns
the original immutable review; reuse for another patient or fingerprint returns
`409` without revealing the original review. Bundle, request, draft, and state
event persistence is transactional. Realtime/audit events are emitted only for
a newly created review, not an idempotent replay.

GMED currently has no separately qualified clinical-review role. Accordingly,
all responses expose `clinical_review.status = not_configured` and
`clinical_review.can_approve = false`. CEO access to create/read a technical
evidence draft must never be interpreted as medical approval authority. If a
qualified clinical-review workflow is introduced later, it requires a separate
role, policy, audit state machine, and regulatory approval rather than extending
this technical review implicitly.

### Intended-purpose gate

As an engineering release gate, any future patient-specific diagnostic or
therapeutic recommendation must first receive a documented intended-purpose,
qualification, and classification assessment under [Regulation (EU)
2017/745](https://eur-lex.europa.eu/eli/reg/2017/745/oj/eng) and [MDCG 2019-11
rev.1 (June
2025)](https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en?filename=mdcg_2019_11_en.pdf),
plus an [AI Act Regulation (EU)
2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj?locale=en) and [GDPR
Regulation (EU)
2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng) data-protection
review. This is not a legal classification conclusion; it is a mandatory
cross-functional review checkpoint. Configuring or replacing an AI provider
does not satisfy the gate and must not enable those capabilities.

## KBV BMP 2.8 carrier import (Phase 6)

The backend import accepts decoded carrier XML only. It does not resolve a PZN,
call a product database, or infer a Wirkstoff.
The supported carrier profile is the official KBV BMP 2.8 root
`MP.v = 028`, `MP.l = de-DE`, based on the [KBV BMP Anlage 3
specification](https://update.kbv.de/ita-update/Verordnungen/Arzneimittel/BMP/EXT_ITA_VGEX_BMP_Anlage3.pdf).
The existing PDF/DataMatrix renderer remains explicitly legacy BMP 2.2 until
all v2.8 output semantics can be represented.

The parser is deliberately bounded and rejects declarations, DTDs, processing
instructions, CDATA, entity references, excessive input/nodes, unsupported
versions/locales, malformed sequence/attributes, and incomplete multi-page
plans. Unknown elements and attributes appear as blocking bilingual warnings;
they are never dropped silently. The initial slice maps only lossless section
categories: unheaded/412 to `dauer`, 411/423 to `besondere`, and 418 to
`selbst`.

Current medication storage requires one explicit non-empty Wirkstoff per row.
Therefore PZN/Handelsname-only rows and multi-Wirkstoff rows are not importable.
Coded form/unit values, BMP free-text dosing, weekly dosing, and other section
entries are also blocked until exact reference data or lossless fields exist.
Handelsname is never copied into Wirkstoff.

Preview compares normalized given name, family name, and the complete birth
date against the selected patient. Partial BMP dates and every mismatch hard
block this conservative CRM import. Confirmation requires an unchanged server
fingerprint and explicit staff acknowledgement, supersedes current medication
rows, and inserts all validated carrier rows atomically. The immutable audit
record stores a checksum plus the bounded normalized snapshot, not raw XML.
Idempotent replay does not repeat clinical, audit, or realtime events.

## Android BMP Data Matrix scanning (Phase 7)

The Android Capacitor app has a bounded native preprocessing step for printed
BMP carriers. CameraX sends in-memory frames directly to the bundled ML Kit
barcode model configured for `FORMAT_DATA_MATRIX` only. The app does not create
an image file, upload a camera frame, retain a thumbnail, or use a dynamically
downloaded scanner model. The scanner activity also carries `FLAG_SECURE`, like
the main staff activity.

Raw barcode bytes are preferred and decoded as ISO-8859-1, matching the KBV
carrier specification. The ML Kit string value is only a compatibility fallback.
The native bridge returns at most 128 KiB of XML-like BMP carrier text and no
image data. Browser and iOS clients keep the decoded-XML upload/paste path; the
camera action is exposed only in the native Android runtime.

A successful scan immediately requests the existing server preview. It never
confirms or applies medications from the camera result. Exact patient matching,
unsupported-structure blocks, the stale fingerprint check, staff acknowledgement,
atomic replacement, immutable import snapshot, idempotency, audit and realtime
rules remain server-authoritative. A physical-device matrix must still verify
focus, centre-point detection and low-light behavior before production rollout.

## G-BA AIS complete-delivery ingestion (Phase 8)

The second live-source connector is the G-BA `G-BA_Beschluss_Info` complete XML
delivery. G-BA publishes an updated complete delivery on the 1st and 15th of
each month and provides a separately requested permanent URL for automated
downloads. GMED never automates the request/consent form and never stores or
returns the issued permanent URL. An operator supplies it only through the
`GMED_GBA_AIS_DOWNLOAD_URL` deployment secret; without that secret the
connector remains `planned` and no network job is started.

The worker accepts only HTTPS URLs on `ais.g-ba.de`, does not follow redirects,
and applies connection, request, payload, XML-node and nesting limits. DTDs,
processing instructions, CDATA, custom entity references, comments, unknown
elements and unknown attributes fail the complete delivery instead of being
ignored. Only XML's predefined and valid numeric character references are
resolved.
The generated timestamp is the source version. The raw, bounded XML is retained
internally with its SHA-256 checksum, while a normalized immutable index stores
one row per G-BA patient group with the stable decision and group identifiers,
official G-BA URL, assessed substances, ATC/ASK/PZN evidence, decision validity,
indication and the published benefit assessment.

The permanent download URL is not provenance. Public and staff-facing status
continues to link to the ordinary G-BA AIS information page. The patient request
path reads only local snapshots and performs no G-BA request. Phase 8 does not
turn a benefit assessment into a treatment recommendation: patient-specific
retrieval and medical review remain separate, explicitly gated steps.

## Exact G-BA evidence retrieval (Phase 9)

`GET /medication-intelligence/evidence/benefit-assessments`

The CEO-only endpoint reads one already persisted G-BA snapshot and accepts
`pzn`, `atc` and `ask` query parameters. It selects exactly one identifier with
the precedence PZN, then ATC, then ASK. Fallback happens only when the stronger
identifier is absent. A present but malformed PZN/ATC/ASK is rejected, and a
valid PZN with no result is never broadened to a supplied ATC or ASK value.

Matching is exact array membership only. PZN must be eight ASCII digits, ATC
must match `A00AA00`, and ASK must be five ASCII digits, following the official
AIS XSD. The ingestion parser and database constraints enforce the same
formats. Substrings, trade-name matching, fuzzy matching and model inference
are not part of this layer.

The response distinguishes `source_unavailable`, `no_exact_match` and
`exact_match`, returns bounded pagination and complete source/snapshot
provenance, and exposes only normalized immutable evidence rows. It deliberately
does not determine whether a patient belongs to a G-BA patient group, whether
the source indication applies, or which treatment should be selected. Audit
context records the identifier type and pagination only, not the queried value.

## Privacy-minimised Medication Evidence AI draft (Phase 10)

The optional AI workflow is a separate, asynchronous draft attached to one
immutable Medication Evidence Review. It never replaces or mutates the local
evidence bundle, a patient medication, a diagnosis, a task, or a clinical
decision. The server exposes the provider state as `not_configured`, `disabled`,
`blocked`, or `ready`; the UI offers the AI action only in `ready` state.

External calls are fail-closed behind all of these server-side requirements:

- `GMED_MEDICATION_AI_ENABLED=true`;
- `GMED_MEDICATION_AI_DATA_TRANSFER_APPROVED=true` after an environment-specific
  data-protection/vendor review;
- a server-only `GMED_OPENAI_API_KEY`;
- an explicitly approved `GMED_OPENAI_MODEL` identifier.

The adapter uses the fixed OpenAI Responses API HTTPS endpoint, rejects
redirects, applies connection/request/input/output limits, sends `store=false`,
enables no tools, and requests a strict JSON-schema response. Neither the client
nor stored patient data can select a provider endpoint, model, system prompt, or
tool. The API key never reaches the browser, database, audit payload, or log.

The outbound payload is constructed from the frozen bundle and excludes patient
ID, medication row ID, name, date of birth, contacts, source URLs, raw documents,
free-form patient notes, diagnoses and demographic fields. It contains only
bounded finding category/severity codes, missing-data codes, normalized
official-source authority/health metadata, exact G-BA assessment fields and a
closed list of request-local citation aliases such as `evidence:0001`. Finding
titles, missing-data explanations and local source IDs are intentionally
removed before transfer because future source content could contain a product
or locally meaningful label. Local citation IDs and `evidence_refs` are never
sent because they can embed medication-row or snapshot UUIDs. The server maps
an accepted alias back to its immutable local citation after the response and
rejects every unknown alias.
The vendor's contractual retention, regional processing and zero-data-retention
options still require separate approval; `store=false` is an API control, not a
substitute for that review.

The model may return only bilingual evidence-summary items, verification
questions and limitations. Factual items must cite references from the frozen
bundle. The backend rejects unknown citations, URLs, control characters,
oversized output, refusals/incomplete or ambiguous multi-text responses,
non-bilingual items, provider identifiers that are unsafe for storage, explicit
treatment/stopping/dose-change directions and any newly generated numeric dose
amount. Accepted output is stored separately with its model,
provider response ID, SHA-256 fingerprint, immutable prompt-contract version,
state-transition history and audit event. It remains visibly marked as
AI-generated and read-only.

Jobs use bounded leases, `FOR UPDATE SKIP LOCKED`, three attempts for transient
transport/rate/server errors, crash recovery and a manual retry from `failed`.
Permanent provider/schema/safety failures are not retried automatically. The
local evidence package remains available when AI is disabled or fails.

Operators can inspect a PHI-free AI section in **System Health**. It exposes the
provider/call gate state, configured model identifier, aggregate queue counts,
expired leases, the oldest runnable request and the last success/failure times.
It never exposes API keys, patient or review identifiers, prompts, response IDs
or generated content. During a rolling deployment, a backend without the new
health field is normalized to `not_configured` instead of breaking the page.

Prometheus receives only bounded lifecycle labels through
`gmed_medication_ai_jobs_total{outcome,reason}` and provider-attempt latency
through `gmed_medication_ai_provider_duration_seconds{outcome}`. PROD rules
alert on a terminal AI job failure and on a retry burst. Alerts deliberately
contain no patient identifiers or content; the deterministic package stays
available during every AI incident.

When a job becomes `ready` or reaches terminal `failed`, its requesting
operator receives a generic in-app notification and realtime bell update linked
to the patient's clinical workspace. The stored notification keeps a bilingual
fallback for non-browser clients, while the web UI renders a single RU or DE
copy according to the active interface language. Notification text contains no
patient name, medication, diagnosis, generated text or provider response ID.

No current role can medically approve an AI draft. Production enablement
requires, at minimum, documented vendor/GDPR approval, an approved model ID,
DEV validation with synthetic data, output-safety regression tests, monitoring,
an operator rollback procedure, tested alert delivery, and the intended-purpose/MDR gate described
above. Enablement is a configuration/restart operation; rollback is setting
`GMED_MEDICATION_AI_ENABLED=false` and restarting the backend. Existing local
evidence bundles remain usable.

## Next implementation slices

1. Obtain the organisation-specific permanent G-BA AIS download URL, configure
   it in DEV through the secret store, and verify the first complete snapshot.
2. Review and activate an official BfArM shortage export only after its current
   machine-readable contract and reuse terms are documented.
3. Keep EMA PMS lookup disabled in production until its terms permit the
   intended business use and the organisation records source-owner approval.
4. Extend the BMP carrier import only after adding lossless weekly/free-text
   dosing fields and an approved current code/PZN reference source; complete
   physical Android scanner QA before production rollout.
5. Complete intended-purpose/MDR review before patient-specific therapeutic
   decision support.
