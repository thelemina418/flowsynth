import { isOpen } from "./board";
import { grantsOf } from "./levels";
import { SHALE_CELL } from "./map";
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

const always = () => true;
// Declared now; chunks 05 (walls) and 06 (prestige) fill in the predicates.
const later = () => false;

const SKETCH: readonly GoalEntry[] = [
  {
    label: "Place a third oscillator",
    shown: (s) => grantsOf(s).allowance.oscillator >= 3,
    done: (s) => placedCount(s.game.board, "oscillator") >= 3,
  },
  { label: "Conquer Shale", shown: always, done: (s) => isOpen(s.game.board, SHALE_CELL) },
  { label: "Conquer Basalt", shown: later, done: later },
  { label: "Reach Flint", shown: later, done: later },
  { label: "Prestige", shown: later, done: later },
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
