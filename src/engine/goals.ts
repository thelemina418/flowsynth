import { EPS } from "./constants";
import type { Goal, GoalCondition, GoalSchedule, GameState } from "./types";
export type { Goal, GoalCondition, GoalSchedule };

// Goals (issue #6, re-owned by issue #423 and narrowed to one per habit by
// issue #445, ADR-0075). A goal tracks a practice condition ("Piano, 20
// minutes a day") and belongs to ONE habit: only credited practice for that
// habit advances it — unstructured practice advances nothing. Each habit
// owns zero or one active goal. Progress accrues only while the goal is
// active — earlier practice never counts retroactively, the one exception
// being a cadence edit, whose recalculation reads the new period's practice
// from the record (editGoal below). Completions grant nothing (ADR-0012).
// Daily and weekly goals reset at the local calendar boundary; one-time
// goals keep running until edited, replaced, or removed.

// A habit's active goal: the one running row — a multi-goal migration's
// unresolved rows are pending (they neither run nor light a read until the
// player retains one) and retired rows are history.
export function activeGoalOf(state: GameState, habitId: string): Goal | undefined {
  return state.goals.find((goal) => !goal.retired && !goal.pendingChoice && goal.condition.habitId === habitId);
}

export function activeGoals(state: GameState): Goal[] {
  return state.goals.filter((goal) => !goal.retired && !goal.pendingChoice && goal.condition.habitId !== null);
}

export function pendingGoalsOf(state: GameState, habitId: string): Goal[] {
  return state.goals.filter((goal) => !goal.retired && goal.pendingChoice === true && goal.condition.habitId === habitId);
}

export function goalRequiredSeconds(goal: Goal): number {
  return goal.condition.minutes * 60;
}

