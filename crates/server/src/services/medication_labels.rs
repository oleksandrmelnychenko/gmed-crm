//! Readable dosage forms and routes for printed medication lists.
//!
//! `patient_medications.form` stores the official Darreichungsform short code
//! (`TABL`, `FTBL`, ... — the list of `frontend/src/pages/patients/data/
//! medication-options.ts`) and `einnahmeform` the German name of the route
//! (`Oral`, `Intravenös`, ...). The summary PDF and the Medikationsplan print
//! them in the document language instead of the codes (QA B-04, 2026-10-11).
//! An unknown value (free text, a BMP import) is printed as it was entered.

/// `(code, Russian, German)`.
const DOSAGE_FORMS: &[(&str, &str, &str)] = &[
    ("AMP", "Ампулы", "Ampullen"),
    ("AMPD", "Депо-ампулы", "Depotampullen"),
    ("AMPT", "Ампулы для приёма внутрь", "Trinkampullen"),
    ("ANSLB", "Глазная и назальная мазь", "Augen- und Nasensalbe"),
    ("AUGG", "Глазной гель", "Augengel"),
    ("AUGS", "Глазная мазь", "Augensalbe"),
    ("AUGT", "Глазные капли", "Augentropfen"),
    ("BTL", "Пакетики", "Beutel"),
    ("CREM", "Крем", "Creme"),
    (
        "DA",
        "Дозированный аэрозоль для ингаляций",
        "Druckgasinhalation",
    ),
    ("DRAG", "Драже", "Dragees"),
    ("DSTF", "Флакон", "Durchstechflasche"),
    (
        "EDAT",
        "Глазные капли (однодозовые)",
        "Augentropfen (Einzeldosisbehältnis)",
    ),
    (
        "EDGL",
        "Глазной гель (однодозовый)",
        "Augengel (Einzeldosisbehälter)",
    ),
    (
        "EMUL",
        "Эмульсия для наружного применения",
        "Emulsion zur Anwendung auf der Haut",
    ),
    (
        "EMULE",
        "Эмульсия для приёма внутрь",
        "Emulsion zum Einnehmen",
    ),
    ("EXPT", "Лиофилизированные таблетки", "Expidettäfelchen"),
    (
        "FTBL",
        "Таблетки, покрытые плёночной оболочкой",
        "Filmtabletten",
    ),
    (
        "FTBM",
        "Кишечнорастворимые таблетки, покрытые плёночной оболочкой",
        "magensaftresistente Filmtabletten",
    ),
    ("GEL", "Гель", "Gel"),
    ("GELE", "Гель для приёма внутрь", "Gel zum Einnehmen"),
    (
        "GRAM",
        "Кишечнорастворимые гранулы",
        "magensaftresistentes Granulat",
    ),
    ("GRAN", "Гранулы", "Granulat"),
    (
        "IFIJ",
        "Раствор для инъекций / инфузий",
        "Injektions-/Infusionslösung",
    ),
    ("IFLG", "Раствор для инфузий", "Infusionslösung"),
    ("IJLG", "Раствор для инъекций", "Injektionslösung"),
    ("IJSU", "Суспензия для инъекций", "Injektionssuspension"),
    (
        "INHK",
        "Капсулы с порошком для ингаляций",
        "Hartkapseln mit Pulver zur Inhalation",
    ),
    ("INHL", "Раствор для ингаляций", "Lösung zur Inhalation"),
    ("INHP", "Порошок для ингаляций", "Pulver zur Inhalation"),
    (
        "KAPM",
        "Кишечнорастворимые капсулы",
        "magensaftresistente Kapseln",
    ),
    (
        "KAPR",
        "Капсулы пролонгированного действия",
        "Retardkapseln",
    ),
    ("KAPS", "Капсулы", "Kapseln"),
    ("KGUM", "Жевательная резинка", "wirkstoffhaltige Kaugummis"),
    ("KOMB", "Комбинированная упаковка", "Kombipackung"),
    ("KTAB", "Жевательные таблетки", "Kautabletten"),
    (
        "LOTI",
        "Лосьон для наружного применения",
        "Emulsion zur Anwendung auf der Haut",
    ),
    ("LSG", "Раствор", "Lösung"),
    ("NCREM", "Назальный крем", "Nasencreme"),
    ("NGEL", "Назальный гель", "Nasengel"),
    ("NSPR", "Назальный спрей", "Nasenspray"),
    (
        "PAST",
        "Паста для наружного применения",
        "Paste zur Anwendung auf der Haut",
    ),
    ("PFLA", "Пластырь", "Pflaster"),
    (
        "PLVD",
        "Дозированный порошок для ингаляций",
        "einzeldosiertes Pulver zur Inhalation",
    ),
    ("PSTI", "Пастилки", "Pastillen"),
    ("PULV", "Порошок", "Pulver"),
    ("PULVE", "Порошок для приёма внутрь", "Pulver zum Einnehmen"),
    (
        "RGRAM",
        "Кишечнорастворимые гранулы пролонгированного действия",
        "magensaftresistentes Retardgranulat",
    ),
    (
        "RGRAN",
        "Гранулы пролонгированного действия",
        "Retardgranulat",
    ),
    ("RSCHA", "Ректальная пена", "Rektalschaum"),
    ("RSUSP", "Ректальная суспензия", "Rektalsuspension"),
    ("SALB", "Мазь", "Salbe"),
    (
        "SCHAU",
        "Пена для наружного применения",
        "Schaum zur Anwendung auf der Haut",
    ),
    ("SIRP", "Сироп", "Sirup"),
    (
        "SPRY",
        "Спрей для полости рта",
        "Spray zur Anwendung in der Mundhöhle",
    ),
    (
        "STABL",
        "Таблетки, диспергируемые в полости рта",
        "Schmelztabletten",
    ),
    (
        "STIF",
        "Карандаш для наружного применения",
        "Stifte zur Anwendung auf der Haut",
    ),
    ("SUPP", "Суппозитории", "Zäpfchen"),
    (
        "SUSP",
        "Суспензия для приёма внутрь",
        "Suspension zum Einnehmen",
    ),
    ("SUTA", "Подъязычные таблетки", "Sublingualtabletten"),
    ("TABB", "Шипучие таблетки", "Brausetabletten"),
    ("TABL", "Таблетки", "Tabletten"),
    (
        "TABMD",
        "Таблетки с модифицированным высвобождением",
        "Tabletten mit veränderter Wirkstofffreisetzung",
    ),
    (
        "TABR",
        "Таблетки пролонгированного действия",
        "Retardtabletten",
    ),
    (
        "TABRM",
        "Кишечнорастворимые таблетки пролонгированного действия",
        "magensaftresistente Retardtabletten",
    ),
    ("TBLL", "Таблетки для рассасывания", "Lutschtabletten"),
    (
        "TBLM",
        "Кишечнорастворимые таблетки",
        "magensaftresistente Tabletten",
    ),
    ("TROP", "Капли для приёма внутрь", "Tropfen zum Einnehmen"),
    ("TRSB", "Сухое вещество (лиофилизат)", "Trockensubstanz"),
    (
        "TTAB",
        "Таблетки для приготовления раствора / суспензии",
        "Tabletten zur Herstellung einer Lösung / Suspension",
    ),
    (
        "UTBL",
        "Таблетки, покрытые оболочкой",
        "Überzogene Tabletten",
    ),
    ("VACR", "Вагинальный крем", "Vaginalcreme"),
    ("VAGT", "Вагинальные таблетки", "Vaginaltabletten"),
    ("VASP", "Вагинальные суппозитории", "Vaginalzäpfchen"),
];

