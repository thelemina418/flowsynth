import { EPS, REFLECTION_SLIDER_MIN, REFLECTION_SLIDER_NEUTRAL, REFLECTION_SLIDER_POSITIONS } from "./constants";
import { logSessionPractice } from "./habits";
import { rollGoalOccurrences } from "./goals";
import { freshAccounting } from "./trust";
import type { GameState, SessionReflection } from "./types";

// The interim session actions (issue #15): start, pause, resume and end a
// flow session, and record the summary's reflection. The board's actions
// retired with the old game; issue #17 routes every mutation through
// `apply(state, action)`.

export interface ActionResult {
  ok: boolean;
  reason?: string;
}

const ok: ActionResult = { ok: true };

function fail(reason: string): ActionResult {
  return { ok: false, reason };
}

export function startSession(state: GameState, target: number | null, now: number = 0): ActionResult {
  if (state.mode !== "upgrade") return fail("A session is already running.");
  state.sessionIndex++;
  state.mode = "flow";
  state.session = {
    target,
    elapsed: 0,
    accounting: freshAccounting(),
    targetSignaled: false,
    startedAt: now,
    goalSeconds: {},
  };
  return ok;
}

export function endSession(state: GameState, now: number = 0): ActionResult {
  if (state.mode === "upgrade") return fail("No session is running.");
  const session = state.session;
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
  state.mode = "upgrade";
  state.session = null;
  state.sessionsCompleted++;
  logSessionPractice(state, credited, now);
  rollGoalOccurrences(state, now);
  const events = (session?.accounting.events ?? []).map((event) => ({ ...event }));
  // The session record (§9): one append-only entry at close, whatever the
  // length or mode. The goals-advanced ledger snapshots from the session,
  // so deleting or replacing a goal never rewrites history.
  state.sessionRecords.push({
    sessionNumber: state.sessionsCompleted,
    startedAt: session && session.startedAt > 0 ? session.startedAt : now,
    endedAt: now,
    habitId: state.activeHabitId,
    mode: target !== null ? "planned" : "open-ended",
    plannedTarget: target,
    creditedSeconds: credited,
    honestyEvents: events,
    reflection: null,
    goalsAdvanced: Object.entries(session?.goalSeconds ?? {}).map(([goalId, seconds]) => {
      const goal = state.goals.find((row) => row.id === goalId);
      return { goalId, seconds, ...(goal ? { goal: structuredClone(goal) } : {}) };
    }),
  });
  state.summary = {
    sessionNumber: state.sessionsCompleted,
    seconds: credited,
    plannedTarget: target,
    honestyEvents: events,
    reflection: null,
    seen: false,
  };
  return ok;
}

export function pauseSession(state: GameState): ActionResult {
  if (state.mode !== "flow") return fail("Only a live session can be paused.");
  state.mode = "paused";
  return ok;
}

export function resumeSession(state: GameState): ActionResult {
  if (state.mode !== "paused") return fail("Only a paused session can be resumed.");
  state.mode = "flow";
  return ok;
}

// The summary's reflection (§8): recorded the moment either field is
// touched — the untouched field keeps its neutral default — and absent
// while neither is. The record's reflection slot fills from the same touch.
export function recordSummaryReflection(state: GameState, part: Partial<SessionReflection>): ActionResult {
  if (!state.summary) return fail("No session summary to reflect on.");
  const current = state.summary.reflection ?? { text: "", slider: REFLECTION_SLIDER_NEUTRAL };
  state.summary.reflection = {
    text: part.text ?? current.text,
    slider: Math.min(REFLECTION_SLIDER_POSITIONS, Math.max(REFLECTION_SLIDER_MIN, part.slider ?? current.slider)),
  };
  const record = state.sessionRecords.find((r) => r.sessionNumber === state.summary!.sessionNumber);
  if (record) record.reflection = { ...state.summary.reflection };
  return ok;
}

// The summary's dismissal (§5.7): one-time per session, persisted.
export function dismissSummary(state: GameState): ActionResult {
  if (!state.summary) return fail("No session summary to dismiss.");
  state.summary.seen = true;
  return ok;
}
