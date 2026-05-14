-- Backfill Russian labels for the current RU/DE-only specialization directory.

UPDATE medical_specializations AS ms
SET name_ru = labels.name_ru,
    updated_at = now()
FROM (
    VALUES
        ('allergology', 'Аллергология'),
        ('anesthesiology', 'Анестезиология'),
        ('cardiology', 'Кардиология'),
        ('dermatology', 'Дерматология'),
        ('endocrinology', 'Эндокринология'),
        ('gastroenterology', 'Гастроэнтерология'),
        ('gynecology', 'Гинекология'),
        ('hematology', 'Гематология'),
        ('internal_medicine', 'Внутренняя медицина'),
        ('neurology', 'Неврология'),
        ('oncology', 'Онкология'),
        ('orthopedics', 'Ортопедия'),
        ('pediatrics', 'Педиатрия'),
        ('psychiatry', 'Психиатрия'),
        ('radiology', 'Радиология'),
        ('surgery', 'Хирургия'),
        ('urology', 'Урология')
) AS labels(code, name_ru)
WHERE ms.code = labels.code
  AND (
      ms.name_ru IS NULL
      OR btrim(ms.name_ru) = ''
      OR lower(ms.name_ru) = lower(ms.name_en)
  );
