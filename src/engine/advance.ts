import { runBreather } from "./breather";
import { revealEntries } from "./encyclopedia";
import { discloseConsole } from "./console";
import { transact } from "./state";
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
// - 'breather' runs a taken breather on by the wall gap and pays it at its
//   deadline (engine/breather.ts, issue #41); outside one it moves nothing.
// Every commit adds the Encyclopedia entries its state reveals (issue
// #44) and shows the console once a fader is first affordable (#58). Pure: the state given is never touched. The next state comes back with
// the result; a numeric fault (a nonfinite second, a NaN Decimal) returns
// the state given and names the figure in `fault`.
export interface Advanced extends AdvanceResult {
  state: GameState;
}

export function advance(
  state: GameState,
  seconds: number,
  mode: AdvanceMode,
  presence: Presence = "visible",
  driftStepSeconds = 0,
): Advanced {
  if (mode === "upgrade") return { ...emptyAdvanceResult(), state };
  if (mode === "breather") {
    if (state.game.mode !== "breather") return { ...emptyAdvanceResult(), state };
    const ran = transact(state, (draft) => {
      runBreather(draft, seconds);
      revealEntries(draft);
      discloseConsole(draft);
    });
    if (ran.fault !== undefined) return { ...emptyAdvanceResult(), fault: ran.fault, state };
    return { ...emptyAdvanceResult(), state: ran.state };
  }
  const done = transact(state, (draft) => {
    const gap = applyGap(draft, seconds, presence, driftStepSeconds);
    revealEntries(draft);
    discloseConsole(draft);
    return gap;
  });
  if (done.fault !== undefined) return { ...emptyAdvanceResult(), fault: done.fault, state };
  return { ...done.result, state: done.state };
}
