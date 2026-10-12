/**
 * The two consents a request confirms itself (privacy notice, health data):
 * they are never taken over from the patient card. The status line and the
 * note of a repeat intake name exactly the consent that is still unticked,
 * instead of "not ticked" while the privacy notice already is (QA 2026-10-12
 * B3-01).
 */

type Bilingual = (ru: string, de: string) => string;

function missingConsentNames(privacy: boolean, healthcare: boolean, tx: Bilingual): string[] {
  return [
    privacy ? null : tx("политика конфиденциальности", "Datenschutzhinweise"),
    healthcare ? null : tx("согласие на обработку медицинских данных", "Einwilligung zu Gesundheitsdaten"),
  ].filter((name): name is string => Boolean(name));
}

/** The status of the row "Согласия в этом обращении". */
export function requestConsentStatus(privacy: boolean, healthcare: boolean, tx: Bilingual): string {
  if (privacy && healthcare) return tx("Отмечены в этом обращении", "In dieser Anfrage bestätigt");
  if (!privacy && !healthcare) {
    return tx(
      "Не отмечены: согласия из карточки не переносятся",
      "Nicht bestätigt: Einwilligungen werden nicht aus der Akte übernommen",
    );
  }
  return `${tx("Ещё не отмечено", "Noch nicht bestätigt")}: ${missingConsentNames(privacy, healthcare, tx).join(", ")}`;
}

/** The note above the consent boxes of a repeat intake. */
export function repeatConsentNote(privacy: boolean, healthcare: boolean, tx: Bilingual): string {
  if (!privacy && !healthcare) {
    return tx(
      "Согласия из карточки пациента не переносятся: подтвердите их с клиентом для этого обращения.",
      "Einwilligungen werden nicht aus der Patientenakte übernommen: bitte für diese Anfrage mit dem Kunden bestätigen.",
    );
  }
  return `${tx(
    "Согласия из карточки не переносятся — для этого обращения ещё не отмечено",
    "Einwilligungen werden nicht aus der Akte übernommen – für diese Anfrage noch nicht bestätigt",
  )}: ${missingConsentNames(privacy, healthcare, tx).join(", ")}.`;
}
