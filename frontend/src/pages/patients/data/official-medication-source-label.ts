import type { Lang } from "@/lib/i18n";

type OfficialMedicationSource = {
  id: string;
  label: string;
  authority: string;
};

const OFFICIAL_SOURCE_LABELS: Record<string, { ru: string; de: string }> = {
  ema_pms_public_api: {
    ru: "Публичный API службы управления лекарственными препаратами EMA",
    de: "Öffentliche API des EMA Product Management Service",
  },
  bfarm_pharmnet_amice: {
    ru: "Информационная система лекарственных препаратов PharmNet.Bund (AMIce)",
    de: "PharmNet.Bund Arzneimittel-Informationssystem (AMIce)",
  },
  bfarm_rote_hand: {
    ru: "Письма Rote-Hand и RSS",
    de: "Rote-Hand-Briefe und RSS",
  },
  bfarm_lieferengpaesse: {
    ru: "Сообщения о дефиците лекарств",
    de: "Lieferengpassmeldungen",
  },
  pei_sicherheitsinformationen: {
    ru: "Информация о безопасности лекарственных препаратов",
    de: "Sicherheitsinformationen zu Arzneimitteln",
  },
  gba_ais_xml: {
    ru: "Информационная система лекарственных препаратов (AIS)",
    de: "Arzneimittel-Informationssystem (AIS)",
  },
  awmf_leitlinienregister: {
    ru: "Реестр клинических рекомендаций AWMF",
    de: "AWMF-Leitlinienregister",
  },
  nvl: {
    ru: "Национальные клинические рекомендации",
    de: "Nationale VersorgungsLeitlinien",
  },
  kbv_bmp: {
    ru: "Единый план медикаментозной терапии (BMP)",
    de: "Bundeseinheitlicher Medikationsplan (BMP)",
  },
};

export function officialSourceLabel(source: OfficialMedicationSource, lang: Lang) {
  const localized = OFFICIAL_SOURCE_LABELS[source.id];
  if (localized) return localized[lang];
  return source.label
    || source.authority
    || (lang === "de" ? "Amtliche Quelle" : "Официальный источник");
}
