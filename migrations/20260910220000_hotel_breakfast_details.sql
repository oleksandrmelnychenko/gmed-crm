-- Breakfast is reporting metadata, not an accounting posting or an addition to stay price.
ALTER TABLE hotel_stay_statistics_details
    ADD COLUMN breakfast_mode TEXT NOT NULL DEFAULT 'unknown'
        CHECK (breakfast_mode IN ('unknown', 'included', 'hotel_extra', 'self', 'none')),
    ADD COLUMN breakfast_count INTEGER CHECK (breakfast_count BETWEEN 1 AND 100000),
    ADD COLUMN breakfast_total NUMERIC(12,2) CHECK (breakfast_total >= 0),
    ADD COLUMN breakfast_currency TEXT CHECK (breakfast_currency ~ '^[A-Z]{3}$'),
    ADD COLUMN breakfast_payer TEXT NOT NULL DEFAULT 'unknown'
        CHECK (breakfast_payer IN ('unknown', 'patient', 'company', 'split')),
    ADD COLUMN breakfast_notes TEXT CHECK (char_length(breakfast_notes) <= 2000),
    ADD CONSTRAINT hotel_breakfast_amount_currency CHECK
        ((breakfast_total IS NULL) = (breakfast_currency IS NULL)),
    ADD CONSTRAINT hotel_breakfast_included_no_extra_cost CHECK
        (breakfast_mode IN ('hotel_extra', 'self') OR (breakfast_total IS NULL AND breakfast_payer = 'unknown')),
    ADD CONSTRAINT hotel_breakfast_no_implied_meals CHECK
        (breakfast_mode NOT IN ('unknown', 'none') OR breakfast_count IS NULL);
