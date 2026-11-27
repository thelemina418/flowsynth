import { advance, type Advanced } from "./advance";
import { apply, type ApplyResult } from "./apply";
import { isOpen } from "./board";
import type { Cell } from "./hex";
import { isNum } from "./num";
import { createInitialState } from "./state";
import type { Presence } from "./trust";
import { DEFAULT_HABIT_COLOR } from "./habits";
import type { AdvanceMode, GameState, Intention, Habit, HabitClass, ModuleType } from "./types";

// The test harness. The engine's doors are pure; a test that walks one
// state through many steps holds one object instead, so these run the pure
// door and write the returned state back into it — every habit or
// Intention the test holds keeps its identity and reads the new values.
export function applyIn(state: GameState, action: Parameters<typeof apply>[1]): ApplyResult {
  const result = apply(state, action);
  writeBack(state, result.state);
  return result;
}

export function advanceIn(
  state: GameState,
  seconds: number,
  mode: AdvanceMode,
  presence: Presence = "visible",
  driftStepSeconds = 0,
): Advanced {
  const result = advance(state, seconds, mode, presence, driftStepSeconds);
  writeBack(state, result.state);
  return result;
}

function isContainer(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !isNum(value);
}

function writeBack(target: GameState, next: GameState): void {
  if (target !== next) writeInto(target as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
}

function writeInto(target: Record<string, unknown>, next: Record<string, unknown>): void {
  if (Array.isArray(target) && Array.isArray(next)) target.length = next.length;
  for (const key of Object.keys(target)) if (!(key in next)) delete target[key];
  for (const [key, value] of Object.entries(next)) {
    const current = target[key];
    if (isContainer(current) && isContainer(value) && Array.isArray(current) === Array.isArray(value)) writeInto(current, value);
    else target[key] = value;
  }
}

export function fresh(): GameState {
  return createInitialState();
}

// A habit, created through `apply` and selected as the session's active
// habit. Awaiting its class unless one is given.
export function giveHabit(state: GameState, name = "Piano", habitClass?: HabitClass): { habit: Habit } {
  const created = applyIn(state, habitClass ? { type: "createHabit", name, habitClass } : { type: "createHabit", name });
  if (!created.ok || !created.id) throw new Error(`fixture habit failed: ${created.reason}`);
  if (!applyIn(state, { type: "selectHabit", id: created.id }).ok) throw new Error("fixture habit select failed");
  return { habit: state.records.habits.find((h) => h.id === created.id)! };
}

// Oscillator allowance and arrived types beyond the opening, as chunk 04's
// class levels will grant them (issue #25).
export function giveOscillators(state: GameState, grant: { allowance?: number; arrive?: ModuleType[] }): void {
  if (grant.allowance !== undefined) state.game.allowance.oscillator = grant.allowance;
  for (const module of grant.arrive ?? []) if (!state.game.arrived.includes(module)) state.game.arrived.push(module);
}

// Owned open cells beyond the opening, as chunk 05's conquest will add
// them (issue #26). Owning a cell is not a layout change: no module moves,
// so the rates stay as they are.
export function ownCells(state: GameState, cells: Cell[]): void {
  for (const cell of cells) if (!isOpen(state.game.board, cell)) state.game.board.open.push({ q: cell.q, r: cell.r });
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

export function intentionOf(state: GameState, made: ApplyResult): Intention {
  const intention = state.records.intentions.find((g) => g.id === made.id);
  if (!intention) throw new Error(`no Intention was made: ${made.reason}`);
  return intention;
}
