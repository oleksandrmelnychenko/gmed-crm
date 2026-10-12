// Official German option lists for the "Aktuelle Medikation" form (Phase 3),
// from Olek's reference ("аркуш 5"). Edit/extend here as the master list changes.
//
// Einnahmeform stores the Applikationsform name; Darreichungsform stores the
// official short code (AMP, FTBL, …) and shows the German name.

export type MedicationOption = { value: string; label: string };

function optionLabel(options: readonly MedicationOption[], value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return "";
  return options.find((option) => option.value === normalized)?.label ?? normalized;
}

const DARREICHUNGSFORM_PRIORITY_VALUES = [
  "AMP",
  "ANSLB",
  "AUGG",
  "AUGS",
  "AUGT",
  "BTL",
  "CREM",
  "FTBL",
  "FTBM",
  "GEL",
  "GELE",
  "IFIJ",
  "IFLG",
  "IJLG",
  "IJSU",
] as const;

function prioritizeOptions(
  options: readonly MedicationOption[],
  priorityValues: readonly string[],
) {
  const byValue = new Map(options.map((option) => [option.value, option]));
  const prioritySet = new Set(priorityValues);
  return [
    ...priorityValues.flatMap((value) => {
      const option = byValue.get(value);
      return option ? [option] : [];
    }),
    ...options.filter((option) => !prioritySet.has(option.value)),
  ];
}

/** Route of administration (Einnahmeform / Applikationsform) — REQUIRED dropdown. */
export const EINNAHMEFORM_OPTIONS: readonly MedicationOption[] = [
  { value: "Aural", label: "Aural" },
  { value: "Bukkal", label: "Bukkal" },
  { value: "Endobronchial", label: "Endobronchial (e.b.)" },
  { value: "Enteral", label: "Enteral" },
  { value: "Inhalativ", label: "Inhalativ (p.i.)" },
  { value: "Intraarteriell", label: "Intraarteriell (i.a.)" },
  { value: "Intraartikulär", label: "Intraartikulär (i.art.)" },
  { value: "Intraduktal", label: "Intraduktal" },
  { value: "Intragluteal", label: "Intragluteal" },
  { value: "Intrakutan", label: "Intrakutan (i.c.)" },
  { value: "Intramuskulär", label: "Intramuskulär (i.m.)" },
  { value: "Intranasal", label: "Intranasal" },
  { value: "Intraneural", label: "Intraneural" },
  { value: "Intraokulär", label: "Intraokulär" },
  { value: "Intraossär", label: "Intraossär (i.o.)" },
  { value: "Intraperitoneal", label: "Intraperitoneal (i.p.)" },
  { value: "Intrapleural", label: "Intrapleural" },
  { value: "Intrathekal", label: "Intrathekal" },
  { value: "Intratumoral", label: "Intratumoral" },
  { value: "Intravasal", label: "Intravasal" },
  { value: "Intravenös", label: "Intravenös (i.v.)" },
  { value: "Intravesikal", label: "Intravesikal" },
  { value: "Konjunktival", label: "Konjunktival" },
  { value: "Kutan", label: "Kutan" },
  { value: "Oral", label: "Oral / Per os (p.o.)" },
  { value: "Parenteral", label: "Parenteral" },
  { value: "Peridural", label: "Peridural" },
  { value: "Perineural", label: "Perineural" },
  { value: "Perkutan", label: "Perkutan" },
  { value: "Rektal", label: "Rektal" },
  { value: "Subkutan", label: "Subkutan (s.c.)" },
  { value: "Sublingual", label: "Sublingual (s.l.)" },
  { value: "Topisch", label: "Topisch" },
  { value: "Transdermal", label: "Transdermal" },
  { value: "Vaginal", label: "Vaginal" },
];

