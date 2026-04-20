-- Strip English demo-only copy from seeded patient rows so the UI shows
-- proper i18n placeholders. notes/clinical_warnings are free-form patient
-- data — they cannot be translated at runtime, so hard-coded English
-- seed copy leaks into every locale. Clearing the fields is the right fix.

UPDATE patients
SET notes = NULL
WHERE notes IN (
    'Oncology second-opinion patient with translated pathology documents and concierge expectations at premium level.',
    'Pulmonology second-opinion patient used to show specialty history, document pipeline and risks without heavy billing.',
    'Arrives with consolidated labs from Lagos and needs endocrinology plus preventive screening in Berlin.',
    'Portal-active patient. Tracking hematology workup, nutrition plan and insurer communication in one case file.',
    'Sports injury case that needs imaging-first discovery and a clear conservative-vs-surgical recommendation.',
    'Needs fast cardiac triage after exertional chest pain during winter training block.',
    'Travel-clearance intake used in demo for non-medical coordination and pre-arrival document review.',
    'GI case with reflux and abdominal pain used to exercise specialty subflows beyond pure orthopedics/cardiology.',
    'Complex spine patient with active interpreter, concierge and rehab follow-up needs. Core demo patient for execution phase.',
    'Post-stent follow-up patient used for recurring appointments, risk scoring and medication adherence data.',
    'Dermatology appointment kept in demo to show patients without active commercial order.',
    'Urology case used to populate specialty assessment coverage and appointment-request flows.',
    'Executive screening patient used to demonstrate portal invoices, patient-visible summaries and VIP labeling.',
    'Discovery-stage orthopedic surgery candidate with quote and provider-shortlist activity but no final booking yet.',
    'Berlin-based follow-up patient used for portal appointment requests and document readiness alerts.'
);

UPDATE patients
SET clinical_warnings = NULL
WHERE clinical_warnings IN (
    'Flag need for Arabic-first communication when releasing documents.',
    'History of smoking should stay visible to clinicians.',
    'Flag outside contrast allergy before imaging booking.',
    'Monitor exertional symptoms and family cardiac history.',
    'Needs wheelchair-friendly transfer and careful pain-control review after MRI.',
    'Keep anticoagulation and blood-pressure trend visible on dashboard.'
);
