import { EPS } from "./constants";
import { add, mul, requireFinite, requireNotNaN } from "./num";
import { accrueLivePractice } from "./habits";
import { accrueIntentionProgress } from "./intentions";
import type { AdvanceResult, GameState } from "./types";

// The flow walk: time moves the session's practice facts and the board's
// nous. Trusted time — present, or away under the plan — credits practice
// (the session clock, credited seconds, the active habit, its class, and
// its Intention) and banks nous. Provisional time runs the session clock,
// joins the pool and adds to the provisional nous; it credits nothing
// until the honesty report settles it (§3, ADR-0019). Internal to the trust
// layer: callers pass time through `advance`.
export type Sink = "trusted" | "provisional";

export function emptyAdvanceResult(): AdvanceResult {
  return { intentionsCompleted: 0 };
}

export function sumResults(a: AdvanceResult, b: AdvanceResult): AdvanceResult {
  return { intentionsCompleted: a.intentionsCompleted + b.intentionsCompleted, fault: a.fault ?? b.fault };
}

// Throws NumFault on an unrepresentable figure; the boundary refuses whole.
export function walkFlow(state: GameState, seconds: number, sink: Sink): AdvanceResult {
  const result = emptyAdvanceResult();
  const session = state.game.session;
  if (state.game.mode !== "flow" || !session || seconds <= 0) return result;
  session.elapsed = requireFinite(session.elapsed + seconds, "the session clock");
  const accounting = session.accounting;
  // The board makes nous at its cached rate (issue #26): the layout is
  // locked whenever time produces, so a span's nous is exactly rate × time.
  const made = mul(state.game.rates.total, seconds);
  if (sink === "provisional") {
    accounting.poolSeconds = requireFinite(accounting.poolSeconds + seconds, "the provisional pool");
    accounting.provisionalNous = requireNotNaN(add(accounting.provisionalNous, made), "the provisional nous");
    return result;
  }
  state.game.nous = requireNotNaN(add(state.game.nous, made), "nous");
  session.nousMade = requireNotNaN(add(session.nousMade, made), "the session's nous");
  accounting.creditedSeconds = requireFinite(accounting.creditedSeconds + seconds, "the credited practice time");
  if (seconds > EPS) {
    accrueLivePractice(state, seconds);
    result.intentionsCompleted += accrueIntentionProgress(state, state.records.activeHabitId, seconds);
  }
  return result;
}
