import { apply, type ApplyResult } from "./apply";
import { createInitialState } from "./state";
import { DEFAULT_HABIT_COLOR } from "./habits";
import type { GameState, Goal, Habit, HabitClass } from "./types";

export function fresh(): GameState {
  return createInitialState();
}

// A habit, created through `apply` and selected as the session's active
// habit. Awaiting its class unless one is given.
export function giveHabit(state: GameState, name = "Piano", habitClass?: HabitClass): { habit: Habit } {
  const created = apply(state, habitClass ? { type: "createHabit", name, habitClass } : { type: "createHabit", name });
  if (!created.ok || !created.id) throw new Error(`fixture habit failed: ${created.reason}`);
  if (!apply(state, { type: "selectHabit", id: created.id }).ok) throw new Error("fixture habit select failed");
  return { habit: state.records.habits.find((h) => h.id === created.id)! };
}

// A complete hand-built habit shape for tests that push habits directly.
export function plainHabit(id = "h1", name = "Piano"): Habit {
  return { id, name, seconds: 0, archived: false, color: DEFAULT_HABIT_COLOR, habitClass: null };
}

// The habit or Intention a create action made, read from the state.
export function habitOf(state: GameState, made: ApplyResult): Habit {
  const habit = state.records.habits.find((h) => h.id === made.id);
  if (!habit) throw new Error(`no habit was made: ${made.reason}`);
  return habit;
}

export function intentionOf(state: GameState, made: ApplyResult): Goal {
  const goal = state.records.intentions.find((g) => g.id === made.id);
  if (!goal) throw new Error(`no Intention was made: ${made.reason}`);
  return goal;
}
