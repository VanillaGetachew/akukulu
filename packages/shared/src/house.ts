/**
 * What the house keeps in real-money mode. Amounts are whole birr and always round
 * down, so a very small pot pays nothing.
 */

/** Ludo, Conquer, Crazy and tournaments: a share of the prize pool, lower at higher stakes. */
export function houseCutPercent(stake: number): number {
  if (stake <= 0) return 0;
  if (stake <= 50) return 10;
  if (stake <= 500) return 8;
  return 5;
}

/** Poker cash games: this share of each pot, up to a cap that depends on the blinds. */
export const POKER_RAKE_PERCENT = 5;

export function pokerRakeCap(bigBlind: number): number {
  if (bigBlind <= 10) return bigBlind * 3;
  if (bigBlind <= 50) return bigBlind * 2;
  return bigBlind;
}

/** Sending money to another player, in whole birr. The fee comes out of the amount sent. */
export const TRANSFERS = { min: 10, max: 50_000, feePercent: 2, minFee: 1 } as const;

export function transferFee(amount: number): number {
  return Math.max(TRANSFERS.minFee, Math.ceil((amount * TRANSFERS.feePercent) / 100));
}

export function houseCut(amount: number, percent: number): number {
  return Math.floor((amount * percent) / 100);
}

/** The prize pool players compete for once the house cut is taken from the buy-ins. */
export function prizePoolAfterHouse(buyIns: number, percent: number | undefined): number {
  return buyIns - houseCut(buyIns, percent ?? 0);
}

/**
 * Takes the rake out of a hand's pots, main pot first. A pot with one eligible player
 * is an uncalled bet coming back, so it is never raked. Returns the amount taken.
 */
export function takeRake(pots: { amount: number; eligible: string[] }[], rake: { percent: number; cap: number }): number {
  const contested = pots.filter((p) => p.eligible.length > 1);
  const total = Math.min(houseCut(contested.reduce((sum, p) => sum + p.amount, 0), rake.percent), rake.cap);
  let left = total;
  for (const pot of contested) {
    const taken = Math.min(left, pot.amount);
    pot.amount -= taken;
    left -= taken;
  }
  return total;
}