/// `(stored German route, Russian)`; the German print keeps the stored name.
const ROUTES: &[(&str, &str)] = &[
    ("Aural", "В ухо"),
    ("Bukkal", "Буккально"),
    ("Endobronchial", "Эндобронхиально"),
    ("Enteral", "Энтерально"),
    ("Inhalativ", "Ингаляционно"),
    ("Intraarteriell", "Внутриартериально"),
    ("Intraartikulär", "Внутрисуставно"),
    ("Intraduktal", "Внутрипротоково"),
    ("Intragluteal", "Внутриягодично"),
    ("Intrakutan", "Внутрикожно"),
    ("Intramuskulär", "Внутримышечно"),
    ("Intranasal", "Интраназально"),
    ("Intraneural", "Интраневрально"),
    ("Intraokulär", "Внутриглазно"),
    ("Intraossär", "Внутрикостно"),
    ("Intraperitoneal", "Внутрибрюшинно"),
    ("Intrapleural", "Внутриплеврально"),
    ("Intrathekal", "Интратекально"),
    ("Intratumoral", "Внутриопухолево"),
    ("Intravasal", "Внутрисосудисто"),
    ("Intravenös", "Внутривенно"),
    ("Intravesikal", "Внутрипузырно"),
    ("Konjunktival", "Конъюнктивально"),
    ("Kutan", "Накожно"),
    ("Oral", "Перорально"),
    ("Parenteral", "Парентерально"),
    ("Peridural", "Эпидурально"),
    ("Perineural", "Периневрально"),
    ("Perkutan", "Чрескожно"),
    ("Rektal", "Ректально"),
    ("Subkutan", "Подкожно"),
    ("Sublingual", "Сублингвально"),
    ("Topisch", "Местно"),
    ("Transdermal", "Трансдермально"),
    ("Vaginal", "Вагинально"),
];

