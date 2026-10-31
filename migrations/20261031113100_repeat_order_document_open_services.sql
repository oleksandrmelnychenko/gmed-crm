-- QA 2026-10-31: generated documents of a repeat order list the services the
-- order still has and total them like the order.
--
-- The context selected every order service, so a regenerated document printed
-- cancelled services and counted them, and because the status was not part of
-- the context a plain cancellation left it unchanged: generating again returned
-- the old PDF as `reused`.
--
-- A pass-through cost carries no VAT, whatever rate its line holds
-- (`order_service_total_gross`, quotes, invoices), but the context had no flag
-- for it. Only such a line gets the flag, so the context of an order without
-- cancelled or pass-through services stays what it was and its documents stay
-- current (hence still `repeat-order-v2`).
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
            || CASE WHEN s.is_cost_passthrough THEN jsonb_build_object('is_cost_passthrough',true) ELSE '{}'::jsonb END
            ORDER BY s.id) FROM order_leistungen s WHERE s.order_id=o.id AND s.status <> 'cancelled'),'[]'::jsonb))
    FROM orders o JOIN leads l ON l.id=o.source_lead_id
    JOIN patients p ON p.id=COALESCE(l.repeat_patient_id,l.prospect_patient_id)
    WHERE o.id=target AND p.lifecycle_status IN ('active','inactive')
$$ LANGUAGE sql STABLE;
