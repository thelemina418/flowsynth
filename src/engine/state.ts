import { D, isNum, isNaNNum, NumFault } from "./num";
import type { GameState } from "./types";

// A fresh start: empty real-life records, and a game state with no nous,
// no session, Engineer and Producer open, and no legacy line.
export function createInitialState(): GameState {
  return {
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
      openClasses: ["engineer", "producer"],
      legacyLine: null,
    },
  };
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

function isContainer(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !isNum(value);
}

// Puts `target` back to `snapshot` (a cloneState copy) in place: every
// object a caller holds — the state, a habit, an Intention — keeps its
// identity and reads its restored values.
export function restoreState(target: GameState, snapshot: GameState): void {
  restoreInto(target as unknown as Record<string, unknown>, snapshot as unknown as Record<string, unknown>);
}

function restoreInto(target: Record<string, unknown>, snapshot: Record<string, unknown>): void {
  if (Array.isArray(target) && Array.isArray(snapshot)) target.length = snapshot.length;
  for (const key of Object.keys(target)) if (!(key in snapshot)) delete target[key];
  for (const [key, value] of Object.entries(snapshot)) {
    const current = target[key];
    if (isContainer(current) && isContainer(value) && Array.isArray(current) === Array.isArray(value)) restoreInto(current, value);
    else target[key] = value;
  }
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
