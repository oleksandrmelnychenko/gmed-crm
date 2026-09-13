-- Durable first-save identity and explicit repeat-patient context.
ALTER TABLE leads ADD COLUMN creation_key UUID;
ALTER TABLE leads ADD COLUMN repeat_patient_id UUID REFERENCES patients(id);
CREATE UNIQUE INDEX lead_creation_key ON leads(created_by, creation_key) WHERE creation_key IS NOT NULL;
CREATE INDEX lead_repeat_patient ON leads(repeat_patient_id) WHERE converted_patient_id IS NULL;
UPDATE leads l SET repeat_patient_id=p.id FROM patients p
WHERE l.prospect_patient_id=p.id AND p.lifecycle_status IN ('active','inactive')
  AND l.converted_patient_id IS NULL;

-- Clinical edits use a consistent snapshot revision and a transactional replay key.
ALTER TABLE patients ADD COLUMN clinical_revision BIGINT NOT NULL DEFAULT 0;
CREATE TABLE patient_clinical_operations (
    patient_id UUID NOT NULL REFERENCES patients(id),
    operation_id UUID NOT NULL,
    actor_id UUID NOT NULL REFERENCES users(id),
    section TEXT NOT NULL,
    expected_revision BIGINT NOT NULL,
    payload_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(patient_id, operation_id)
);
CREATE FUNCTION bump_patient_clinical_revision() RETURNS trigger AS $$
BEGIN
    UPDATE patients SET clinical_revision=clinical_revision+1 WHERE id=COALESCE(NEW.patient_id,OLD.patient_id);
    RETURN COALESCE(NEW,OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER diagnosis_revision AFTER INSERT OR UPDATE OR DELETE ON patient_diagnoses
FOR EACH ROW EXECUTE FUNCTION bump_patient_clinical_revision();
CREATE TRIGGER medication_revision AFTER INSERT OR UPDATE OR DELETE ON patient_medications
FOR EACH ROW EXECUTE FUNCTION bump_patient_clinical_revision();
CREATE TRIGGER warning_revision AFTER INSERT OR UPDATE OR DELETE ON patient_clinical_warnings
FOR EACH ROW EXECUTE FUNCTION bump_patient_clinical_revision();
CREATE TRIGGER narrative_revision AFTER INSERT OR UPDATE OR DELETE ON patient_clinical_narrative
FOR EACH ROW EXECUTE FUNCTION bump_patient_clinical_revision();

-- Recover only unfinished pre-release repeats without operational or financial history.
UPDATE orders o SET patient_id=l.repeat_patient_id, intake_state='draft',
    status=CASE WHEN l.failed_outcome_status='none' THEN o.status ELSE 'cancelled' END
FROM leads l WHERE o.source_lead_id=l.id AND l.repeat_patient_id IS NOT NULL
  AND l.converted_patient_id IS NULL AND o.phase='discovery' AND o.status IN ('active','cancelled')
  AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.order_id=o.id)
  AND NOT EXISTS(SELECT 1 FROM appointments a WHERE a.order_id=o.id)
  AND NOT EXISTS(SELECT 1 FROM external_invoices e WHERE e.order_id=o.id)
  AND order_recorded_cash_paid(o.id)=0;

CREATE FUNCTION archive_repeat_intake_orders() RETURNS trigger AS $$
BEGIN
    IF NEW.failed_outcome_status IN ('archived','delete_anonymized') AND OLD.failed_outcome_status='none'
       AND COALESCE(NEW.repeat_patient_id,OLD.repeat_patient_id) IS NOT NULL THEN
        UPDATE orders SET status='cancelled' WHERE source_lead_id=NEW.id AND intake_state='draft';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER repeat_intake_archive AFTER UPDATE OF failed_outcome_status ON leads
FOR EACH ROW EXECUTE FUNCTION archive_repeat_intake_orders();

-- Current facts used by generated repeat-order documents; signatures retain the original context.
CREATE FUNCTION repeat_order_document_context(target UUID) RETURNS JSONB AS $$
    SELECT jsonb_build_object('kind','repeat-order-v1','order_id',o.id,
        'date_from',o.date_from,'date_to',o.date_to,'contract_id',o.contract_id,
        'needs_description',o.needs_description,'currency',o.currency,
        'total_estimated',o.total_estimated,'prepayment_required',o.prepayment_required,
        'prepayment_amount',o.prepayment_amount,'prepayment_due_at',o.prepayment_due_at,
        'specialties',l.requested_specialties,'contract_effective_date',l.wizard_state->'contract_effective_date',
        'cost_threshold',l.wizard_state->'cost_threshold',
        'patient',jsonb_build_object('id',p.id,'first_name',p.first_name,'last_name',p.last_name,
            'birth_date',p.birth_date,'address_street',p.address_street,'address_city',p.address_city,
            'address_zip',p.address_zip,'address_country',p.address_country,
            'insurance_provider',p.insurance_provider,'insurance_number',p.insurance_number),
        'lead',jsonb_build_object('first_name',l.first_name,'last_name',l.last_name,'date_of_birth',l.date_of_birth,
            'street_address',l.street_address,'city',l.city,'zip_code',l.zip_code,'country',l.country,
            'insurance_provider',l.insurance_provider,'insurance_number',l.insurance_number),
        'services',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'description',s.description,
            'quantity',s.quantity::text,'unit_price',s.unit_price_snapshot::text,'vat_rate',s.vat_rate_snapshot::text,
            'agency_service_id',s.agency_service_id,'unit_label',s.agency_service_unit_label_snapshot,
            'note',s.agency_service_description_snapshot,'description_items',s.agency_service_description_items_snapshot)
            ORDER BY s.id) FROM order_leistungen s WHERE s.order_id=o.id),'[]'::jsonb))
    FROM orders o JOIN leads l ON l.id=o.source_lead_id
    JOIN patients p ON p.id=COALESCE(l.repeat_patient_id,l.prospect_patient_id)
    WHERE o.id=target AND p.lifecycle_status IN ('active','inactive')
