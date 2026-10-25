/**
 * "Newest request wins" for one piece of state that several async loads
 * write (QA 2026-10-25, M F-2: a lead response begun before «Подтвердить
 * смету» landed after the reload that followed it and put the old readiness
 * back — «Смета не соответствует текущему заказу — пересчитайте» right after
 * confirming).
 *
 * Every load takes a ticket when it starts; its answer is written only while
 * no load that started later has written yet. An older answer that arrives
 * first is still written and the newer one replaces it when it lands, so a
 * newer load that fails loses nothing.
 */
export type NewestLoadGuard = {
  /** The ticket of a load starting now. */
  begin(): number;
  /** Whether the answer of `ticket` may be written now; if so, it counts as written. */
  claim(ticket: number): boolean;
};

export function createNewestLoadGuard(): NewestLoadGuard {
  let issued = 0;
  let written = 0;
  return {
    begin() {
      issued += 1;
      return issued;
    },
    claim(ticket) {
      if (ticket < written) return false;
      written = ticket;
      return true;
    },
  };
}
