import { DRIFT_NOISE_SECONDS, EPS, RECONCILIATION_FLOOR_SECONDS } from "./constants";
import { add, D, gt, requireNotNaN } from "./num";
import { requireFinite } from "./numeric";
import { accrueLivePractice } from "./habits";
import { accrueGoalProgress } from "./goals";
import { emptyAdvanceResult, sumResults, walkFlow } from "./walk";
import type { AdvanceResult, GameState, HonestyOutcome, SessionAccounting } from "./types";

export type { HonestyOutcome };

// Trust accounting (focus-tool spec §1–3, ADR-0019). Presence is visibility;
// every boundary hands this module the wall-clock gap since the last one and
// the presence state that held during it, and the session advances by that
// gap — never by tick count. Away trust runs to the plan: on a planned
// session, away time up to the target is trusted (credits silently); past
// the target — and all away time on open-ended sessions, beyond the
// reconciliation floor — it is provisional. Provisional time joins the pool
// (minutes) and the provisional nous, and credits nothing until the honesty
// report settles both in one move. Nothing already credited is ever
// retracted.
//
// An absence is the whole contiguous away stretch, never one throttled
// wake-up's slice of it: while the tab is hidden, each boundary's gap
// buffers into `pendingAwaySeconds` (persisted, so a discard/reload/import
// reconciles into the same stretch), and the flush that classifies it
// happens once, when presence returns.
//
// These functions mutate the working copy `advance` and `apply` hand them,
// and throw NumFault on an unrepresentable figure; the boundary then
// discards the copy and returns the state it was given.

export function freshAccounting(): SessionAccounting {
  return { creditedSeconds: 0, poolSeconds: 0, pendingAwaySeconds: 0, events: [], provisionalNous: D(0) };
}

// Hidden time on a running page may still be trusted. An offline gap
// (reload/import, a suspended page, or a detected sleep) joins the same
// absence and is classified by the same honesty rules.
export type Presence = "visible" | "away" | "offline" | "suspended";

export function poolOutstanding(state: GameState): boolean {
  return (state.game.session?.accounting.poolSeconds ?? 0) > EPS;
}

// One boundary's gap, classified and applied. `seconds` is the wall-clock
// delta since the last boundary; `driftStepSeconds` is the step in
// Date.now() − (performance.timeOrigin + performance.now()) across the same
// span — a positive step past the noise floor sizes a slept gap, which is
// away even while the tab was "visible"; a negative step past the floor
// (clock rolled back) credits zero; steps inside the floor are jitter.
// Paused time is neither present nor away: it credits nothing.
// A visible boundary settles the buffered absence even when its own gap is
// zero: that is the return of presence.
export function applyGap(state: GameState, seconds: number, presence: Presence, driftStepSeconds: number): AdvanceResult {
  if (state.game.mode !== "flow" || !state.game.session) return emptyAdvanceResult();
  const accounting = state.game.session.accounting;
  const span = seconds > EPS ? seconds : 0;
  if (presence !== "visible") {
    // Same contiguous absence: buffer, never classify a throttled slice.
    accounting.pendingAwaySeconds = requireFinite(accounting.pendingAwaySeconds + span, "the away buffer");
    return emptyAdvanceResult();
  }
  if (span > 0 && driftStepSeconds < -DRIFT_NOISE_SECONDS) return emptyAdvanceResult();
  const slept = driftStepSeconds > DRIFT_NOISE_SECONDS ? Math.min(driftStepSeconds, span) : 0;
  // The slept span joins the buffered absence and flushes first, so its
  // credit clamps at the plan (spec §1); the presence that follows credits
  // live regardless, even past the target.
  accounting.pendingAwaySeconds += slept;
  const flushed = flushPendingAway(state);
  return sumResults(flushed, walkFlow(state, span - slept, "trusted"));
}

// Classifies the whole buffered absence through the trust table (spec §1).
// Sub-floor absences auto-credit silently on both modes. A planned absence
// spanning the target splits in one pass: the under-plan slice credits, the
// past-target slice goes provisional. Open-ended absences past the floor go
// wholly provisional.
export function flushPendingAway(state: GameState): AdvanceResult {
  if (state.game.mode !== "flow") return emptyAdvanceResult();
  const session = state.game.session;
  if (!session) return emptyAdvanceResult();
  const accounting = session.accounting;
  const seconds = accounting.pendingAwaySeconds;
  if (seconds <= EPS) return emptyAdvanceResult();
  accounting.pendingAwaySeconds = 0;
  const trusted = seconds < RECONCILIATION_FLOOR_SECONDS ? seconds
    : Math.min(seconds, Math.max(0, (session.target ?? 0) - session.elapsed));
  // The buffer belongs to the same transaction as both sides of the plan:
  // a fault in either walk keeps the absence for a later retry.
  let result = trusted > 0 ? walkFlow(state, trusted, "trusted") : emptyAdvanceResult();
  if (seconds > trusted) result = sumResults(result, walkFlow(state, seconds - trusted, "provisional"));
  return result;
}

export interface HonestyResolution {
  ok: boolean;
  reason?: string;
  // Intention occurrences the credited provisional minutes completed.
  completions?: number;
}

// The honesty report's answer (spec §2): settles the whole outstanding pool
// and its provisional nous in one move. Didn't practice credits nothing and
// drops the provisional nous; did what I planned credits up to the plan
// (C rises to max(C, T)); practiced the whole time away credits fully. Both
// non-missed answers bank the provisional nous. The recorded event is the
// reconciliation's factual line. Throws NumFault on an unrepresentable
// figure; `apply` then returns the state it was given.
export function settleHonestyReport(state: GameState, outcome: HonestyOutcome): HonestyResolution {
  if (state.game.mode !== "flow") return { ok: false, reason: "No session is running." };
  const session = state.game.session;
  if (!session) return { ok: false, reason: "No session is running." };
  const accounting = session.accounting;
  if (accounting.poolSeconds <= EPS) return { ok: false, reason: "No provisional time is waiting." };
  if (outcome === "planned" && session.target === null) {
    return { ok: false, reason: "There is no plan to match." };
  }
  const pool = accounting.poolSeconds;
  let credit = 0;
  if (outcome === "full") credit = pool;
  else if (outcome === "planned") credit = Math.min(pool, Math.max(0, session.target! - accounting.creditedSeconds));
  let completions = 0;
  if (credit > EPS) {
    accounting.creditedSeconds = requireFinite(accounting.creditedSeconds + credit, "the credited practice time");
    accrueLivePractice(state, credit);
    completions = accrueGoalProgress(state, state.records.activeHabitId, credit);
  }
  const held = requireNotNaN(accounting.provisionalNous, "the provisional nous");
  if (outcome !== "missed" && gt(held, 0)) {
    state.game.nous = requireNotNaN(add(state.game.nous, held), "nous");
  }
  accounting.events.push({ awaySeconds: pool, outcome });
  accounting.poolSeconds = 0;
  accounting.provisionalNous = D(0);
  return { ok: true, completions };
}