// The calendar's two primitives (issue #445): the local day start and the
// local Monday start. The occurrence keys and the cadence recalculation's
// period start both read them, so the boundary can never disagree with
// itself.
function localDayStart(now: number): Date {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function localWeekStart(now: number): Date {
  const d = new Date(now);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
}

function localDateKey(now: number): string {
  const d = localDayStart(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localWeekKey(now: number): string {
  const d = localWeekStart(now);
  return `${d.getFullYear()}-W${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export function occurrenceKeyFor(schedule: GoalSchedule, now: number): string {
  if (schedule.kind === "daily") return localDateKey(now);
  if (schedule.kind === "weekly") return localWeekKey(now);
  return "once";
}

// The current occurrence's start (issue #445): local midnight for daily,
// the local Monday for weekly, and the goal's own creation for once — the
// period a cadence change recalculates qualifying practice over. The
// primitives above are the one calendar source.
export function occurrenceStartFor(schedule: GoalSchedule, now: number, createdAt: number): number {
  if (schedule.kind === "once") return createdAt;
  return (schedule.kind === "weekly" ? localWeekStart : localDayStart)(now).getTime();
}

// Rolls recurring goals to the current occurrence at the local calendar
// boundary. Cheap and idempotent; call with the real clock from ticks and
// session events.
export function rollGoalOccurrences(state: GameState, now: number): void {
  for (const goal of activeGoals(state)) {
    const key = occurrenceKeyFor(goal.schedule, now);
    if (goal.occurrenceKey !== key) {
      goal.occurrenceKey = key;
      goal.progressSeconds = 0;
      goal.completed = false;
    }
  }
}

export interface GoalCreateInput {
  habitId: string | null;
  minutes: number;
  schedule: GoalSchedule["kind"];
  now: number;
}

function validGoalMinutes(minutes: number): boolean {
  return Number.isFinite(minutes) && Math.round(minutes) >= 1 && minutes <= 24 * 60;
}

// Preserve the description older session records resolved through this row
// before an edit changes it. New records already carry their own snapshot.
function preserveGoalHistory(state: GameState, goal: Goal): void {
  for (const record of state.sessionRecords) {
    for (const advanced of record.goalsAdvanced) {
      if (advanced.goalId === goal.id && !advanced.goal) advanced.goal = structuredClone(goal);
    }
  }
}

export function createGoal(state: GameState, input: GoalCreateInput): { ok: boolean; reason?: string; goal?: Goal } {
  if (state.mode !== "upgrade") return { ok: false, reason: "Goals are managed between sessions." };
  // Goals are owned by a habit (issue #423): the cross-habit template
  // retired with the shared slot economy.
  if (input.habitId === null) return { ok: false, reason: "Pick the habit this goal tracks." };
  // One active goal per habit (issue #445): an unresolved migration choice
  // counts — the carried rows stand until the player retains one.
  if (activeGoalOf(state, input.habitId) || pendingGoalsOf(state, input.habitId).length > 0) {
    return { ok: false, reason: "That habit already tracks a goal — edit or remove it first." };
  }
  if (!validGoalMinutes(input.minutes)) return { ok: false, reason: "Choose between 1 and 1440 minutes." };
  if (!state.habits.some((h) => h.id === input.habitId && !h.archived)) {
    return { ok: false, reason: "That habit does not exist." };
  }
  const schedule: GoalSchedule = { kind: input.schedule };
  const goal: Goal = {
    id: `g${state.nextId++}`,
    condition: { kind: "habit-minutes", habitId: input.habitId, minutes: Math.round(input.minutes) },
    schedule,
    occurrenceKey: occurrenceKeyFor(schedule, input.now),
    progressSeconds: 0,
    completed: false,
    completedCount: 0,
    createdAt: input.now,
  };
  state.goals.push(goal);
  return { ok: true, goal };
}

export function deleteGoal(state: GameState, id: string): { ok: boolean; reason?: string } {
  if (state.mode !== "upgrade") return { ok: false, reason: "Goals are managed between sessions." };
  const index = state.goals.findIndex((g) => !g.retired && !g.pendingChoice && g.id === id);
  if (index === -1) return { ok: false, reason: "Goal not found." };
  preserveGoalHistory(state, state.goals[index]!);
  state.goals[index]!.retired = true;
  return { ok: true };
}

// The goal's edit (issue #445), the one path the habit editor's form
// lands through — a target change and a cadence change in one move.
// Upgrade mode only, like every goal mutation. A target change retains
// qualifying practice: progressSeconds stands, and the goal only
// un-completes when the raised target is no longer met (a target lowered
// to or below met progress stays completed — the completion already
// happened, and no credit can replay). A cadence change recalculates
// qualifying practice for the new period — live and manual — since the new
// schedule's current occurrence began, with the occurrence rolled to its key.
export function editGoal(
  state: GameState,
  id: string,
  edit: { minutes: number; schedule: GoalSchedule["kind"] },
  now: number,
): { ok: boolean; reason?: string } {
  if (state.mode !== "upgrade") return { ok: false, reason: "Goals are managed between sessions." };
  const goal = activeGoals(state).find((g) => g.id === id);
  if (!goal) return { ok: false, reason: "Goal not found." };
  if (!validGoalMinutes(edit.minutes)) return { ok: false, reason: "Choose between 1 and 1440 minutes." };
  const schedule: GoalSchedule = { kind: edit.schedule };
  preserveGoalHistory(state, goal);
  goal.condition.minutes = Math.round(edit.minutes);
  if (schedule.kind === goal.schedule.kind) {
    goal.schedule = schedule;
    goal.completed = goal.progressSeconds >= goalRequiredSeconds(goal);
    return { ok: true };
  }
  // A live entry is bounded by the time available after the period start,
  // never attributed wholly by its end.
  goal.schedule = schedule;
  goal.occurrenceKey = occurrenceKeyFor(schedule, now);
  const start = occurrenceStartFor(schedule, now, goal.createdAt);
  let qualifying = 0;
  for (const entry of state.practiceLog) {
    if (entry.habitId !== goal.condition.habitId || entry.at < start || entry.at > now) continue;
    const seconds = entry.source === "manual" ? entry.seconds : Math.min(entry.seconds, (entry.at - start) / 1000);
    qualifying += seconds;
  }
  goal.progressSeconds = qualifying;
  goal.completed = qualifying >= goalRequiredSeconds(goal);
  return { ok: true };
}

// The migration choice's landing (issue #445): the player retains one
// carried-over row and its pending siblings retire to history, records
// intact. The retained row keeps its condition, progress, and completion
// facts exactly as carried — nothing is reinterpreted, and no completion
// fires here.
export function retainGoalChoice(state: GameState, id: string): { ok: boolean; reason?: string } {
  if (state.mode !== "upgrade") return { ok: false, reason: "Goals are managed between sessions." };
  const goal = state.goals.find((g) => g.pendingChoice === true && g.id === id);
  if (!goal || goal.condition.habitId === null) return { ok: false, reason: "Goal not found." };
  for (const pending of pendingGoalsOf(state, goal.condition.habitId)) {
    if (pending.id === id) delete pending.pendingChoice;
    else {
      pending.retired = true;
      delete pending.pendingChoice;
    }
  }
  return { ok: true };
}

const SCHEDULE_LABEL: Record<GoalSchedule["kind"], string> = { once: "once", daily: "a day", weekly: "a week" };

export function goalTargetSummary(goal: Goal): string {
  return `${goal.condition.minutes} min ${SCHEDULE_LABEL[goal.schedule.kind]}`;
}

export function goalSummary(state: GameState, goal: Goal): string {
  const name = goal.condition.habitId === null ? "Any habit" : state.habits.find((h) => h.id === goal.condition.habitId)?.name ?? "a habit";
  return `${name} · ${goalTargetSummary(goal)}`;
}

// Load-time normalization: flags other than a literal true drop, and the
// retired per-goal fields (the palette key, issue #445; the live-share
// slice, ADR-0047) leave the row. Mutates in place.
export function normalizeGoals(goals: Goal[]): void {
  for (const goal of goals) {
    if (!goal || typeof goal !== "object") continue;
    if (goal.retired !== true) delete goal.retired;
    if (goal.pendingChoice !== true) delete goal.pendingChoice;
    const row = goal as unknown as Record<string, unknown>;
    delete row.color;
    delete row.liveSeconds;
  }
}

function acceptsPractice(goal: Goal, habitId: string | null): boolean {
  // Goals are habit-owned (issue #423): only their own habit's credited
  // practice advances them. The cross-habit template (habitId null)
  // retired — a migrated save may still carry one until the conversion
  // retires it, and it never accrues again.
  return !goal.completed && goal.condition.kind === "habit-minutes"
    && goal.condition.habitId !== null && goal.condition.habitId === habitId;
}

// Accrues qualifying practice and completes goals. Practice advances only
// its own habit's goal (issue #423; one per habit since issue #445) —
// unstructured practice (habitId null) advances nothing, and an unresolved
// migration choice leaves nothing to advance. Returns the number of
// occurrences completed. While a
// session is live, every credited second is also ledged onto the session's
// own advancement map (§9), snapshotting into the record at close — manual
// logs never pass through here with a session live, so they never join
// the snapshot.
export function accrueGoalProgress(state: GameState, habitId: string | null, seconds: number): number {
  if (seconds <= EPS) return 0;
  let completions = 0;
  for (const goal of activeGoals(state)) {
    if (!acceptsPractice(goal, habitId)) continue;
    // Only practice up to completion belongs to this occurrence.
    const qualifying = Math.min(seconds, Math.max(0, goalRequiredSeconds(goal) - goal.progressSeconds));
    goal.progressSeconds += qualifying;
    const session = state.session;
    if (session) session.goalSeconds[goal.id] = (session.goalSeconds[goal.id] ?? 0) + qualifying;
    if (goal.progressSeconds >= goalRequiredSeconds(goal)) {
      goal.completed = true;
      goal.completedCount++;
      completions++;
    }
  }
  return completions;
}