$$ LANGUAGE sql STABLE;

CREATE FUNCTION invalidate_repeat_order_signatures() RETURNS trigger AS $$
BEGIN
    IF NEW.intake_state='draft' AND EXISTS(SELECT 1 FROM leads l WHERE l.id=NEW.source_lead_id AND l.repeat_patient_id IS NOT NULL)
      AND ROW(NEW.date_from,NEW.date_to,NEW.contract_id,NEW.needs_description,NEW.total_estimated,NEW.prepayment_required,NEW.prepayment_amount,NEW.prepayment_due_at)
          IS DISTINCT FROM ROW(OLD.date_from,OLD.date_to,OLD.contract_id,OLD.needs_description,OLD.total_estimated,OLD.prepayment_required,OLD.prepayment_amount,OLD.prepayment_due_at) THEN
        NEW.signed_patient=false; NEW.signed_agency=false; NEW.signed_at=NULL;
        NEW.signed_patient_at=NULL; NEW.signed_agency_at=NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER repeat_order_signatures BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION invalidate_repeat_order_signatures();

-- Changing service content invalidates signatures even if the gross total is unchanged.
CREATE FUNCTION invalidate_repeat_service_signatures() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND
        ROW(NEW.description,NEW.quantity,NEW.unit_price_snapshot,NEW.vat_rate_snapshot,NEW.currency,
            NEW.agency_service_description_snapshot,NEW.agency_service_description_items_snapshot,NEW.agency_service_unit_label_snapshot)
        IS NOT DISTINCT FROM
        ROW(OLD.description,OLD.quantity,OLD.unit_price_snapshot,OLD.vat_rate_snapshot,OLD.currency,
            OLD.agency_service_description_snapshot,OLD.agency_service_description_items_snapshot,OLD.agency_service_unit_label_snapshot)
    THEN RETURN NEW; END IF;
    UPDATE orders o SET signed_patient=false,signed_agency=false,signed_at=NULL,
        signed_patient_at=NULL,signed_agency_at=NULL
    WHERE o.id=COALESCE(NEW.order_id,OLD.order_id) AND o.intake_state='draft'
      AND EXISTS(SELECT 1 FROM leads l WHERE l.id=o.source_lead_id AND l.repeat_patient_id IS NOT NULL);
    RETURN COALESCE(NEW,OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER repeat_service_signatures AFTER INSERT OR UPDATE OR DELETE ON order_leistungen
FOR EACH ROW EXECUTE FUNCTION invalidate_repeat_service_signatures();

CREATE FUNCTION invalidate_repeat_party_signatures() RETURNS trigger AS $$
DECLARE fields TEXT[]; before_facts JSONB; after_facts JSONB;
BEGIN
    fields := CASE WHEN TG_TABLE_NAME='leads' THEN
        ARRAY['first_name','last_name','date_of_birth','street_address','city','zip_code','country',
            'insurance_provider','insurance_number','requested_specialties']
        ELSE ARRAY['first_name','last_name','birth_date','address_street','address_city','address_zip',
            'address_country','insurance_provider','insurance_number'] END;
    SELECT jsonb_object_agg(key,value) INTO before_facts FROM jsonb_each(to_jsonb(OLD)) WHERE key=ANY(fields);
    SELECT jsonb_object_agg(key,value) INTO after_facts FROM jsonb_each(to_jsonb(NEW)) WHERE key=ANY(fields);
    IF before_facts IS DISTINCT FROM after_facts OR
        (TG_TABLE_NAME='leads' AND
          (to_jsonb(OLD)->'wizard_state'->'contract_effective_date',to_jsonb(OLD)->'wizard_state'->'cost_threshold') IS DISTINCT FROM
          (to_jsonb(NEW)->'wizard_state'->'contract_effective_date',to_jsonb(NEW)->'wizard_state'->'cost_threshold')) THEN
        UPDATE orders o SET signed_patient=false,signed_agency=false,signed_at=NULL,
            signed_patient_at=NULL,signed_agency_at=NULL
        WHERE o.intake_state='draft'
          AND CASE WHEN TG_TABLE_NAME='leads' THEN o.source_lead_id=NEW.id ELSE o.patient_id=NEW.id END
          AND EXISTS(SELECT 1 FROM leads l WHERE l.id=o.source_lead_id AND l.repeat_patient_id IS NOT NULL);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER repeat_lead_party_signatures AFTER UPDATE ON leads
FOR EACH ROW EXECUTE FUNCTION invalidate_repeat_party_signatures();
CREATE TRIGGER repeat_patient_party_signatures AFTER UPDATE ON patients
FOR EACH ROW EXECUTE FUNCTION invalidate_repeat_party_signatures();