/** Dosage form (Darreichungsform) — REQUIRED dropdown; value = official short code. */
const DARREICHUNGSFORM_REFERENCE_OPTIONS: readonly MedicationOption[] = [
  { value: "AMP", label: "Ampullen" },
  { value: "AMPD", label: "Depotampullen" },
  { value: "AMPT", label: "Trinkampullen" },
  { value: "ANSLB", label: "Augen- und Nasensalbe" },
  { value: "AUGG", label: "Augengel" },
  { value: "AUGS", label: "Augensalbe" },
  { value: "AUGT", label: "Augentropfen" },
  { value: "BTL", label: "Beutel" },
  { value: "CREM", label: "Creme" },
  { value: "DA", label: "Druckgasinhalation" },
  { value: "DRAG", label: "Dragees" },
  { value: "DSTF", label: "Durchstechflasche" },
  { value: "EDAT", label: "Augentropfen (Lösung im Einzeldosisbehältnis)" },
  { value: "EDGL", label: "Augengel (Einzeldosisbehälter)" },
  { value: "EMUL", label: "Emulsion zur Anwendung auf der Haut" },
  { value: "EMULE", label: "Emulsion zum Einnehmen, Emulsion zur gastrointestinalen Anwendung" },
  { value: "EXPT", label: "Expidettäfelchen" },
  { value: "FTBL", label: "Filmtabletten" },
  { value: "FTBM", label: "magensaftresistente Filmtabletten" },
  { value: "GEL", label: "Gel" },
  { value: "GELE", label: "Gel zum Einnehmen" },
  { value: "GRAM", label: "magensaftresistentes Granulat, magensaftresistentes Granulat zur Herstellung einer Suspension zum Einnehmen" },
  { value: "GRAN", label: "befilmtes Granulat, Granulat, Granulat zur Herstellung einer Lösung / Suspension zum Einnehmen, Granulat zur Herstellung eines Sirups" },
  { value: "IFIJ", label: "Injektions-/Infusionslösung, Konzentrat und Lösungsmittel zur Herstellung einer Injektions-/Infusionslösung, Konzentrat zur Herstellung einer Injektions-/Infusionslösung" },
  { value: "IFLG", label: "Infusionslösung, Konzentrat zur Herstellung einer Infusionslösung / Infusionsdispersion" },
  { value: "IJLG", label: "Injektionslösung" },
  { value: "IJSU", label: "Injektionssuspension" },
  { value: "INHK", label: "Hartkapseln mit Pulver zur Inhalation" },
  { value: "INHL", label: "Lösung zur Inhalation" },
  { value: "INHP", label: "Pulver zur Inhalation" },
  { value: "KAPM", label: "magensaftresistente Hartkapseln / Kapseln" },
  { value: "KAPR", label: "Retardkapseln, retardierte Hart-/Weichkapseln, Hartkapseln mit veränderter Wirkstofffreisetzung" },
  { value: "KAPS", label: "Kapseln, Hartkapseln, Weichkapseln" },
  { value: "KGUM", label: "wirkstoffhaltige Kaugummis" },
  { value: "KOMB", label: "Kombipackung" },
  { value: "KTAB", label: "Kautabletten" },
  { value: "LOTI", label: "Emulsion zur Anwendung auf der Haut" },
  { value: "LSG", label: "Lösung" },
  { value: "NCREM", label: "Nasencreme" },
  { value: "NGEL", label: "Nasengel" },
  { value: "NSPR", label: "Nasenspray" },
  { value: "PAST", label: "Paste zur Anwendung auf der Haut" },
  { value: "PFLA", label: "transdermale Pflaster, wirkstoffhaltige Pflaster" },
  { value: "PLVD", label: "einzeldosiertes Pulver zur Inhalation" },
  { value: "PSTI", label: "Pastillen, Lutschpastillen" },
  { value: "PULV", label: "Pulver / Pulver für ein Konzentrat / Pulver und Lösungsmittel zur Herstellung einer Injektionslösung / Pulver und Lösungsmittel zur Herstellung einer Injektions- / Infusionslösung" },
  { value: "PULVE", label: "Pulver zum Einnehmen, Pulver zur Herstellung einer Lösung / Suspension zum Einnehmen" },
  { value: "RGRAM", label: "magensaftresistentes Retardgranulat" },
  { value: "RGRAN", label: "Retardgranulat" },
  { value: "RSCHA", label: "Rektalschaum" },
  { value: "RSUSP", label: "Rektalsuspension" },
  { value: "SALB", label: "Salbe, Salbe zur Anwendung auf der Haut/Nasensalbe" },
  { value: "SCHAU", label: "Schaum zur Anwendung auf der Haut" },
  { value: "SIRP", label: "Sirup" },
  { value: "SPRY", label: "Spray zur Anwendung in der Mundhöhle" },
  { value: "STABL", label: "Schmelztabletten" },
  { value: "STIF", label: "Stifte zur Anwendung auf der Haut" },
  { value: "SUPP", label: "Zäpfchen" },
  { value: "SUSP", label: "Suspension zum Einnehmen" },
  { value: "SUTA", label: "Sublingualtabletten" },
  { value: "TABB", label: "Brausetabletten" },
  { value: "TABL", label: "Tabletten" },
  { value: "TABMD", label: "Tabletten mit veränderter Wirkstofffreisetzung" },
  { value: "TABR", label: "Retardtabletten" },
  { value: "TABRM", label: "magensaftresistente Retardtabletten" },
  { value: "TBLL", label: "Lutschtabletten" },
  { value: "TBLM", label: "magensaftresistente Tabletten" },
  { value: "TROP", label: "Tropfen zum Einnehmen" },
  { value: "TRSB", label: "Trockensubstanz" },
  { value: "TTAB", label: "Tabletten zur Herstellung einer Lösung / Suspension zum Einnehmen" },
  { value: "UTBL", label: "Überzogene Tabletten" },
  { value: "VACR", label: "Vaginalcreme" },
  { value: "VAGT", label: "Vaginaltabletten" },
  { value: "VASP", label: "Vaginalzäpfchen" },
];

