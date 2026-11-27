import { NumFault } from "./num";
import { cloneState, requireNoNaN, restoreState } from "./state";
import { applyGap, type Presence } from "./trust";
import { emptyAdvanceResult } from "./walk";
import type { AdvanceMode, AdvanceResult, GameState } from "./types";

// The only way time passes (spec chunk 01). `mode` is how the time passes:
// - 'upgrade' freezes everything: no board resource, wall or session fact
//   moves, however long the player stays (ADR-0001).
// - 'flow' runs the trust layer (ADR-0019): `presence` and
//   `driftStepSeconds` describe the boundary that measured the gap (see
//   trust.applyGap). A visible boundary first settles any buffered absence,
//   so `advance(s, 0, 'flow')` is the return-of-presence flush.
// - 'breather' is reserved for chunk 04 and moves nothing yet.
// The update is all-or-nothing: a numeric fault (a nonfinite second, a NaN
// Decimal) restores the state it was given and names the figure in `fault`.
export function advance(
  state: GameState,
  seconds: number,
  mode: AdvanceMode,
  presence: Presence = "visible",
  driftStepSeconds = 0,
): AdvanceResult {
  if (mode !== "flow") return emptyAdvanceResult();
  const pristine = cloneState(state);
  try {
    const result = applyGap(state, seconds, presence, driftStepSeconds);
    requireNoNaN(state);
    return result;
  } catch (error) {
    if (!(error instanceof NumFault)) throw error;
    restoreState(state, pristine);
    return { ...emptyAdvanceResult(), fault: error.detail };
  }
}
