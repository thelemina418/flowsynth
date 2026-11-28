import { add, div, floor, gte, requireNotNaN, type Num } from "./num";
import type { GameState } from "./types";

// The era (spec chunk 06, issue #61; GLOSSARY: Era): its ν is everything
// made since the era began, whatever was spent. Every place ν is credited
// earns through here, so the balance and the era's ν rise together and
// only spending tells them apart.
export function earn(state: GameState, made: Num): void {
  state.game.nous = requireNotNaN(add(state.game.nous, made), "nous");
  state.game.eraNous = requireNotNaN(add(state.game.eraNous, made), "the era's nous");
}

// The era's ν at which the era may end: the Prestige Goal shows from here.
export const PRESTIGE_AT = 1e6;

export function prestigeAvailable(state: GameState): boolean {
  return gte(state.game.eraNous, PRESTIGE_AT);
}

// The Arete a prestige would bank now: floor(sqrt(era ν / 1e6)). The
// confirmation, the Goal and the pace runner share this one reader.
export function prestigeGainOf(state: GameState): Num {
  return floor(div(state.game.eraNous, PRESTIGE_AT).sqrt());
}
