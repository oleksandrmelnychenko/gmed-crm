-- Resolve repeat-order document placeholders from the current specialization catalog.
-- Raw specialty codes remain in the context; human-readable German labels are an
-- explicit rendering input so a catalog rename correctly requires a new PDF version.
CREATE OR REPLACE FUNCTION repeat_order_document_context(target UUID) RETURNS JSONB AS $$
    SELECT jsonb_build_object('kind','repeat-order-v2','order_id',o.id,
        'date_from',o.date_from,'date_to',o.date_to,'contract_id',o.contract_id,
        'needs_description',o.needs_description,'currency',o.currency,
        'total_estimated',o.total_estimated,'prepayment_required',o.prepayment_required,
        'prepayment_amount',o.prepayment_amount,'prepayment_due_at',o.prepayment_due_at,
        'specialties',l.requested_specialties,
        'specialty_names',COALESCE((
            SELECT jsonb_agg(COALESCE(s.name_de, selected.value) ORDER BY selected.ordinality)
            FROM jsonb_array_elements_text(COALESCE(l.requested_specialties, '[]'::jsonb))
                WITH ORDINALITY AS selected(value, ordinality)
            LEFT JOIN medical_specializations s
                ON s.code = selected.value AND s.deleted_at IS NULL
        ), '[]'::jsonb),
        'contract_effective_date',l.wizard_state->'contract_effective_date',
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
