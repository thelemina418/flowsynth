import type { ActionResult } from "./actions";
import { add, D, div, floor, gte, requireNotNaN, type Num } from "./num";
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

// Prestige (issue #62; ADR-0039, ADR-0093): in upgrade mode at 1e6 era ν,
// bank the Arete the era's ν is worth at this moment, count the prestige,
// and zero ν, the era's ν and every channel and bus level. The board,
// cables, classes, records, the banked breather, the Encyclopedia and the
// console's disclosure all stay. The caller (apply) recomputes the rates.
export function prestige(state: GameState): ActionResult {
  if (state.game.mode !== "upgrade") return { ok: false, reason: "Prestige waits until no session or breather is running." };
  if (!prestigeAvailable(state)) return { ok: false, reason: "The era's ν hasn't reached 1e6." };
  const game = state.game;
  game.arete = requireNotNaN(add(game.arete, prestigeGainOf(state)), "Arete");
  game.prestiges++;
  game.nous = D(0);
  game.eraNous = D(0);
  game.console.channels = {};
  game.console.buses = {};
  return { ok: true };
}
