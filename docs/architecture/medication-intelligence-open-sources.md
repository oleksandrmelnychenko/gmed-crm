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

The import accepts already decoded carrier XML only. It does not decode a
DataMatrix image, resolve a PZN, call a product database, or infer a Wirkstoff.
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

## Next implementation slices

1. Ship the read-only patient preflight endpoint and profile panel.
2. Add versioned source snapshots and job status without remote calls in the
   patient request path.
3. Import G-BA AIS XML and BfArM safety/shortage feeds.
4. Add the local-curated, versioned identity-candidate and staff-confirmation
   workflow. Keep EMA PMS lookup disabled in production until its terms permit
   the intended business use and the organisation records source-owner approval.
5. Extend the BMP carrier import only after adding lossless weekly/free-text
   dosing fields and an approved current code/PZN reference source; add image
   decoding as a separate bounded preprocessing slice.
6. Complete intended-purpose/MDR review before patient-specific therapeutic
   decision support.
