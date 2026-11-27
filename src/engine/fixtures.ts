import { createInitialState } from "./state";
import { createHabit, DEFAULT_HABIT_COLOR, selectHabit } from "./habits";
import type { GameState, Habit } from "./types";

export function fresh(): GameState {
  return createInitialState();
}

// A habit, created and selected as the session's active habit.
export function giveHabit(state: GameState, name = "Piano"): { habit: Habit } {
  const created = createHabit(state, name);
  if (!created.ok || !created.habit) throw new Error("fixture habit failed");
  selectHabit(state, created.habit.id);
  return { habit: created.habit };
}

// A complete hand-built habit shape for tests that push habits directly.
export function plainHabit(id = "h1", name = "Piano"): Habit {
  return { id, name, seconds: 0, archived: false, color: DEFAULT_HABIT_COLOR };
}
