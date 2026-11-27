import { EPS } from "./constants";
import { requireFinite } from "./num";
import { accrueIntentionProgress, rollIntentionOccurrences } from "./intentions";
import type { GameState, Habit, HabitClass, HabitColor, PracticeEntry } from "./types";

export type { Habit, PracticeEntry };

// Habits (issue #5). A habit names what you are practicing; one may be
// selected as the session's active habit, locked for the session
// (ADR-0001). Credited time accrues from live flow time and manual
// practice logs. A habit is attuned to one habit class, or awaits its
// class; only live credited flow time counts toward class credit (spec
// chunk 01). Levels and allowance are chunk 04's.

// The six-token palette (issue #312, re-owned by the habit with issue
// #445, ADR-0075), vermillion default. The choice is made in the habit
// editor and read from habit state everywhere after — the intention inherits
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
  return state.records.habits.find((h) => h.id === state.records.activeHabitId && !h.archived);
}

function cleanName(name: string): string {
  return name.trim().slice(0, 40);
}

const CLASS_NAMES: Record<HabitClass, string> = { engineer: "Engineer", producer: "Producer", mixer: "Mixer", roadie: "Roadie" };

export function className(habitClass: HabitClass): string {
  return CLASS_NAMES[habitClass];
}

function classOpen(state: GameState, habitClass: HabitClass): boolean {
  return state.game.openClasses.includes(habitClass);
}

export function createHabit(
  state: GameState,
  name: string,
  habitClass: HabitClass | null = null,
): { ok: boolean; reason?: string; habit?: Habit } {
  if (state.game.mode !== "upgrade") return { ok: false, reason: "Habits are managed between sessions." };
  const trimmed = cleanName(name);
  if (!trimmed) return { ok: false, reason: "Give the habit a name." };
  if (habitClass !== null && !classOpen(state, habitClass)) {
    return { ok: false, reason: `The ${CLASS_NAMES[habitClass]} class isn't open yet.` };
  }
  const habit: Habit = {
    id: `h${state.records.nextId++}`,
    name: trimmed,
    seconds: 0,
    archived: false,
    // The palette default (issue #445): the editor's swatches change it.
    color: DEFAULT_HABIT_COLOR,
    habitClass,
  };
  state.records.habits.push(habit);
  return { ok: true, habit };
}

export function renameHabit(state: GameState, id: string, name: string): { ok: boolean; reason?: string } {
  if (state.game.mode !== "upgrade") return { ok: false, reason: "Habits are managed between sessions." };
  const habit = state.records.habits.find((h) => h.id === id);
  if (!habit) return { ok: false, reason: "Habit not found." };
  const trimmed = cleanName(name);
  if (!trimmed) return { ok: false, reason: "Give the habit a name." };
  habit.name = trimmed;
  return { ok: true };
}

// The palette's landing (issue #445): the editor's swatch row re-colors
// the habit — identity alone, never its class — and every intention read
// inherits the pick. Upgrade mode only, like every habit mutation; the
// key must be one of the six.
export function setHabitColor(state: GameState, id: string, color: HabitColor): { ok: boolean; reason?: string } {
  if (state.game.mode !== "upgrade") return { ok: false, reason: "Habits are managed between sessions." };
  const habit = state.records.habits.find((h) => h.id === id);
  if (!habit) return { ok: false, reason: "Habit not found." };
  if (normalizeHabitColor(color) !== color) return { ok: false, reason: "Pick one of the six colors." };
  habit.color = color;
  return { ok: true };
}

export function archiveHabit(state: GameState, id: string): { ok: boolean; reason?: string } {
  if (state.game.mode !== "upgrade") return { ok: false, reason: "Habits are managed between sessions." };
  const habit = state.records.habits.find((h) => h.id === id);
  if (!habit) return { ok: false, reason: "Habit not found." };
  habit.archived = true;
  if (state.records.activeHabitId === id) state.records.activeHabitId = null;
  return { ok: true };
}