export const DARREICHUNGSFORM_OPTIONS: readonly MedicationOption[] = prioritizeOptions(
  DARREICHUNGSFORM_REFERENCE_OPTIONS,
  DARREICHUNGSFORM_PRIORITY_VALUES,
);

/**
 * Russian names of the dosage forms, as the server prints them in the Russian
 * PDFs (`services/medication_labels.rs`). The pickers and lines of the Russian
 * UI show them; the stored value stays the official code (QA 2026-10-12 B3-03).
 */
const DARREICHUNGSFORM_RU: Readonly<Record<string, string>> = {
  AMP: "Ампулы",
  AMPD: "Депо-ампулы",
  AMPT: "Ампулы для приёма внутрь",
  ANSLB: "Глазная и назальная мазь",
  AUGG: "Глазной гель",
  AUGS: "Глазная мазь",
  AUGT: "Глазные капли",
  BTL: "Пакетики",
  CREM: "Крем",
  DA: "Дозированный аэрозоль для ингаляций",
  DRAG: "Драже",
  DSTF: "Флакон",
  EDAT: "Глазные капли (однодозовые)",
  EDGL: "Глазной гель (однодозовый)",
  EMUL: "Эмульсия для наружного применения",
  EMULE: "Эмульсия для приёма внутрь",
  EXPT: "Лиофилизированные таблетки",
  FTBL: "Таблетки, покрытые плёночной оболочкой",
  FTBM: "Кишечнорастворимые таблетки, покрытые плёночной оболочкой",
  GEL: "Гель",
  GELE: "Гель для приёма внутрь",
  GRAM: "Кишечнорастворимые гранулы",
  GRAN: "Гранулы",
  IFIJ: "Раствор для инъекций / инфузий",
  IFLG: "Раствор для инфузий",
  IJLG: "Раствор для инъекций",
  IJSU: "Суспензия для инъекций",
  INHK: "Капсулы с порошком для ингаляций",
  INHL: "Раствор для ингаляций",
  INHP: "Порошок для ингаляций",
  KAPM: "Кишечнорастворимые капсулы",
  KAPR: "Капсулы пролонгированного действия",
  KAPS: "Капсулы",
  KGUM: "Жевательная резинка",
  KOMB: "Комбинированная упаковка",
  KTAB: "Жевательные таблетки",
  LOTI: "Лосьон для наружного применения",
  LSG: "Раствор",
  NCREM: "Назальный крем",
  NGEL: "Назальный гель",
  NSPR: "Назальный спрей",
  PAST: "Паста для наружного применения",
  PFLA: "Пластырь",
  PLVD: "Дозированный порошок для ингаляций",
  PSTI: "Пастилки",
  PULV: "Порошок",
  PULVE: "Порошок для приёма внутрь",
  RGRAM: "Кишечнорастворимые гранулы пролонгированного действия",
  RGRAN: "Гранулы пролонгированного действия",
  RSCHA: "Ректальная пена",
  RSUSP: "Ректальная суспензия",
  SALB: "Мазь",
  SCHAU: "Пена для наружного применения",
  SIRP: "Сироп",
  SPRY: "Спрей для полости рта",
  STABL: "Таблетки, диспергируемые в полости рта",
  STIF: "Карандаш для наружного применения",
  SUPP: "Суппозитории",
  SUSP: "Суспензия для приёма внутрь",
  SUTA: "Подъязычные таблетки",
  TABB: "Шипучие таблетки",
  TABL: "Таблетки",
  TABMD: "Таблетки с модифицированным высвобождением",
  TABR: "Таблетки пролонгированного действия",
  TABRM: "Кишечнорастворимые таблетки пролонгированного действия",
  TBLL: "Таблетки для рассасывания",
  TBLM: "Кишечнорастворимые таблетки",
  TROP: "Капли для приёма внутрь",
  TRSB: "Сухое вещество (лиофилизат)",
  TTAB: "Таблетки для приготовления раствора / суспензии",
  UTBL: "Таблетки, покрытые оболочкой",
  VACR: "Вагинальный крем",
  VAGT: "Вагинальные таблетки",
  VASP: "Вагинальные суппозитории",
};

