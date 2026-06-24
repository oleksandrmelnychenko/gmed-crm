ALTER TABLE ref_document_categories
    ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES ref_document_categories(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT 'type',
    ADD COLUMN IF NOT EXISTS short_code TEXT,
    ADD COLUMN IF NOT EXISTS access_category TEXT,
    ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ref_document_categories_level_check'
          AND conrelid = 'ref_document_categories'::regclass
    ) THEN
        ALTER TABLE ref_document_categories
            ADD CONSTRAINT ref_document_categories_level_check
            CHECK (level IN ('category', 'subcategory', 'type'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ref_document_categories_access_category_check'
          AND conrelid = 'ref_document_categories'::regclass
    ) THEN
        ALTER TABLE ref_document_categories
            ADD CONSTRAINT ref_document_categories_access_category_check
            CHECK (
                access_category IS NULL OR access_category IN (
                    'internal',
                    'patient',
                    'provider',
                    'authority',
                    'financial',
                    'medical',
                    'other'
                )
            );
    END IF;
END $$;

INSERT INTO ref_document_categories (
    id,
    parent_id,
    level,
    name_de,
    name_en,
    is_medical,
    description,
    portal_group,
    sort_order,
    patient_visible,
    short_code,
    access_category,
    aliases
) VALUES
    ('administrative', NULL, 'category', 'Administrativ', 'Administrative', false, 'Administrative documents, internal operational forms and generated agency paperwork.', 'administrative', 10, true, 'ADMIN', 'internal', ARRAY['admin']::TEXT[]),
    ('official', NULL, 'category', 'Amtlich / behördlich', 'Official / governmental / departmental', false, 'Official, governmental and departmental correspondence or documents.', 'administrative', 20, true, 'AMT', 'authority', ARRAY['governmental', 'departmental', 'behoerde', 'amtlich']::TEXT[]),
    ('finance', NULL, 'category', 'Finanziell', 'Financial', false, 'Invoices, cost coverage, estimates and payment-related documents.', 'finance', 30, true, 'FIN', 'financial', ARRAY['financial', 'rechnung', 'kosten']::TEXT[]),
    ('medical', NULL, 'category', 'Medizinisch', 'Medical', true, 'Medical documents grouped by specialty or clinical document type.', 'medical_report', 40, true, 'MED', 'medical', ARRAY['medizinisch']::TEXT[]),
    ('personal', NULL, 'category', 'Persönliche Dokumente', 'Personal documents', false, 'Passports, residence permits, birth certificates and other personal records.', 'administrative', 50, true, 'PERS', 'patient', ARRAY['identity', 'personal']::TEXT[]),
    ('translation', NULL, 'category', 'Übersetzung', 'Translation', false, 'Translated document versions and translation work products.', 'translation', 60, true, 'UEB', 'patient', ARRAY['uebersetzung', 'translated_document']::TEXT[]),
    ('other', NULL, 'category', 'Sonstige', 'Other', false, 'Documents that do not fit a more specific category yet.', 'other', 100, true, 'SONST', 'other', ARRAY['sonstige']::TEXT[]),

    ('clinic_correspondence', 'administrative', 'type', 'Klinikkorrespondenz', 'Clinic correspondence', false, 'Letters, confirmations and operational messages exchanged with clinics.', 'correspondence', 11, true, 'ADMIN', 'provider', ARRAY['correspondence']::TEXT[]),
    ('clinic_form', 'administrative', 'type', 'Klinikformular', 'Clinic form', false, 'Administrative forms received from or sent to clinics.', 'correspondence', 12, true, 'ADMIN', 'provider', ARRAY['form']::TEXT[]),
    ('contract', 'administrative', 'type', 'Vertrag', 'Contract', false, 'Contracts, framework agreements and agency service agreements.', 'administrative', 13, true, 'VERTRAG', 'internal', ARRAY['vertrag', 'framework_contract']::TEXT[]),
    ('administrative_single_order', 'administrative', 'type', 'Einzelauftrag', 'Single order', false, 'Single order / Auftrag documents generated from the agency templates.', 'administrative', 14, true, 'VERTRAG', 'internal', ARRAY['single_order', 'auftrag']::TEXT[]),
    ('administrative_appointment_confirmation', 'administrative', 'type', 'Terminbestätigung', 'Appointment confirmation', false, 'Appointment confirmation letters generated for authorities or patients.', 'correspondence', 15, true, 'ADMIN', 'patient', ARRAY['appointment_confirmation', 'terminbestaetigung']::TEXT[]),
    ('consent', 'administrative', 'type', 'Einwilligung', 'Consent', false, 'Consent, confidentiality and data release documents.', 'administrative', 16, true, 'ADMIN', 'patient', ARRAY['consent_form', 'gdpr_consent']::TEXT[]),
    ('generated', 'administrative', 'type', 'Generiert', 'Generated document', false, 'Legacy generated document category kept for compatibility.', 'administrative', 17, true, 'GEN', 'patient', ARRAY['generated']::TEXT[]),

    ('official_authority', 'official', 'type', 'Behörde / Amt', 'Authority / agency', false, 'Authority, police, border protection and municipal office correspondence.', 'administrative', 21, true, 'AMT', 'authority', ARRAY['authority', 'agency']::TEXT[]),
    ('official_departmental', 'official', 'type', 'Behördliche Abteilung', 'Departmental document', false, 'Departmental or institutional official documents.', 'administrative', 22, true, 'AMT', 'authority', ARRAY['departmental']::TEXT[]),
    ('visa_invitation_letter', 'official', 'type', 'Einladungsschreiben (Visum)', 'Visa invitation letter', false, 'Invitation letters for visa or border-control workflows.', 'administrative', 23, true, 'AMT', 'authority', ARRAY['visa_invitation', 'einladungsschreiben']::TEXT[]),

    ('finance_general', 'finance', 'type', 'Finanzdokument', 'Financial document', false, 'General financial records.', 'finance', 31, true, 'FIN', 'financial', ARRAY['financial']::TEXT[]),
    ('finance_cost_coverage', 'finance', 'type', 'Kostenübernahme', 'Cost coverage', false, 'Cost coverage declarations and approvals that can affect patient billing.', 'finance', 32, true, 'FIN', 'financial', ARRAY['cost_coverage_declaration', 'kostenuebernahme']::TEXT[]),
    ('finance_cost_estimate', 'finance', 'type', 'Kostenschätzung', 'Cost estimate', false, 'Cost estimate documents.', 'finance', 33, true, 'FIN', 'financial', ARRAY['cost_estimate', 'kostenschaetzung']::TEXT[]),
    ('invoice', 'finance', 'type', 'Rechnung', 'Invoice', false, 'Invoice documents.', 'finance', 34, true, 'FIN', 'financial', ARRAY['rechnung']::TEXT[]),
    ('finance_payment_proof', 'finance', 'type', 'Zahlungsnachweis', 'Payment proof', false, 'Payment proofs and receipts.', 'finance', 35, true, 'FIN', 'financial', ARRAY['payment_proof', 'receipt']::TEXT[]),
    ('insurance', 'finance', 'type', 'Versicherung', 'Insurance', false, 'Insurance documents and insurer correspondence.', 'finance', 36, true, 'VERS', 'financial', ARRAY['versicherung']::TEXT[]),

    ('medical_kardio', 'medical', 'subcategory', 'Kardiologie', 'Cardiology', true, 'Cardiology documents and reports.', 'medical_report', 41, true, 'KARDIO', 'medical', ARRAY['kardio', 'cardiology']::TEXT[]),
    ('medical_gastro', 'medical', 'subcategory', 'Gastroenterologie', 'Gastroenterology', true, 'Gastroenterology documents and reports.', 'medical_report', 42, true, 'GASTRO', 'medical', ARRAY['gastro']::TEXT[]),
    ('medical_uro', 'medical', 'subcategory', 'Urologie', 'Urology', true, 'Urology documents and reports.', 'medical_report', 43, true, 'URO', 'medical', ARRAY['uro']::TEXT[]),
    ('medical_lab', 'medical', 'subcategory', 'Labor', 'Laboratory', true, 'Laboratory findings and lab results.', 'lab_analysis', 44, true, 'LAB', 'medical', ARRAY['labor', 'lab']::TEXT[]),
    ('medical_patho_histo', 'medical', 'subcategory', 'Pathologie / Histologie', 'Pathology / histology', true, 'Pathology and histology reports.', 'lab_analysis', 45, true, 'PATHO-HISTO', 'medical', ARRAY['patho', 'histo']::TEXT[]),
    ('medical_radiology', 'medical', 'subcategory', 'Radiologie', 'Radiology', true, 'Radiology reports and imaging findings.', 'medical_report', 46, true, 'RAD', 'medical', ARRAY['radiology', 'radiologie']::TEXT[]),
    ('medical_arztbrief', 'medical', 'type', 'Arztbrief', 'Doctor letter', true, 'Arztbrief documents.', 'medical_report', 47, true, 'MED', 'medical', ARRAY['arztbrief']::TEXT[]),
    ('medical_befund', 'medical', 'type', 'Befund', 'Finding', true, 'Findings and diagnostic results.', 'medical_report', 48, true, 'MED', 'medical', ARRAY['befund']::TEXT[]),
    ('medical_bericht', 'medical', 'type', 'Bericht', 'Report', true, 'Medical reports.', 'medical_report', 49, true, 'MED', 'medical', ARRAY['bericht']::TEXT[]),
    ('medical_schreiben', 'medical', 'type', 'Schreiben', 'Letter', true, 'Medical correspondence letters.', 'medical_report', 50, true, 'MED', 'medical', ARRAY['schreiben']::TEXT[]),
    ('medical_ueberweisung', 'medical', 'type', 'Überweisung', 'Referral', true, 'Referral documents.', 'medical_report', 51, true, 'MED', 'medical', ARRAY['ueberweisung', 'referral']::TEXT[]),
    ('medical_radiology_report', 'medical_radiology', 'type', 'Radiologie-Bericht', 'Radiology report', true, 'General radiology report.', 'medical_report', 52, true, 'RAD', 'medical', ARRAY['radiologie_bericht']::TEXT[]),
    ('medical_sonography', 'medical_radiology', 'type', 'Sonographie', 'Sonography', true, 'Sonography / ultrasound report.', 'medical_report', 53, true, 'RAD', 'medical', ARRAY['sonographie', 'sono', 'ultrasound']::TEXT[]),
    ('medical_ct', 'medical_radiology', 'type', 'CT', 'CT', true, 'Computed tomography report.', 'medical_report', 54, true, 'RAD', 'medical', ARRAY['ct']::TEXT[]),
    ('medical_mrt', 'medical_radiology', 'type', 'MRT', 'MRI', true, 'Magnetic resonance imaging report.', 'medical_report', 55, true, 'RAD', 'medical', ARRAY['mrt', 'mri']::TEXT[]),
    ('medical_roentgen', 'medical_radiology', 'type', 'Röntgen', 'X-ray', true, 'X-ray report.', 'medical_report', 56, true, 'RAD', 'medical', ARRAY['roentgen', 'xray']::TEXT[]),
    ('medical_pet_ct', 'medical_radiology', 'type', 'PET-CT', 'PET-CT', true, 'PET-CT report.', 'medical_report', 57, true, 'RAD', 'medical', ARRAY['pet_ct']::TEXT[]),
    ('medical_entlassungsbrief', 'medical', 'type', 'Entlassungsbrief', 'Discharge letter', true, 'Discharge letters.', 'medical_report', 58, true, 'MED', 'medical', ARRAY['discharge_summary']::TEXT[]),
    ('medical_operationsbericht', 'medical', 'type', 'Operationsbericht', 'Operation report', true, 'Operation reports.', 'medical_report', 59, true, 'MED', 'medical', ARRAY['operationsbericht']::TEXT[]),
    ('treatment_plan', 'medical', 'type', 'Behandlungsplan', 'Treatment plan', true, 'Treatment plans and treatment recommendations.', 'medical_report', 60, true, 'MED', 'medical', ARRAY['treatment_plan', 'behandlungsplan', 'behandlungsempfehlung']::TEXT[]),
    ('medical_therapy_protocol', 'medical', 'type', 'Therapieprotokoll', 'Therapy protocol', true, 'Therapy protocols.', 'medical_report', 61, true, 'MED', 'medical', ARRAY['therapieprotokoll']::TEXT[]),
    ('medical_prescription', 'medical', 'type', 'Rezept', 'Prescription', true, 'Prescription documents.', 'medical_report', 62, true, 'MED', 'medical', ARRAY['rezept', 'prescription']::TEXT[]),
    ('medical_vaccination_record', 'medical', 'type', 'Impfpass', 'Vaccination record', true, 'Vaccination records.', 'medical_report', 63, true, 'MED', 'medical', ARRAY['impfpass']::TEXT[]),
    ('medical_lab_results', 'medical_lab', 'type', 'Laborergebnisse', 'Lab results', true, 'Laboratory results.', 'lab_analysis', 64, true, 'LAB', 'medical', ARRAY['laborergebnisse', 'lab_results']::TEXT[]),
    ('medication_summary', 'medical', 'type', 'Medikationsplan', 'Medication summary', true, 'Medication plans and medication summaries.', 'medical_report', 65, true, 'MED', 'medical', ARRAY['medikationsplan', 'medikamentenuebersicht', 'medication_summary']::TEXT[]),

    ('identity', 'personal', 'type', 'Identität', 'Identity', false, 'General identity records.', 'administrative', 70, true, 'PERS', 'patient', ARRAY['identity']::TEXT[]),
    ('personal_passport', 'personal', 'type', 'Reisepass', 'Passport', false, 'Passport copies or passport scans.', 'administrative', 71, true, 'PERS', 'patient', ARRAY['passport', 'passport_scan']::TEXT[]),
    ('personal_residence_permit', 'personal', 'type', 'Aufenthaltstitel', 'Residence permit', false, 'Residence permit documents.', 'administrative', 72, true, 'PERS', 'patient', ARRAY['residence_permit']::TEXT[]),
    ('personal_birth_certificate', 'personal', 'type', 'Geburtsurkunde', 'Birth certificate', false, 'Birth certificates.', 'administrative', 73, true, 'PERS', 'patient', ARRAY['birth_certificate']::TEXT[]),
    ('portal_upload', 'other', 'type', 'Portal-Upload', 'Portal upload', false, 'Documents uploaded from the patient portal.', 'other', 90, true, 'SONST', 'patient', ARRAY['portal_upload']::TEXT[])
ON CONFLICT (id) DO UPDATE SET
    parent_id = EXCLUDED.parent_id,
    level = EXCLUDED.level,
    name_de = EXCLUDED.name_de,
    name_en = EXCLUDED.name_en,
    is_medical = EXCLUDED.is_medical,
    description = EXCLUDED.description,
    portal_group = EXCLUDED.portal_group,
    sort_order = EXCLUDED.sort_order,
    patient_visible = EXCLUDED.patient_visible,
    short_code = EXCLUDED.short_code,
    access_category = EXCLUDED.access_category,
    aliases = EXCLUDED.aliases;

CREATE INDEX IF NOT EXISTS idx_ref_document_categories_parent
    ON ref_document_categories(parent_id, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_ref_document_categories_short_code
    ON ref_document_categories(short_code)
    WHERE short_code IS NOT NULL;