// The class choice (story 9–14): asked once per habit that awaits its
// class. Only an open class can be chosen, and the choice credits the
// habit's live credited flow seconds — its live practice-log entries,
// never manual ones — to that class. It changes records only, never the
// board, so it is open in any mode: a migrated v15 save carrying a running
// session still chooses on first load. Nothing counts twice: a running
// session logs its entry only when it ends, and class credit never comes
// from that entry — flow after the choice accrues through `advance`.
export function chooseHabitClass(state: GameState, id: string, habitClass: HabitClass): { ok: boolean; reason?: string } {
  const habit = state.records.habits.find((h) => h.id === id);
  if (!habit) return { ok: false, reason: "Habit not found." };
  if (habit.habitClass !== null) return { ok: false, reason: "This habit's class is already chosen." };
  if (!classOpen(state, habitClass)) return { ok: false, reason: `The ${CLASS_NAMES[habitClass]} class isn't open yet.` };
  habit.habitClass = habitClass;
  let live = 0;
  for (const entry of state.records.practiceLog) {
    if (entry.habitId === id && entry.source === "live") live += entry.seconds;
  }
  state.records.classCredit[habitClass] = requireFinite(state.records.classCredit[habitClass] + live, "the class credit");
  return { ok: true };
}

// Re-attuning (spec chunk 04, issue #43): an attuned habit's class
// changes, between sessions only. Nothing else does: no credit moves, so
// the levels already earned stay with the class that earned them, and
// only later credited flow goes to the new class. A habit still awaiting
// its class gets one through the class choice instead.
export function reattuneHabit(state: GameState, id: string, habitClass: HabitClass): { ok: boolean; reason?: string } {
  if (state.game.mode !== "upgrade") return { ok: false, reason: "Habits are managed between sessions." };
  const habit = state.records.habits.find((h) => h.id === id && !h.archived);
  if (!habit) return { ok: false, reason: "Habit not found." };
  if (habit.habitClass === null) return { ok: false, reason: "Choose this habit's class first." };
  if (!classOpen(state, habitClass)) return { ok: false, reason: `The ${CLASS_NAMES[habitClass]} class isn't open yet.` };
  if (habit.habitClass === habitClass) return { ok: false, reason: `${habit.name} is already ${CLASS_NAMES[habitClass]}.` };
  habit.habitClass = habitClass;
  return { ok: true };
}

// The session lock (ADR-0001): habit selection is an upgrade-mode action —
// the lock holds for the entire session, pauses included.
export function selectHabit(state: GameState, id: string | null): { ok: boolean; reason?: string } {
  if (state.game.mode !== "upgrade") return { ok: false, reason: "The active habit is locked during flow." };
  if (id !== null && !state.records.habits.some((h) => h.id === id && !h.archived)) {
    return { ok: false, reason: "Habit not found." };
  }
  state.records.activeHabitId = id;
  return { ok: true };
}

// Manual practice log: advances the habit's credited time and its intention
// conditions (§2.3).
export function addPracticeLog(
  state: GameState,
  habitId: string,
  minutes: number,
  now: number = 0,
): { ok: boolean; reason?: string; completions?: number } {
  if (state.game.mode !== "upgrade") return { ok: false, reason: "Practice is logged between sessions." };
  const habit = state.records.habits.find((h) => h.id === habitId && !h.archived);
  if (!habit) return { ok: false, reason: "Habit not found." };
  if (!(minutes > 0)) return { ok: false, reason: "Log a positive number of minutes." };
  rollIntentionOccurrences(state, now);
  const completions = accrueIntentionProgress(state, habitId, minutes * 60);
  habit.seconds += minutes * 60;
  state.records.practiceLog.push({
    id: `p${state.records.nextId++}`,
    habitId,
    seconds: minutes * 60,
    source: "manual",
    at: now,
  });
  return { ok: true, completions };
}

// Called from the flow walk and the honesty report: live credited time
// develops the active habit and, once it is attuned, its class.
export function accrueLivePractice(state: GameState, seconds: number): void {
  if (seconds <= EPS) return;
  const habit = activeHabit(state);
  if (!habit) return;
  habit.seconds = requireFinite(habit.seconds + seconds, "the habit's credited time");
  if (habit.habitClass !== null) {
    const credit = state.records.classCredit;
    credit[habit.habitClass] = requireFinite(credit[habit.habitClass] + seconds, "the class credit");
  }
}

// Called from endSession: one practice-log entry per session for intention
// evaluation. Timestamps come from the caller; tests pass explicit values.
export function logSessionPractice(state: GameState, seconds: number, now: number): void {
  const habit = state.records.habits.find((h) => h.id === state.records.activeHabitId);
  if (!habit || seconds <= EPS) return;
  state.records.practiceLog.push({
    id: `p${state.records.nextId++}`,
    habitId: habit.id,
    seconds,
    source: "live",
    at: now,
  });
}
