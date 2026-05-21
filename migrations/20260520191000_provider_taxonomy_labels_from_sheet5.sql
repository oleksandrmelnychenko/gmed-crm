UPDATE provider_taxonomy_nodes
SET code = 'nonmedical_strip_clubs_bordelle',
    updated_at = now()
WHERE code = 'nonmedical_adult_entertainment';

WITH labels(code, name_de, name_ru) AS (
    VALUES
        ('medical_providers', 'Medizinische Provider', 'Медицинские провайдеры'),
        ('nonmedical_providers', 'Nicht-Medizinische Provider', 'Немедицинские провайдеры'),
        ('medical_clinics_practices', 'Kliniken & Praxen', 'Клиники и частные практики'),
        ('medical_pharmacies_supply', 'Apotheken und Sanitätshäuser', 'Аптеки и магазины медицинских изделий'),
        ('medical_reha_care', 'Reha & Pflege', 'Реабилитация и уход'),
        ('medical_therapeutic', 'Therapeutische Provider', 'Терапевтические провайдеры'),
        ('nonmedical_transport_logistics', 'Transport & Logistics', 'Транспорт и логистика'),
        ('nonmedical_lodging_travel', 'Unterkunft & Reisen', 'Проживание и путешествия'),
        ('nonmedical_gastronomy_nutrition', 'Gastronomie & Ernährung', 'Гастрономия и питание'),
        ('nonmedical_wellness_freizeit', 'Wellness & Freizeit', 'Wellness и досуг'),
        ('nonmedical_admin_legal', 'Amt, Recht & Verwaltung', 'Гос. учреждения, юридические и административные провайдеры'),
        ('nonmedical_ground_transport', 'Bodengebunden', 'Наземные'),
        ('nonmedical_aviation', 'Aviation', 'Авиация'),
        ('medical_clinics_practices_specialized_centers', 'Kliniken, Praxen, spezialisierte Zentren', 'Клиники, мед. практики, спец. мед. центры'),
        ('medical_pharmacies', 'Apotheken', 'Аптеки'),
        ('medical_medical_supply_stores', 'Sanitätshäuser', 'Магазины медицинских изделий'),
        ('medical_reha_clinics', 'Reha-Kliniken', 'Реабилитационные клиники'),
        ('medical_care_facilities', 'Pflegeeinrichtungen', 'Учреждения по уходу (дома престарелых, пансионаты, поддерживаемое проживание)'),
        ('medical_palliative', 'Palliativ-Einrichtungen', 'Паллиативные учреждения'),
        ('medical_physiotherapy', 'Physiotherapie', 'Физиотерапия'),
        ('medical_ergotherapy_logopedics', 'Ergotherapie & Logopädie', 'Эрготерапия и логопедия'),
        ('medical_psychotherapy', 'Psychotherapie', 'Психотерапия'),
        ('medical_other_health_professions', 'Weitere Heilberufe', 'Прочие лечебные профессии (подология, остеопатия, хиропрактика)'),
        ('nonmedical_chauffeur', 'Chauffeurdienst-Provider (Privatfahrer, Limousinen, Business-Class-Transfer)', 'Услуги водителя (частные водители, лимузины, трансфер бизнес-класса)'),
        ('nonmedical_car_rental', 'Car-Renting Provider', 'Сервисы аренды машин'),
        ('nonmedical_medical_ground_transport', 'Krankentransport-Provider', 'Провайдеры медицинского транспорта (наземные)'),
        ('nonmedical_business_aviation', 'Business-Aviation-Providers', 'Провайдеры бизнес-авиации'),
        ('nonmedical_medevac', 'MedEvac-Providers', 'Медицинская авиация'),
        ('nonmedical_airports', 'Flughäfen und andere verbundene Provider', 'Аэропорты и другие связанные сервисы'),
        ('nonmedical_hotels', 'Hotels', 'Отели'),
        ('nonmedical_private_accommodation', 'Privatunterkünfte und Apartments', 'Частные резиденции и апартаменты'),
        ('nonmedical_restaurants', 'Restaurants', 'Рестораны'),
        ('nonmedical_bars', 'Bars', 'Бары'),
        ('nonmedical_catering', 'Catering-Provider', 'Кейтеринг-провайдеры'),
        ('nonmedical_private_cook', 'Koch-Service', 'Личные повара'),
        ('nonmedical_nightclubs', 'Nightclubs', 'Ночные клубы'),
        ('nonmedical_culture', 'Kulturdienst-Provider (Museen, Theater, Stadtführungen)', 'Организаторы культурных мероприятий (музеи, театры, экскурсоводы)'),
        ('nonmedical_spa_wellness', 'Spa und Wellness', 'Спа и велнес-центры'),
        ('nonmedical_sport', 'Sport-Anbieter', 'Провайдеры спортивных услуг'),
        ('nonmedical_strip_clubs_bordelle', 'Strip-Clubs und Bordelle', 'Стрип-клубы и бордели'),
        ('nonmedical_other', 'Anderes', 'Другое'),
        ('nonmedical_government_offices', 'Ämter', 'Гос. учреждения'),
        ('nonmedical_legal', 'Recht (Rechtsanwälte und Rechtsanwaltskanzleien)', 'Юристы и юридические компании')
)
UPDATE provider_taxonomy_nodes node
SET name_de = labels.name_de,
    name_ru = labels.name_ru,
    updated_at = now()
FROM labels
WHERE node.code = labels.code
  AND (node.name_de IS DISTINCT FROM labels.name_de
       OR node.name_ru IS DISTINCT FROM labels.name_ru);
