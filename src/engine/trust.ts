import { DRIFT_NOISE_SECONDS, EPS, RECONCILIATION_FLOOR_SECONDS } from "./constants";
import { NumericFault, requireFinite } from "./numeric";
import { advance, emptyAdvanceResult, sumResults } from "./advance";
import { accrueLivePractice } from "./habits";
import { accrueGoalProgress } from "./goals";
import type { AdvanceResult, GameState, HonestyOutcome, SessionAccounting } from "./types";

export type { HonestyOutcome };

// Trust accounting (focus-tool spec §1–3, ADR-0019). Presence is visibility;
// every boundary hands this module the wall-clock gap since the last one and
// the presence state that held during it, and the session advances by that
// gap — never by tick count. Away trust runs to the plan: on a planned
// session, away time up to the target is trusted (credits silently); past
// the target — and all away time on open-ended sessions, beyond the
// reconciliation floor — it is provisional. Provisional time joins the pool
// and credits nothing until the honesty report settles it. Nothing already
// credited is ever retracted.
//
// An absence is the whole contiguous away stretch, never one throttled
// wake-up's slice of it: while the tab is hidden, each boundary's gap
// buffers into `pendingAwaySeconds` (persisted, so a discard/reload/import
// reconciles into the same stretch), and the flush that classifies it
// happens once, when presence returns.

export function freshAccounting(): SessionAccounting {
  return { creditedSeconds: 0, poolSeconds: 0, pendingAwaySeconds: 0, events: [] };
}

// Hidden time on a running page may still be trusted. An offline gap
// (reload/import, a suspended page, or a detected sleep) joins the same
// absence and is classified by the same honesty rules.
export type Presence = "visible" | "away" | "offline" | "suspended";

export function poolOutstanding(state: GameState): boolean {
  return (state.session?.accounting.poolSeconds ?? 0) > EPS;
}

// One boundary's gap, classified and applied. `seconds` is the wall-clock
// delta since the last boundary; `driftStepSeconds` is the step in
// Date.now() − (performance.timeOrigin + performance.now()) across the same
// span — a positive step past the noise floor sizes a slept gap, which is
// away even while the tab was "visible"; a negative step past the floor
// (clock rolled back) credits zero; steps inside the floor are jitter.
// Paused time is neither present nor away: it credits nothing.
export function applyGap(state: GameState, seconds: number, presence: Presence, driftStepSeconds: number): AdvanceResult {
  if (state.mode !== "flow" || !state.session) return emptyAdvanceResult();
  const accounting = state.session.accounting;
  if (seconds <= EPS) return emptyAdvanceResult();
  if (presence !== "visible") {
    // Same contiguous absence: buffer, never classify a throttled slice.
    accounting.pendingAwaySeconds += seconds;
    return emptyAdvanceResult();
  }
  if (driftStepSeconds < -DRIFT_NOISE_SECONDS) return emptyAdvanceResult();
  const slept = driftStepSeconds > DRIFT_NOISE_SECONDS ? Math.min(driftStepSeconds, seconds) : 0;
  // The slept span joins the buffered absence and flushes first, so its
  // credit clamps at the plan (spec §1); the presence that follows credits
  // live regardless, even past the target.
  accounting.pendingAwaySeconds += slept;
  const flushed = flushPendingAway(state);
  if (flushed.fault) return flushed;
  return sumResults(flushed, advance(state, seconds - slept));
}

// Classifies the whole buffered absence through the trust table (spec §1).
// Sub-floor absences auto-credit silently on both modes. A planned absence
// spanning the target splits in one pass: the under-plan slice credits, the
// past-target slice goes provisional. Open-ended absences past the floor go
// wholly provisional.
export function flushPendingAway(state: GameState): AdvanceResult {
  if (state.mode !== "flow") return emptyAdvanceResult();
  const session = state.session;
  if (!session) return emptyAdvanceResult();
  const accounting = session.accounting;
  const seconds = accounting.pendingAwaySeconds;
  if (seconds <= EPS) return emptyAdvanceResult();
  const pristine = structuredClone(state);
  accounting.pendingAwaySeconds = 0;
  const trusted = seconds < RECONCILIATION_FLOOR_SECONDS ? seconds
    : Math.min(seconds, Math.max(0, (session.target ?? 0) - session.elapsed));
  let result = trusted > 0 ? advance(state, trusted) : emptyAdvanceResult();
  if (!result.fault && seconds > trusted) result = sumResults(result, advance(state, seconds - trusted, "provisional"));
  // The buffer belongs to the same transaction as both sides of the plan:
  // a refused walk leaves the absence available for a later retry.
  if (result.fault) {
    Object.assign(state, pristine);
    return { ...emptyAdvanceResult(), fault: result.fault };
  }
  return result;
}

export interface HonestyResolution {
  ok: boolean;
  reason?: string;
  // Goal occurrences the credited provisional minutes completed.
  completions?: number;
}

// The honesty report's answer (spec §2): settles the whole outstanding pool
// in one move. Didn't practice credits nothing; did what I planned credits
// up to the plan (C rises to max(C, T)); practiced the whole time away
// credits fully. The recorded event is the reconciliation's factual line.
function settleHonestyReport(state: GameState, outcome: HonestyOutcome): HonestyResolution {
  if (state.mode !== "flow") return { ok: false, reason: "No session is running." };
  const session = state.session;
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
    completions = accrueGoalProgress(state, state.activeHabitId, credit);
  }
  accounting.events.push({ awaySeconds: pool, outcome });
  accounting.poolSeconds = 0;
  return { ok: true, completions };
}

// The settlement runs under the same all-or-nothing boundary as the walk.
export function resolveHonestyReport(state: GameState, outcome: HonestyOutcome): HonestyResolution {
  const pristine = structuredClone(state);
  try {
    return settleHonestyReport(state, outcome);
  } catch (error) {
    if (!(error instanceof NumericFault)) throw error;
    Object.assign(state, pristine);
    return { ok: false, reason: "The provisional time cannot be credited safely, so nothing was credited." };
  }
}
