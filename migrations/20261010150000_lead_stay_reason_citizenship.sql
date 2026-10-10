-- Block F "stay reason" (QA 2026-10-10): a person who lives in the country as
-- its citizen or was born there had no fitting answer and had to describe
-- "other". The new value `citizenship_or_birth` ("Staatsangehörigkeit / dort
-- geboren") joins the allowed reasons.
ALTER TABLE lead_gwg_declarations
    DROP CONSTRAINT IF EXISTS lead_gwg_declarations_stay_reason_check;
ALTER TABLE lead_gwg_declarations
    ADD CONSTRAINT lead_gwg_declarations_stay_reason_check CHECK (
        stay_reason IS NULL
        OR stay_reason IN ('citizenship_or_birth', 'work', 'study', 'family', 'other')
    );
