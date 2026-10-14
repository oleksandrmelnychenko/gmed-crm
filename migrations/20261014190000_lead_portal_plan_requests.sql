-- An expression of interest, never a subscription, order or payment instruction.
-- The staff task is committed in the same transaction as the portal receipt.
CREATE TABLE lead_portal_plan_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES users(id),
    package_id UUID NOT NULL REFERENCES service_packages(id),
    package_name TEXT NOT NULL,
    subscription_kind TEXT NOT NULL CHECK (subscription_kind IN ('gmed_one', 'gmed_reserve', 'treatment')),
    module_id TEXT NOT NULL CHECK (module_id IN (
        'dashboard', 'notifications', 'chat', 'appointments', 'recommendations',
        'documents', 'services', 'subscriptions', 'invoices', 'feedback', 'privacy'
    )),
    task_id UUID NOT NULL UNIQUE REFERENCES tasks(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'closed')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX lead_portal_plan_requests_pending
    ON lead_portal_plan_requests (lead_id, requested_by, package_id, module_id)
    WHERE status = 'pending';
