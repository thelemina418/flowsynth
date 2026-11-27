import { EPS } from "./constants";
import { NumericFault, requireFinite } from "./numeric";
import { accrueLivePractice } from "./habits";
import { accrueGoalProgress } from "./goals";
import type { AdvanceResult, GameState } from "./types";

// The interim advance (issue #15): with the board retired, time moves only
// the session's practice facts. Trusted time — present, or away under the
// plan — credits practice: the session clock, credited seconds, the active
// habit, and its goal. Provisional time runs the session clock and joins
// the pool; it credits nothing until the honesty report settles it (§3).
// Issue #17 replaces this with `advance(state, seconds, mode)`.
export type AdvanceSink = "trusted" | "provisional";

export function emptyAdvanceResult(): AdvanceResult {
  return { goalsCompleted: 0 };
}

export function sumResults(a: AdvanceResult, b: AdvanceResult): AdvanceResult {
  return { goalsCompleted: a.goalsCompleted + b.goalsCompleted, fault: a.fault ?? b.fault };
}

function walkFlow(state: GameState, seconds: number, sink: AdvanceSink): AdvanceResult {
  const result = emptyAdvanceResult();
  const session = state.session;
  if (state.mode !== "flow" || !session || seconds <= 0) return result;
  session.elapsed = requireFinite(session.elapsed + seconds, "the session clock");
  const accounting = session.accounting;
  if (sink === "provisional") {
    accounting.poolSeconds = requireFinite(accounting.poolSeconds + seconds, "the provisional pool");
    return result;
  }
  accounting.creditedSeconds = requireFinite(accounting.creditedSeconds + seconds, "the credited practice time");
  if (seconds > EPS) {
    accrueLivePractice(state, seconds);
    result.goalsCompleted += accrueGoalProgress(state, state.activeHabitId, seconds);
  }
  return result;
}

// The refusal wrapper (issue #486): a numeric fault restores the state the
// walk was given, and the refusal rides the result's fault detail.
export function advance(state: GameState, seconds: number, sink: AdvanceSink = "trusted"): AdvanceResult {
  const pristine = structuredClone(state);
  try {
    return walkFlow(state, seconds, sink);
  } catch (error) {
    if (!(error instanceof NumericFault)) throw error;
    Object.assign(state, pristine);
    return { ...emptyAdvanceResult(), fault: error.detail };
  }
}
