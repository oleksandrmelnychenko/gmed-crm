-- Build the patient consent register from the legal evidence already captured
-- during lead intake. The source document/contract remains the audit evidence.
WITH consent_evidence AS (
    SELECT d.patient_id,
           CASE d.compliance_kind
             WHEN 'dsgvo' THEN 'dsgvo_data_transfer'
             WHEN 'confidentiality_release' THEN 'schweigepflicht_release'
             WHEN 'framework_contract' THEN 'treatment_contract'
           END AS consent_type,
           COALESCE(d.signed_by, d.uploaded_by) AS managed_by,
           d.signed_at AS granted_at,
           d.signed_at + INTERVAL '1 year' AS expires_at,
           jsonb_build_object(
             'source', 'document_signature_backfill',
             'source_document_id', d.id,
             'compliance_kind', d.compliance_kind
           ) AS context,
           d.id AS source_id
    FROM documents d
    WHERE d.patient_id IS NOT NULL
      AND d.signed_at IS NOT NULL
      AND d.file_deleted_at IS NULL
      AND d.compliance_kind IN ('dsgvo', 'confidentiality_release', 'framework_contract')

    UNION ALL

    SELECT fc.patient_id,
           'treatment_contract',
           fc.created_by,
           fc.signed_at,
           COALESCE(
             fc.valid_to::timestamp AT TIME ZONE 'UTC',
             fc.signed_at + INTERVAL '1 year'
           ),
           jsonb_build_object(
             'source', 'framework_contract_backfill',
             'source_contract_id', fc.id,
             'contract_number', fc.contract_number
           ),
           fc.id
    FROM framework_contracts fc
    WHERE fc.patient_id IS NOT NULL
      AND fc.status = 'signed'
      AND fc.signed_at IS NOT NULL

    UNION ALL

    SELECT patient.id,
           channel.consent_type,
           patient.created_by,
           COALESCE(lead.submitted_at, lead.created_at, patient.created_at),
           COALESCE(lead.submitted_at, lead.created_at, patient.created_at) + INTERVAL '1 year',
           jsonb_build_object(
             'source', 'lead_contact_consent_backfill',
             'source_lead_id', lead.id,
             'channel', channel.channel
           ),
           lead.id
    FROM patients patient
    JOIN leads lead ON lead.id = patient.source_lead_id
    CROSS JOIN LATERAL (
      VALUES
        ('document_share_email'::text, 'email'::text, COALESCE(lead.email_consent, false)),
        ('document_share_whatsapp'::text, 'whatsapp'::text, COALESCE(lead.whatsapp_consent, false))
    ) AS channel(consent_type, channel, granted)
    WHERE channel.granted
), latest_evidence AS (
    SELECT DISTINCT ON (patient_id, consent_type)
           patient_id, consent_type, managed_by, granted_at, expires_at, context
    FROM consent_evidence
    WHERE patient_id IS NOT NULL
      AND consent_type IS NOT NULL
      AND managed_by IS NOT NULL
      AND granted_at IS NOT NULL
    ORDER BY patient_id, consent_type, granted_at DESC, source_id DESC
)
INSERT INTO consent_records (
    patient_id, user_id, consent_type, granted, granted_at, expires_at, context
)
SELECT evidence.patient_id,
       evidence.managed_by,
       evidence.consent_type,
       true,
       evidence.granted_at,
       evidence.expires_at,
       evidence.context
FROM latest_evidence evidence
WHERE NOT EXISTS (
    SELECT 1
    FROM consent_records existing
    WHERE existing.patient_id = evidence.patient_id
      AND existing.consent_type = evidence.consent_type
      AND existing.granted = true
      AND existing.revoked_at IS NULL
      AND (existing.expires_at IS NULL OR existing.expires_at > now())
);