/// The dosage form in the document language; the raw value when it is no known code.
pub fn dosage_form_label(raw: &str, russian: bool) -> String {
    let trimmed = raw.trim();
    DOSAGE_FORMS
        .iter()
        .find(|(code, _, _)| code.eq_ignore_ascii_case(trimmed))
        .map(|(_, ru, de)| (if russian { *ru } else { *de }).to_owned())
        .unwrap_or_else(|| trimmed.to_owned())
}

/// The route of administration in the document language; the raw value when unknown.
pub fn route_label(raw: &str, russian: bool) -> String {
    let trimmed = raw.trim();
    if !russian {
        return trimmed.to_owned();
    }
    let key = trimmed.to_lowercase();
    ROUTES
        .iter()
        .find(|(german, _)| german.to_lowercase() == key)
        .map(|(_, ru)| (*ru).to_owned())
        .unwrap_or_else(|| trimmed.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dosage_form_codes_print_as_names_in_the_document_language() {
        assert_eq!(dosage_form_label("TABL", false), "Tabletten");
        assert_eq!(dosage_form_label(" tabl ", true), "Таблетки");
        assert_eq!(
            dosage_form_label("FTBL", true),
            "Таблетки, покрытые плёночной оболочкой"
        );
        assert_eq!(dosage_form_label("Tablette", true), "Tablette");
        assert_eq!(dosage_form_label("", false), "");
    }

    #[test]
    fn routes_print_in_russian_and_keep_the_german_name() {
        assert_eq!(route_label("Oral", true), "Перорально");
        assert_eq!(route_label("intravenös", true), "Внутривенно");
        assert_eq!(route_label("Oral", false), "Oral");
        assert_eq!(route_label("per Sonde", true), "per Sonde");
    }

    #[test]
    fn every_code_and_route_is_unique() {
        let mut codes: Vec<_> = DOSAGE_FORMS.iter().map(|(code, _, _)| *code).collect();
        codes.sort_unstable();
        codes.dedup();
        assert_eq!(codes.len(), DOSAGE_FORMS.len());
        let mut routes: Vec<_> = ROUTES.iter().map(|(route, _)| *route).collect();
        routes.sort_unstable();
        routes.dedup();
        assert_eq!(routes.len(), ROUTES.len());
    }
}
