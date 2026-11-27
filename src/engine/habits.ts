import { EPS } from "./constants";
import { accrueGoalProgress, rollGoalOccurrences } from "./goals";
import type { GameState, Habit, HabitColor, PracticeEntry } from "./types";

export type { Habit, PracticeEntry };

// Habits (issue #5). A habit names what you are practicing; one may be
// selected as the session's active habit, locked for the session
// (ADR-0001). Credited time accrues from live flow time and manual
// practice logs. Interim (issue #15): classes retired with the old game and
// return with spec chunk 04.

// The six-token palette (issue #312, re-owned by the habit with issue
// #445, ADR-0075), vermillion default. The choice is made in the habit
// editor and read from habit state everywhere after — the goal inherits
// it, so there is no legend and no second place to set it.
export const HABIT_COLORS: readonly HabitColor[] = ["vermillion", "amber", "green", "cyan", "indigo", "violet"];
export const DEFAULT_HABIT_COLOR: HabitColor = "vermillion";

// The one lenient spelling: an absent or unknown key reads as the default,
// never a made-up token — the same answer at creation, at a re-pick, and
// at load.
export function normalizeHabitColor(color: unknown): HabitColor {
  return typeof color === "string" && (HABIT_COLORS as readonly string[]).includes(color) ? (color as HabitColor) : DEFAULT_HABIT_COLOR;
}

export function activeHabit(state: GameState): Habit | undefined {
  return state.habits.find((h) => h.id === state.activeHabitId && !h.archived);
}

function cleanName(name: string): string {
  return name.trim().slice(0, 40);
}

export function createHabit(state: GameState, name: string): { ok: boolean; reason?: string; habit?: Habit } {
  if (state.mode !== "upgrade") return { ok: false, reason: "Habits are managed between sessions." };
  const trimmed = cleanName(name);
  if (!trimmed) return { ok: false, reason: "Give the habit a name." };
  const habit: Habit = {
    id: `h${state.nextId++}`,
    name: trimmed,
    seconds: 0,
    archived: false,
    // The palette default (issue #445): the editor's swatches change it.
    color: DEFAULT_HABIT_COLOR,
  };
  state.habits.push(habit);
  return { ok: true, habit };
}

export function renameHabit(state: GameState, id: string, name: string): { ok: boolean; reason?: string } {
  if (state.mode !== "upgrade") return { ok: false, reason: "Habits are managed between sessions." };
  const habit = state.habits.find((h) => h.id === id);
  if (!habit) return { ok: false, reason: "Habit not found." };
  const trimmed = cleanName(name);
  if (!trimmed) return { ok: false, reason: "Give the habit a name." };
  habit.name = trimmed;
  return { ok: true };
}

// The palette's landing (issue #445): the editor's swatch row re-colors
// the habit — identity alone, never its class — and every goal read
// inherits the pick. Upgrade mode only, like every habit mutation; the
// key must be one of the six.
export function setHabitColor(state: GameState, id: string, color: HabitColor): { ok: boolean; reason?: string } {
  if (state.mode !== "upgrade") return { ok: false, reason: "Habits are managed between sessions." };
  const habit = state.habits.find((h) => h.id === id);
  if (!habit) return { ok: false, reason: "Habit not found." };
  if (normalizeHabitColor(color) !== color) return { ok: false, reason: "Pick one of the six colors." };
  habit.color = color;
  return { ok: true };
}

export function archiveHabit(state: GameState, id: string): { ok: boolean; reason?: string } {
  if (state.mode !== "upgrade") return { ok: false, reason: "Habits are managed between sessions." };
  const habit = state.habits.find((h) => h.id === id);
  if (!habit) return { ok: false, reason: "Habit not found." };
  habit.archived = true;
  if (state.activeHabitId === id) state.activeHabitId = null;
  return { ok: true };
}

// The session lock (ADR-0001): habit selection is an upgrade-mode action —
// the lock holds for the entire session, pauses included.
export function selectHabit(state: GameState, id: string | null): { ok: boolean; reason?: string } {
  if (state.mode !== "upgrade") return { ok: false, reason: "The active habit is locked during flow." };
  if (id !== null && !state.habits.some((h) => h.id === id && !h.archived)) {
    return { ok: false, reason: "Habit not found." };
  }
  state.activeHabitId = id;
  return { ok: true };
}

// Manual practice log: advances the habit's credited time and its goal
// conditions (§2.3).
export function addPracticeLog(
  state: GameState,
  habitId: string,
  minutes: number,
  now: number = 0,
): { ok: boolean; reason?: string; completions?: number } {
  if (state.mode !== "upgrade") return { ok: false, reason: "Practice is logged between sessions." };
  const habit = state.habits.find((h) => h.id === habitId && !h.archived);
  if (!habit) return { ok: false, reason: "Habit not found." };
  if (!(minutes > 0)) return { ok: false, reason: "Log a positive number of minutes." };
  rollGoalOccurrences(state, now);
  const completions = accrueGoalProgress(state, habitId, minutes * 60);
  habit.seconds += minutes * 60;
  state.practiceLog.push({
    id: `p${state.nextId++}`,
    habitId,
    seconds: minutes * 60,
    source: "manual",
    at: now,
  });
  return { ok: true, completions };
}

// Called from advance: live practice develops the active habit.
export function accrueLivePractice(state: GameState, seconds: number): void {
  if (seconds <= EPS) return;
  const habit = activeHabit(state);
  if (!habit) return;
  habit.seconds += seconds;
}

// Called from endSession: one practice-log entry per session for goal
// evaluation. Timestamps come from the caller; tests pass explicit values.
export function logSessionPractice(state: GameState, seconds: number, now: number): void {
  const habit = state.habits.find((h) => h.id === state.activeHabitId);
  if (!habit || seconds <= EPS) return;
  state.practiceLog.push({
    id: `p${state.nextId++}`,
    habitId: habit.id,
    seconds,
    source: "live",
    at: now,
  });
}