/** Russian names of the routes (the stored value is the German name). */
const EINNAHMEFORM_RU: Readonly<Record<string, string>> = {
  Aural: "В ухо",
  Bukkal: "Буккально",
  Endobronchial: "Эндобронхиально",
  Enteral: "Энтерально",
  Inhalativ: "Ингаляционно",
  Intraarteriell: "Внутриартериально",
  Intraartikulär: "Внутрисуставно",
  Intraduktal: "Внутрипротоково",
  Intragluteal: "Внутриягодично",
  Intrakutan: "Внутрикожно",
  Intramuskulär: "Внутримышечно",
  Intranasal: "Интраназально",
  Intraneural: "Интраневрально",
  Intraokulär: "Внутриглазно",
  Intraossär: "Внутрикостно",
  Intraperitoneal: "Внутрибрюшинно",
  Intrapleural: "Внутриплеврально",
  Intrathekal: "Интратекально",
  Intratumoral: "Внутриопухолево",
  Intravasal: "Внутрисосудисто",
  Intravenös: "Внутривенно",
  Intravesikal: "Внутрипузырно",
  Konjunktival: "Конъюнктивально",
  Kutan: "Накожно",
  Oral: "Перорально",
  Parenteral: "Парентерально",
  Peridural: "Эпидурально",
  Perineural: "Периневрально",
  Perkutan: "Чрескожно",
  Rektal: "Ректально",
  Subkutan: "Подкожно",
  Sublingual: "Сублингвально",
  Topisch: "Местно",
  Transdermal: "Трансдермально",
  Vaginal: "Вагинально",
};

export type MedicationOptionLang = "ru" | "de";

/** The dosage form picker in the UI language; the value stays the code. */
export function darreichungsformOptions(lang: MedicationOptionLang): readonly MedicationOption[] {
  if (lang !== "ru") return DARREICHUNGSFORM_OPTIONS;
  return DARREICHUNGSFORM_OPTIONS.map((option) => ({
    value: option.value,
    label: DARREICHUNGSFORM_RU[option.value] ?? option.label,
  }));
}

/**
 * The route picker in the UI language; the value stays the German name. The
 * Russian label keeps the abbreviation of the German one ("Перорально (p.o.)").
 */
export function einnahmeformOptions(lang: MedicationOptionLang): readonly MedicationOption[] {
  if (lang !== "ru") return EINNAHMEFORM_OPTIONS;
  return EINNAHMEFORM_OPTIONS.map((option) => {
    const russian = EINNAHMEFORM_RU[option.value];
    if (!russian) return option;
    const abbreviation = /\(([^()]+)\)\s*$/.exec(option.label)?.[1];
    return { value: option.value, label: abbreviation ? `${russian} (${abbreviation})` : russian };
  });
}

/** The dosage form's name ("Tabletten" / "Таблетки") for a stored code; free text as entered. */
export function darreichungsformLabel(
  value: string | null | undefined,
  lang: MedicationOptionLang = "de",
) {
  const normalized = value?.trim();
  if (lang === "ru" && normalized) {
    const russian = DARREICHUNGSFORM_RU[normalized.toUpperCase()];
    if (russian) return russian;
  }
  return optionLabel(DARREICHUNGSFORM_OPTIONS, value);
}

/** The route in the UI language ("Oral" / "Перорально"); null when it is no known route. */
export function einnahmeformLabel(
  value: string | null | undefined,
  lang: MedicationOptionLang = "de",
): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  const known = EINNAHMEFORM_OPTIONS.find((option) => option.value.toLowerCase() === normalized);
  if (!known) return null;
  return lang === "ru" ? (EINNAHMEFORM_RU[known.value] ?? known.value) : known.value;
}
