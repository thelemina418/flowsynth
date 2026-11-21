import { BALANCE } from "./constants";
import { adjacent, hex, hexDistance, hexKey, neighbors, sameHex } from "./hex";
import { positionInRange } from "./lattice";
import type { GameState, Hex } from "./types";

const ORIGIN = hex(0, 0);

// ADR-0089: the distance anchor never follows the board or its occupants.
export function cellBand(pos: Hex): number {
  return hexDistance(ORIGIN, pos);
}

export function cellPurchasePrice(pos: Hex): number {
  const band = cellBand(pos);
  if (band === 0) return BALANCE.cellFirstCost;
  return band === 1 ? BALANCE.cellFirstCost : BALANCE.cellSecondBandCost * BALANCE.cellOuterBandGrowth ** (band - 2);
}

export function cellFrontier(state: Pick<GameState, "cells">): Hex[] {
  const owned = new Set(state.cells.map(hexKey));
  const frontier = new Map<string, Hex>();
  for (const cell of state.cells) for (const pos of neighbors(cell)) {
    const key = hexKey(pos);
    if (!owned.has(key) && positionInRange(pos)) frontier.set(key, pos);
  }
  return [...frontier.values()];
}

// Both Add and the authoritative action use exactly this refusal and price.
export function cellPurchaseQuote(state: GameState, pos: Hex): { price: number | null; reason: string | null } {
  if (!positionInRange(pos)) return { price: null, reason: "That cell lies outside the board's lattice." };
  const amount = cellPurchasePrice(pos);
  const price = Number.isFinite(amount) ? amount : null;
  if (state.mode !== "upgrade") return { price, reason: "Purchases happen between sessions." };
  if (state.cells.some(cell => sameHex(cell, pos))) return { price, reason: "That cell is already part of the board." };
  if (!state.cells.some(cell => adjacent(cell, pos))) return { price, reason: "New cells must touch the board." };
  if (price === null || !Number.isFinite(state.nous)) return { price, reason: "This purchase cannot be represented safely." };
  return { price, reason: Math.floor(state.nous) < price ? "Not enough whole nous." : null };
}
