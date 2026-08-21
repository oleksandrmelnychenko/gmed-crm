CREATE TABLE concierge_service_partner_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    concierge_service_id UUID NOT NULL REFERENCES concierge_services(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES providers(id),
    channel TEXT NOT NULL CHECK (
        channel IN ('phone', 'email', 'messaging', 'in_person', 'other')
    ),
    direction TEXT NOT NULL CHECK (
        direction IN ('outbound', 'inbound')
    ),
    outcome TEXT NOT NULL CHECK (
        outcome IN (
            'no_answer',
            'reached',
            'quote_requested',
            'quote_received',
            'follow_up_needed',
            'booking_confirmed',
            'declined',
            'cancelled'
        )
    ),
    occurred_at TIMESTAMPTZ NOT NULL,
    contact_person TEXT CHECK (
        contact_person IS NULL OR char_length(contact_person) <= 160
    ),
    note TEXT CHECK (note IS NULL OR char_length(note) <= 2000),
    quoted_cost NUMERIC(12, 2) CHECK (quoted_cost IS NULL OR quoted_cost >= 0),
    quoted_currency TEXT CHECK (
        quoted_currency IS NULL OR quoted_currency ~ '^[A-Z]{3}$'
    ),
    recorded_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (quoted_cost IS NULL AND quoted_currency IS NULL)
        OR (quoted_cost IS NOT NULL AND quoted_currency IS NOT NULL)
    )
);

CREATE INDEX idx_concierge_partner_interactions_service_time
    ON concierge_service_partner_interactions(
        concierge_service_id,
        occurred_at DESC,
        created_at DESC
    );

CREATE INDEX idx_concierge_partner_interactions_provider
    ON concierge_service_partner_interactions(provider_id, occurred_at DESC);

CREATE TABLE concierge_service_cost_estimate_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    concierge_service_id UUID NOT NULL REFERENCES concierge_services(id) ON DELETE CASCADE,
    partner_interaction_id UUID NOT NULL UNIQUE
        REFERENCES concierge_service_partner_interactions(id) ON DELETE RESTRICT,
    amount_gross NUMERIC(12, 2) NOT NULL CHECK (amount_gross >= 0),
    currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    applied_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_concierge_cost_estimate_decisions_service
    ON concierge_service_cost_estimate_decisions(concierge_service_id, applied_at DESC);
