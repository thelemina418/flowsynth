import { EPS } from "./constants";
import { requireFinite } from "./num";
import { accrueLivePractice } from "./habits";
import { accrueGoalProgress } from "./goals";
import type { AdvanceResult, GameState } from "./types";

// The flow walk: time moves the session's practice facts. Trusted time —
// present, or away under the plan — credits practice: the session clock,
// credited seconds, the active habit, its class, and its Intention.
// Provisional time runs the session clock and joins the pool; it credits
// nothing until the honesty report settles it (§3). Internal to the trust
// layer: callers pass time through `advance`.
export type Sink = "trusted" | "provisional";

export function emptyAdvanceResult(): AdvanceResult {
  return { goalsCompleted: 0 };
}

export function sumResults(a: AdvanceResult, b: AdvanceResult): AdvanceResult {
  return { goalsCompleted: a.goalsCompleted + b.goalsCompleted, fault: a.fault ?? b.fault };
}

// Throws NumFault on an unrepresentable figure; the boundary refuses whole.
export function walkFlow(state: GameState, seconds: number, sink: Sink): AdvanceResult {
  const result = emptyAdvanceResult();
  const session = state.game.session;
  if (state.game.mode !== "flow" || !session || seconds <= 0) return result;
  session.elapsed = requireFinite(session.elapsed + seconds, "the session clock");
  const accounting = session.accounting;
  if (sink === "provisional") {
    accounting.poolSeconds = requireFinite(accounting.poolSeconds + seconds, "the provisional pool");
    return result;
  }
  accounting.creditedSeconds = requireFinite(accounting.creditedSeconds + seconds, "the credited practice time");
  if (seconds > EPS) {
    accrueLivePractice(state, seconds);
    result.goalsCompleted += accrueGoalProgress(state, state.records.activeHabitId, seconds);
  }
  return result;
}
