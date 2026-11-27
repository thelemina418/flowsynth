import { EPS } from "./constants";
import type { Intention, IntentionCondition, IntentionSchedule, GameState } from "./types";
export type { Intention, IntentionCondition, IntentionSchedule };

// Intentions (issue #6, re-owned by issue #423 and narrowed to one per habit by
// issue #445, ADR-0075). An intention tracks a practice condition ("Piano, 20
// minutes a day") and belongs to ONE habit: only credited practice for that
// habit advances it — unstructured practice advances nothing. Each habit
// owns zero or one active intention. Progress accrues only while the intention is
// active — earlier practice never counts retroactively, the one exception
// being a cadence edit, whose recalculation reads the new period's practice
// from the record (editIntention below). Completions grant nothing (ADR-0012).
// Daily and weekly intentions reset at the local calendar boundary; one-time
// intentions keep running until edited, replaced, or removed.

// A habit's active intention: the one running row — a multi-intention migration's
// unresolved rows are pending (they neither run nor light a read until the
// player retains one) and retired rows are history.
export function activeIntentionOf(state: GameState, habitId: string): Intention | undefined {
  return state.records.intentions.find((intention) => !intention.retired && !intention.pendingChoice && intention.condition.habitId === habitId);
}

export function activeIntentions(state: GameState): Intention[] {
  return state.records.intentions.filter((intention) => !intention.retired && !intention.pendingChoice && intention.condition.habitId !== null);
}

export function pendingIntentionsOf(state: GameState, habitId: string): Intention[] {
  return state.records.intentions.filter((intention) => !intention.retired && intention.pendingChoice === true && intention.condition.habitId === habitId);
}

export function intentionRequiredSeconds(intention: Intention): number {
  return intention.condition.minutes * 60;
}

