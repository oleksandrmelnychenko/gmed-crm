ALTER TABLE orders
    ADD COLUMN billing_release_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (billing_release_status IN ('pending', 'granted', 'denied')),
    ADD COLUMN billing_release_note TEXT,
    ADD COLUMN billing_released_by UUID REFERENCES users(id),
    ADD COLUMN billing_released_at TIMESTAMPTZ,
    ADD COLUMN package_coverage_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (package_coverage_status IN ('unknown', 'covered', 'not_covered')),
    ADD COLUMN package_coverage_note TEXT,
    ADD COLUMN package_coverage_decided_by UUID REFERENCES users(id),
    ADD COLUMN package_coverage_decided_at TIMESTAMPTZ;

CREATE INDEX idx_orders_billing_release_status
    ON orders(billing_release_status);

CREATE INDEX idx_orders_package_coverage_status
    ON orders(package_coverage_status);
