-- Exact G-BA evidence retrieval relies on the identifier formats defined by
-- the official AIS XSD. Keep the immutable evidence index strict so a lookup
-- can never silently compare malformed PZN/ATC/ASK values.

ALTER TABLE medication_intelligence_benefit_assessment_items
    ADD CONSTRAINT medication_intelligence_benefit_items_atc_format_check CHECK (
        array_position(atc_codes, NULL) IS NULL
        AND (
            cardinality(atc_codes) = 0
            OR array_to_string(atc_codes, ',')
                ~ '^([A-Z][0-9]{2}[A-Z]{2}[0-9]{2})(,[A-Z][0-9]{2}[A-Z]{2}[0-9]{2})*$'
        )
    ),
    ADD CONSTRAINT medication_intelligence_benefit_items_ask_format_check CHECK (
        array_position(ask_numbers, NULL) IS NULL
        AND (
            cardinality(ask_numbers) = 0
            OR array_to_string(ask_numbers, ',') ~ '^([0-9]{5})(,[0-9]{5})*$'
        )
    ),
    ADD CONSTRAINT medication_intelligence_benefit_items_pzn_format_check CHECK (
        array_position(pzns, NULL) IS NULL
        AND (
            cardinality(pzns) = 0
            OR array_to_string(pzns, ',') ~ '^([0-9]{8})(,[0-9]{8})*$'
        )
    );

CREATE INDEX idx_medication_intelligence_benefit_items_ask
    ON medication_intelligence_benefit_assessment_items USING GIN (ask_numbers);
