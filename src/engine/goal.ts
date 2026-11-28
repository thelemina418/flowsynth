import { isOpen } from "./board";
import { prestigeAvailable } from "./era";
import { grantsOf } from "./levels";
import { BASALT_CELLS, FLINT_CELL, SCHIST_CELL, SHALE_CELL } from "./map";
import { placedCount } from "./placement";
import type { Arc, GameState } from "./types";

// The Goal (spec chunk 04, issue #42): the one line on the board naming
// what's worth reaching next. A pure function of the state, recomputed and
// never persisted. Each arc has a fixed priority list; the Goal is the
// first entry that is shown and not done. It only ever names something on
// the board, never an Intention.

interface GoalEntry {
  label: string;
  shown: (state: GameState) => boolean;
  done: (state: GameState) => boolean;
}

// The Goal that offers a prestige. The shell and the Encyclopedia ask for
// it through `prestigeIsGoal`, never by its label's text.
export const PRESTIGE_GOAL = "Prestige";

const always = () => true;
const never = () => false;

const SKETCH: readonly GoalEntry[] = [
  {
    label: "Place a third oscillator",
    shown: (s) => grantsOf(s).allowance.oscillator >= 3,
    done: (s) => placedCount(s.game.board, "oscillator") >= 3,
  },
  { label: "Conquer Shale", shown: always, done: (s) => isOpen(s.game.board, SHALE_CELL) },
  { label: "Conquer Basalt", shown: always, done: (s) => BASALT_CELLS.some((cell) => isOpen(s.game.board, cell)) },
  { label: "Reach Flint", shown: always, done: (s) => s.game.openClasses.includes("roadie") },
  { label: "Conquer Flint", shown: always, done: (s) => isOpen(s.game.board, FLINT_CELL) },
  { label: "Conquer Schist", shown: always, done: (s) => isOpen(s.game.board, SCHIST_CELL) },
  // Shown once the era's ν reaches 1e6 (issue #61); never done, since a
  // prestige sets the era's ν to 0, which hides it.
  { label: PRESTIGE_GOAL, shown: prestigeAvailable, done: never },
];

const PRIORITIES: Record<Arc, readonly GoalEntry[]> = {
  sketch: SKETCH,
  demo: [],
  record: [],
  master: [],
  encore: [],
};

// The Goal's label, or null once every shown entry is done.
export function goalOf(state: GameState): string | null {
  const entry = PRIORITIES[state.game.board.arc].find((e) => e.shown(state) && !e.done(state));
  return entry?.label ?? null;
}

// Whether the Goal is the one that offers a prestige (issue #61).
export function prestigeIsGoal(state: GameState): boolean {
  return goalOf(state) === PRESTIGE_GOAL;
}

// First-session disclosure (philosophy.md, Disclosure): before the first
// completed session, upgrade mode shows only the nine first-screen things.
// From the first completed session on, it also shows the allowance chips,
// the Almanac and Encyclopedia doors. Read off the session count the
// engine already keeps. (The flow screen's class line shows from the first
// session, per the spec's flow sketch, so it needs no flag.)
export interface Disclosure {
  chips: boolean;
  doors: boolean;
}

export function disclosureOf(state: GameState): Disclosure {
  const after = state.records.sessionsCompleted > 0;
  return { chips: after, doors: after };
}
