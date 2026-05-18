-- Remove legacy provider specialization aliases from the active directory.
-- Existing provider/doctor links are moved to the canonical DE/RU list first.

CREATE TEMP TABLE tmp_provider_legacy_primary_specializations (
    provider_id UUID NOT NULL,
    target_specialization_id UUID NOT NULL,
    priority INT NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE tmp_doctor_legacy_primary_specializations (
    doctor_id UUID NOT NULL,
    target_specialization_id UUID NOT NULL,
    priority INT NOT NULL
) ON COMMIT DROP;

WITH mapping(source_code, target_code, keep_primary, priority) AS (
    VALUES
        ('dermatologie', 'dermatologie_und_venerologie', TRUE, 10),
        ('innere_medizin_vorsorge', 'innere_medizin', TRUE, 10),
        ('onkologie', 'haematologie_und_onkologie', TRUE, 10),
        ('orthopaedie', 'orthopaedie_und_unfallchirurgie', TRUE, 10),
        ('orthopaedie_radiologie', 'orthopaedie_und_unfallchirurgie', TRUE, 10),
        ('orthopaedie_radiologie', 'radiologie', FALSE, 20)
)
INSERT INTO tmp_provider_legacy_primary_specializations (
    provider_id,
    target_specialization_id,
    priority
)
SELECT ps.provider_id, target.id, mapping.priority
FROM provider_specializations ps
JOIN medical_specializations source ON source.id = ps.specialization_id
JOIN mapping ON mapping.source_code = source.code
JOIN medical_specializations target ON target.code = mapping.target_code
WHERE ps.is_primary
  AND mapping.keep_primary;

WITH mapping(source_code, target_code, keep_primary, priority) AS (
    VALUES
        ('dermatologie', 'dermatologie_und_venerologie', TRUE, 10),
        ('innere_medizin_vorsorge', 'innere_medizin', TRUE, 10),
        ('onkologie', 'haematologie_und_onkologie', TRUE, 10),
        ('orthopaedie', 'orthopaedie_und_unfallchirurgie', TRUE, 10),
        ('orthopaedie_radiologie', 'orthopaedie_und_unfallchirurgie', TRUE, 10),
        ('orthopaedie_radiologie', 'radiologie', FALSE, 20)
)
INSERT INTO provider_specializations (provider_id, specialization_id, is_primary)
SELECT DISTINCT ps.provider_id, target.id, FALSE
FROM provider_specializations ps
JOIN medical_specializations source ON source.id = ps.specialization_id
JOIN mapping ON mapping.source_code = source.code
JOIN medical_specializations target ON target.code = mapping.target_code
ON CONFLICT (provider_id, specialization_id) DO NOTHING;

DELETE FROM provider_specializations ps
USING medical_specializations ms
WHERE ps.specialization_id = ms.id
  AND ms.code IN (
      'dermatologie',
      'innere_medizin_vorsorge',
      'onkologie',
      'orthopaedie',
      'orthopaedie_radiologie'
  );

WITH ranked AS (
    SELECT
        provider_id,
        target_specialization_id,
        row_number() OVER (
            PARTITION BY provider_id
            ORDER BY priority, target_specialization_id
        ) AS rn
    FROM tmp_provider_legacy_primary_specializations
)
UPDATE provider_specializations ps
SET is_primary = TRUE
FROM ranked
WHERE ranked.rn = 1
  AND ps.provider_id = ranked.provider_id
  AND ps.specialization_id = ranked.target_specialization_id
  AND NOT EXISTS (
      SELECT 1
      FROM provider_specializations existing
      WHERE existing.provider_id = ranked.provider_id
        AND existing.is_primary
  );

WITH mapping(source_code, target_code, keep_primary, priority) AS (
    VALUES
        ('dermatologie', 'dermatologie_und_venerologie', TRUE, 10),
        ('innere_medizin_vorsorge', 'innere_medizin', TRUE, 10),
        ('onkologie', 'haematologie_und_onkologie', TRUE, 10),
        ('orthopaedie', 'orthopaedie_und_unfallchirurgie', TRUE, 10),
        ('orthopaedie_radiologie', 'orthopaedie_und_unfallchirurgie', TRUE, 10),
        ('orthopaedie_radiologie', 'radiologie', FALSE, 20)
)
INSERT INTO tmp_doctor_legacy_primary_specializations (
    doctor_id,
    target_specialization_id,
    priority
)
SELECT ds.doctor_id, target.id, mapping.priority
FROM provider_doctor_specializations ds
JOIN medical_specializations source ON source.id = ds.specialization_id
JOIN mapping ON mapping.source_code = source.code
JOIN medical_specializations target ON target.code = mapping.target_code
WHERE ds.is_primary
  AND mapping.keep_primary;

WITH mapping(source_code, target_code, keep_primary, priority) AS (
    VALUES
        ('dermatologie', 'dermatologie_und_venerologie', TRUE, 10),
        ('innere_medizin_vorsorge', 'innere_medizin', TRUE, 10),
        ('onkologie', 'haematologie_und_onkologie', TRUE, 10),
        ('orthopaedie', 'orthopaedie_und_unfallchirurgie', TRUE, 10),
        ('orthopaedie_radiologie', 'orthopaedie_und_unfallchirurgie', TRUE, 10),
        ('orthopaedie_radiologie', 'radiologie', FALSE, 20)
)
INSERT INTO provider_doctor_specializations (doctor_id, specialization_id, is_primary)
SELECT DISTINCT ds.doctor_id, target.id, FALSE
FROM provider_doctor_specializations ds
JOIN medical_specializations source ON source.id = ds.specialization_id
JOIN mapping ON mapping.source_code = source.code
JOIN medical_specializations target ON target.code = mapping.target_code
ON CONFLICT (doctor_id, specialization_id) DO NOTHING;

DELETE FROM provider_doctor_specializations ds
USING medical_specializations ms
WHERE ds.specialization_id = ms.id
  AND ms.code IN (
      'dermatologie',
      'innere_medizin_vorsorge',
      'onkologie',
      'orthopaedie',
      'orthopaedie_radiologie'
  );

WITH ranked AS (
    SELECT
        doctor_id,
        target_specialization_id,
        row_number() OVER (
            PARTITION BY doctor_id
            ORDER BY priority, target_specialization_id
        ) AS rn
    FROM tmp_doctor_legacy_primary_specializations
)
UPDATE provider_doctor_specializations ds
SET is_primary = TRUE
FROM ranked
WHERE ranked.rn = 1
  AND ds.doctor_id = ranked.doctor_id
  AND ds.specialization_id = ranked.target_specialization_id
  AND NOT EXISTS (
      SELECT 1
      FROM provider_doctor_specializations existing
      WHERE existing.doctor_id = ranked.doctor_id
        AND existing.is_primary
  );

UPDATE medical_specializations
SET is_active = FALSE,
    deleted_at = COALESCE(deleted_at, now()),
    updated_at = now()
WHERE code IN (
    'dermatologie',
    'innere_medizin_vorsorge',
    'onkologie',
    'orthopaedie',
    'orthopaedie_radiologie'
);
