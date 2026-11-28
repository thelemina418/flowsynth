import { EPS, REFLECTION_SLIDER_MIN, REFLECTION_SLIDER_NEUTRAL, REFLECTION_SLIDER_POSITIONS } from "./constants";
import { logSessionPractice } from "./habits";
import { classLevelOf } from "./levels";
import { D } from "./num";
import { rollIntentionOccurrences } from "./intentions";
import { freshAccounting } from "./trust";
import type { GameState, SessionReflection } from "./types";

// The session's mutations: start, pause, resume and end a flow session,
// mark the target signalled, and record the summary's reflection. Callers
// reach them through `apply(state, action)` (engine/apply.ts).

export interface ActionResult {
  ok: boolean;
  reason?: string;
}

const ok: ActionResult = { ok: true };

function fail(reason: string): ActionResult {
  return { ok: false, reason };
}

// The planned length a session may take (spec chunk 04, Begin flow), in
// seconds. A migrated open-ended session still runs and ends under the old
// rules, but none starts.
export const SESSION_MIN_SECONDS = 10 * 60;
export const SESSION_MAX_SECONDS = 180 * 60;

// Begin flow (issue #39): select the habit and start in one action.
export function startSession(state: GameState, habitId: string, target: number | null, now: number = 0): ActionResult {
  if (state.game.mode !== "upgrade") return fail("A session is already running.");
  const habit = state.records.habits.find((h) => h.id === habitId);
  if (!habit || habit.archived || habit.habitClass === null) return fail("Choose a habit first.");
  if (target === null || !Number.isFinite(target) || target < SESSION_MIN_SECONDS - EPS || target > SESSION_MAX_SECONDS + EPS) {
    return fail("Choose a length from 10 to 180 minutes.");
  }
  state.records.activeHabitId = habit.id;
  state.records.sessionIndex++;
  state.game.mode = "flow";
  state.game.session = {
    target,
    elapsed: 0,
    accounting: freshAccounting(),
    targetSignaled: false,
    startedAt: now,
    goalSeconds: {},
    nousMade: D(0),
  };
  return ok;
}

// The breather's bounds (issue #41): banked from 10 credited minutes, and
// 5 to 15 minutes long.
const BREATHER_MIN_CREDITED = 10 * 60;
const BREATHER_MIN_SECONDS = 5 * 60;
const BREATHER_MAX_SECONDS = 15 * 60;

export function endSession(state: GameState, now: number = 0): ActionResult {
  if (state.game.mode !== "flow" && state.game.mode !== "paused") return fail("No session is running.");
  const session = state.game.session;
  // The exit gate (spec §1–2): the honesty report's answer is mandatory and
  // final. A still unclassified absence buffer counts too: it would have
  // flushed at the visible boundary that preceded any real exit.
  if (session && (session.accounting.poolSeconds > EPS || session.accounting.pendingAwaySeconds > EPS)) {
    return fail("Provisional time is waiting on the honesty report.");
  }
  // Credited practice time (§3) is the seam: the practice-log entry and the
  // summary's practice minutes key off C — never raw elapsed.
  const credited = session?.accounting.creditedSeconds ?? 0;
  const target = session?.target ?? null;
  // The class's share: all credited time went to the session habit's
  // class, if it had one (habits.accrueLivePractice).
  const habitClass = state.records.habits.find((h) => h.id === state.records.activeHabitId)?.habitClass ?? null;
  const classSeconds = habitClass !== null ? credited : 0;
  const credit = habitClass !== null ? state.records.classCredit[habitClass] : 0;
  const levelAfter = classLevelOf(credit).level;
  const levelBefore = classLevelOf(Math.max(0, credit - classSeconds)).level;
  // A session of at least 10 credited minutes banks a breather of
  // credited ÷ 5, from 5 to 15 minutes, in place of any banked one; a
  // shorter one leaves the bank alone (ADR-0095).
  const breather = credited >= BREATHER_MIN_CREDITED - EPS ? Math.min(BREATHER_MAX_SECONDS, Math.max(BREATHER_MIN_SECONDS, credited / 5)) : null;
  if (breather !== null) state.game.breather.banked = { seconds: breather };
  state.game.mode = "upgrade";
  state.game.session = null;
  state.records.sessionsCompleted++;
  logSessionPractice(state, credited, now);
  rollIntentionOccurrences(state, now);
  const events = (session?.accounting.events ?? []).map((event) => ({ ...event }));
  // The session record (§9): one append-only entry at close, whatever the
  // length or mode. The goals-advanced ledger snapshots from the session,
  // so deleting or replacing an intention never rewrites history.
  state.records.sessionRecords.push({
    sessionNumber: state.records.sessionsCompleted,
    startedAt: session && session.startedAt > 0 ? session.startedAt : now,
    endedAt: now,
    habitId: state.records.activeHabitId,
    mode: target !== null ? "planned" : "open-ended",
    plannedTarget: target,
    creditedSeconds: credited,
    honestyEvents: events,
    reflection: null,
    goalsAdvanced: Object.entries(session?.goalSeconds ?? {}).map(([goalId, seconds]) => {
      const intention = state.records.intentions.find((row) => row.id === goalId);
      return { goalId, seconds, ...(intention ? { goal: structuredClone(intention) } : {}) };
    }),
  });
  state.game.summary = {
    sessionNumber: state.records.sessionsCompleted,
    seconds: credited,
    nous: session?.nousMade ?? D(0),
    habitClass,
    classSeconds,
    levelBefore,
    levelAfter,
    breather,
    plannedTarget: target,
    honestyEvents: events,
    reflection: null,
    seen: false,
  };
  return ok;
}

// The first wake-up past the target (spec §4): persisted so a reload never
// re-delivers the signals.
export function signalTarget(state: GameState): ActionResult {
  const session = state.game.session;
  if (!session || session.target === null) return fail("No planned session is running.");
  if (session.targetSignaled) return fail("The target was already signalled.");
  session.targetSignaled = true;
  return ok;
}

export function pauseSession(state: GameState): ActionResult {
  if (state.game.mode !== "flow") return fail("Only a live session can be paused.");
  state.game.mode = "paused";
  return ok;
}

export function resumeSession(state: GameState): ActionResult {
  if (state.game.mode !== "paused") return fail("Only a paused session can be resumed.");
  state.game.mode = "flow";
  return ok;
}

// The summary's reflection (§8): recorded the moment either field is
// touched — the untouched field keeps its neutral default — and absent
// while neither is. The record's reflection slot fills from the same touch.
export function recordSummaryReflection(state: GameState, part: Partial<SessionReflection>): ActionResult {
  if (!state.game.summary) return fail("No session summary to reflect on.");
  const current = state.game.summary.reflection ?? { text: "", slider: REFLECTION_SLIDER_NEUTRAL };
  state.game.summary.reflection = {
    text: part.text ?? current.text,
    slider: Math.min(REFLECTION_SLIDER_POSITIONS, Math.max(REFLECTION_SLIDER_MIN, part.slider ?? current.slider)),
  };
  const record = state.records.sessionRecords.find((r) => r.sessionNumber === state.game.summary!.sessionNumber);
  if (record) record.reflection = { ...state.game.summary.reflection };
  return ok;
}

// The summary's dismissal (§5.7): one-time per session, persisted.
export function dismissSummary(state: GameState): ActionResult {
  if (!state.game.summary) return fail("No session summary to dismiss.");
  state.game.summary.seen = true;
  return ok;
}