// The calendar's two primitives (issue #445): the local day start and the
// local Monday start. The occurrence keys and the cadence recalculation's
// period start both read them, so the boundary can never disagree with
// itself.
export function localDayStart(now: number): Date {
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

export function occurrenceKeyFor(schedule: IntentionSchedule, now: number): string {
  if (schedule.kind === "daily") return localDateKey(now);
  if (schedule.kind === "weekly") return localWeekKey(now);
  return "once";
}

// The current occurrence's start (issue #445): local midnight for daily,
// the local Monday for weekly, and the intention's own creation for once — the
// period a cadence change recalculates qualifying practice over. The
// primitives above are the one calendar source.
export function occurrenceStartFor(schedule: IntentionSchedule, now: number, createdAt: number): number {
  if (schedule.kind === "once") return createdAt;
  return (schedule.kind === "weekly" ? localWeekStart : localDayStart)(now).getTime();
}

// Rolls recurring intentions to the current occurrence at the local calendar
// boundary. Cheap and idempotent; call with the real clock from ticks and
// session events.
export function rollIntentionOccurrences(state: GameState, now: number): void {
  for (const intention of activeIntentions(state)) {
    const key = occurrenceKeyFor(intention.schedule, now);
    if (intention.occurrenceKey !== key) {
      intention.occurrenceKey = key;
      intention.progressSeconds = 0;
      intention.completed = false;
    }
  }
}

export interface IntentionCreateInput {
  habitId: string | null;
  minutes: number;
  schedule: IntentionSchedule["kind"];
  now: number;
}

function validIntentionMinutes(minutes: number): boolean {
  return Number.isFinite(minutes) && Math.round(minutes) >= 1 && minutes <= 24 * 60;
}

// Preserve the description older session records resolved through this row
// before an edit changes it. New records already carry their own snapshot.
function preserveIntentionHistory(state: GameState, intention: Intention): void {
  for (const record of state.records.sessionRecords) {
    for (const advanced of record.goalsAdvanced) {
      if (advanced.goalId === intention.id && !advanced.goal) advanced.goal = structuredClone(intention);
    }
  }
}

export function createIntention(state: GameState, input: IntentionCreateInput): { ok: boolean; reason?: string; intention?: Intention } {
  if (state.game.mode !== "upgrade") return { ok: false, reason: "Intentions are managed between sessions." };
  // Intentions are owned by a habit (issue #423): the cross-habit template
  // retired with the shared slot economy.
  if (input.habitId === null) return { ok: false, reason: "Pick the habit this Intention tracks." };
  // One active intention per habit (issue #445): an unresolved migration choice
  // counts — the carried rows stand until the player retains one.
  if (activeIntentionOf(state, input.habitId) || pendingIntentionsOf(state, input.habitId).length > 0) {
    return { ok: false, reason: "That habit already has an Intention — edit or remove it first." };
  }
  if (!validIntentionMinutes(input.minutes)) return { ok: false, reason: "Choose between 1 and 1440 minutes." };
  if (!state.records.habits.some((h) => h.id === input.habitId && !h.archived)) {
    return { ok: false, reason: "That habit does not exist." };
  }
  const schedule: IntentionSchedule = { kind: input.schedule };
  const intention: Intention = {
    id: `g${state.records.nextId++}`,
    condition: { kind: "habit-minutes", habitId: input.habitId, minutes: Math.round(input.minutes) },
    schedule,
    occurrenceKey: occurrenceKeyFor(schedule, input.now),
    progressSeconds: 0,
    completed: false,
    completedCount: 0,
    createdAt: input.now,
  };
  state.records.intentions.push(intention);
  return { ok: true, intention };
}

export function deleteIntention(state: GameState, id: string): { ok: boolean; reason?: string } {
  if (state.game.mode !== "upgrade") return { ok: false, reason: "Intentions are managed between sessions." };
  const index = state.records.intentions.findIndex((g) => !g.retired && !g.pendingChoice && g.id === id);
  if (index === -1) return { ok: false, reason: "Intention not found." };
  preserveIntentionHistory(state, state.records.intentions[index]!);
  state.records.intentions[index]!.retired = true;
  return { ok: true };
}

// The intention's edit (issue #445), the one path the habit editor's form
// lands through — a target change and a cadence change in one move.
// Upgrade mode only, like every intention mutation. A target change retains
// qualifying practice: progressSeconds stands, and the intention only
// un-completes when the raised target is no longer met (a target lowered
// to or below met progress stays completed — the completion already
// happened, and no credit can replay). A cadence change recalculates
// qualifying practice for the new period — live and manual — since the new
// schedule's current occurrence began, with the occurrence rolled to its key.
export function editIntention(
  state: GameState,
  id: string,
  edit: { minutes: number; schedule: IntentionSchedule["kind"] },
  now: number,
): { ok: boolean; reason?: string } {
  if (state.game.mode !== "upgrade") return { ok: false, reason: "Intentions are managed between sessions." };
  const intention = activeIntentions(state).find((g) => g.id === id);
  if (!intention) return { ok: false, reason: "Intention not found." };
  if (!validIntentionMinutes(edit.minutes)) return { ok: false, reason: "Choose between 1 and 1440 minutes." };
  const schedule: IntentionSchedule = { kind: edit.schedule };
  preserveIntentionHistory(state, intention);
  intention.condition.minutes = Math.round(edit.minutes);
  if (schedule.kind === intention.schedule.kind) {
    intention.schedule = schedule;
    intention.completed = intention.progressSeconds >= intentionRequiredSeconds(intention);
    return { ok: true };
  }
  // A live entry is bounded by the time available after the period start,
  // never attributed wholly by its end.
  intention.schedule = schedule;
  intention.occurrenceKey = occurrenceKeyFor(schedule, now);
  const start = occurrenceStartFor(schedule, now, intention.createdAt);
  let qualifying = 0;
  for (const entry of state.records.practiceLog) {
    if (entry.habitId !== intention.condition.habitId || entry.at < start || entry.at > now) continue;
    const seconds = entry.source === "manual" ? entry.seconds : Math.min(entry.seconds, (entry.at - start) / 1000);
    qualifying += seconds;
  }
  intention.progressSeconds = qualifying;
  intention.completed = qualifying >= intentionRequiredSeconds(intention);
  return { ok: true };
}

// The migration choice's landing (issue #445): the player retains one
// carried-over row and its pending siblings retire to history, records
// intact. The retained row keeps its condition, progress, and completion
// facts exactly as carried — nothing is reinterpreted, and no completion
// fires here.
export function retainIntentionChoice(state: GameState, id: string): { ok: boolean; reason?: string } {
  if (state.game.mode !== "upgrade") return { ok: false, reason: "Intentions are managed between sessions." };
  const intention = state.records.intentions.find((g) => g.pendingChoice === true && g.id === id);
  if (!intention || intention.condition.habitId === null) return { ok: false, reason: "Intention not found." };
  for (const pending of pendingIntentionsOf(state, intention.condition.habitId)) {
    if (pending.id === id) delete pending.pendingChoice;
    else {
      pending.retired = true;
      delete pending.pendingChoice;
    }
  }
  return { ok: true };
}

const SCHEDULE_LABEL: Record<IntentionSchedule["kind"], string> = { once: "once", daily: "a day", weekly: "a week" };

export function intentionTargetSummary(intention: Intention): string {
  return `${intention.condition.minutes} min ${SCHEDULE_LABEL[intention.schedule.kind]}`;
}

export function intentionSummary(state: GameState, intention: Intention): string {
  const name = intention.condition.habitId === null ? "Any habit" : state.records.habits.find((h) => h.id === intention.condition.habitId)?.name ?? "a habit";
  return `${name} · ${intentionTargetSummary(intention)}`;
}

// Load-time normalization: flags other than a literal true drop, and the
// retired per-intention fields (the palette key, issue #445; the live-share
// slice, ADR-0047) leave the row. Mutates in place.
export function normalizeIntentions(intentions: Intention[]): void {
  for (const intention of intentions) {
    if (!intention || typeof intention !== "object") continue;
    if (intention.retired !== true) delete intention.retired;
    if (intention.pendingChoice !== true) delete intention.pendingChoice;
    const row = intention as unknown as Record<string, unknown>;
    delete row.color;
    delete row.liveSeconds;
  }
}

function acceptsPractice(intention: Intention, habitId: string | null): boolean {
  // Intentions are habit-owned (issue #423): only their own habit's credited
  // practice advances them. The cross-habit template (habitId null)
  // retired — a migrated save may still carry one until the conversion
  // retires it, and it never accrues again.
  return !intention.completed && intention.condition.kind === "habit-minutes"
    && intention.condition.habitId !== null && intention.condition.habitId === habitId;
}

// Accrues qualifying practice and completes intentions. Practice advances only
// its own habit's intention (issue #423; one per habit since issue #445) —
// unstructured practice (habitId null) advances nothing, and an unresolved
// migration choice leaves nothing to advance. Returns the number of
// occurrences completed. While a
// session is live, every credited second is also ledged onto the session's
// own advancement map (§9), snapshotting into the record at close — manual
// logs never pass through here with a session live, so they never join
// the snapshot.
export function accrueIntentionProgress(state: GameState, habitId: string | null, seconds: number): number {
  if (seconds <= EPS) return 0;
  let completions = 0;
  for (const intention of activeIntentions(state)) {
    if (!acceptsPractice(intention, habitId)) continue;
    // Only practice up to completion belongs to this occurrence.
    const qualifying = Math.min(seconds, Math.max(0, intentionRequiredSeconds(intention) - intention.progressSeconds));
    intention.progressSeconds += qualifying;
    const session = state.game.session;
    if (session) session.goalSeconds[intention.id] = (session.goalSeconds[intention.id] ?? 0) + qualifying;
    if (intention.progressSeconds >= intentionRequiredSeconds(intention)) {
      intention.completed = true;
      intention.completedCount++;
      completions++;
    }
  }
  return completions;
}
