import { D, isNum, isNaNNum, NumFault } from "./num";
import { openingBoard } from "./board";
import { emptyConsole } from "./console";
import { emptyEncyclopedia, revealEntries } from "./encyclopedia";
import { noRates } from "./rates";
import type { GameState } from "./types";

// A fresh start: empty real-life records, and a game state with no nous,
// no session, Engineer and Producer open, no legacy line, the opening
// board, and the Encyclopedia's opening reveals.
export function createInitialState(): GameState {
  const state: GameState = {
    records: {
      habits: [],
      activeHabitId: null,
      practiceLog: [],
      sessionRecords: [],
      notes: [],
      intentions: [],
      classCredit: { engineer: 0, producer: 0, mixer: 0, roadie: 0 },
      sessionIndex: 0,
      sessionsCompleted: 0,
      nextId: 1,
    },
    game: {
      nous: D(0),
      mode: "upgrade",
      session: null,
      summary: null,
      breather: { banked: null, running: null, result: null },
      encyclopedia: emptyEncyclopedia(),
      openClasses: ["engineer", "producer"],
      legacyLine: null,
      board: openingBoard(),
      console: emptyConsole(),
      // The opening board holds no module, so it makes nothing.
      rates: noRates(),
    },
  };
  // Walls and the start types are revealed from the start.
  revealEntries(state);
  return state;
}

// A deep copy that keeps Decimals as Decimals. structuredClone would strip
// their prototype; num's helpers never mutate a Decimal, so sharing the
// instance is a faithful copy.
export function cloneState<T>(value: T): T {
  if (isNum(value)) return value;
  if (Array.isArray(value)) return value.map((item) => cloneState(item)) as T;
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = cloneState(item);
    return copy as T;
  }
  return value;
}

// The NaN check at the apply/advance boundary (ADR-0094): every Decimal in
// the game state must be a number.
export function requireNoNaN(state: GameState): void {
  const walk = (value: unknown, path: string): void => {
    if (isNum(value)) {
      if (isNaNNum(value)) throw new NumFault(`${path} is NaN`);
      return;
    }
    if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`));
    else if (typeof value === "object" && value !== null) {
      for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
    }
  };
  walk(state.game, "game");
}

// The engine's one commit sequence (apply and advance): run the step on a
// copy, refuse whole or NaN-check, and hand back the next state. The
// state given is never touched: a refusal or a numeric fault (a nonfinite
// second, a NaN Decimal) returns it as it was.
export type Transaction<R> = { state: GameState; result: R; fault?: undefined } | { state: GameState; result?: undefined; fault: string };

export function transact<R>(state: GameState, step: (draft: GameState) => R, accepted: (result: R) => boolean = () => true): Transaction<R> {
  const draft = cloneState(state);
  try {
    const result = step(draft);
    if (!accepted(result)) return { state, result };
    requireNoNaN(draft);
    return { state: draft, result };
  } catch (error) {
    if (!(error instanceof NumFault)) throw error;
    return { state, fault: error.detail };
  }
}
