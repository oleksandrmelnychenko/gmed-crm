ALTER TABLE concierge_services
    ADD COLUMN service_address TEXT;

ALTER TABLE concierge_services
    ADD CONSTRAINT concierge_services_service_address_length_check
        CHECK (service_address IS NULL OR char_length(service_address) <= 500);

ALTER TABLE concierge_service_partner_interactions
    DROP CONSTRAINT concierge_service_partner_interactions_outcome_check;

ALTER TABLE concierge_service_partner_interactions
    ADD CONSTRAINT concierge_service_partner_interactions_outcome_check
        CHECK (
            outcome IN (
                'no_answer',
                'reached',
                'quote_requested',
                'quote_received',
                'follow_up_needed',
                'booking_requested',
                'booking_confirmed',
                'declined',
                'cancelled'
            )
        );

ALTER TABLE concierge_service_partner_interactions
    ADD COLUMN request_id UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE concierge_service_partner_interactions
    ADD CONSTRAINT concierge_service_partner_interactions_request_unique
        UNIQUE (concierge_service_id, request_id);
