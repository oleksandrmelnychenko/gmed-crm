import { useEffect, useState } from "react";

import { fetchRiskCountryLists } from "../data/risk-country-lists-api";
import { EMPTY_RISK_COUNTRY_LISTS, type RiskCountryLists } from "./enhanced-check";

/**
 * The configured country lists of the risk assessment, loaded each time the
 * wizard opens (`enabled`), so a list the CEO changed applies at the next
 * opening. A failed load or an older server leaves the empty lists: the
 * wizard then shows no country hint and the server's enhanced check
 * (`GET /leads/{id}/enhanced-check`) still decides.
 */
export function useRiskCountryLists(enabled = true): RiskCountryLists {
  const [lists, setLists] = useState<RiskCountryLists>(EMPTY_RISK_COUNTRY_LISTS);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    fetchRiskCountryLists()
      .then((next) => {
        if (active && next) setLists(next);
      })
      .catch(() => {
        // Keep the last lists: the wizard is not blocked by a failed load.
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  return lists;
}
