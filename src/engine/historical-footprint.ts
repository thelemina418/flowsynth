// Pre-ADR-0089 figures for historical synthetic comparisons and the v13
// century baseline. Nothing that buys or quotes a live cell reads these.
export const V13_CELL_ECONOMY = { firstCost: 30, growth: "5/2" } as const;
export const V13_OPENING_PAID_ROWS: readonly number[] = [0, 1];

export function v13CellCost(purchaseIndex: number): number {
  const steps = BigInt(purchaseIndex);
  const denominator = 2n ** steps;
  return Number((BigInt(V13_CELL_ECONOMY.firstCost) * 5n ** steps + denominator - 1n) / denominator);
}

export function v13RowPremium(row: number): number {
  return row === 0 ? 0 : 60 * 2 ** (Math.abs(row) - 1);
}
