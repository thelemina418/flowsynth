import type { BreatherState, GameState } from "../../engine/types";
import { Console } from "../console/Console";
import { breatherClock } from "./readouts";

// The breather's calm screen (issue #41): one line, counting down, and a
// quiet `End early`. The board runs out of sight. Beneath it the console
// (issue #58) is drawn read-only, every fader muted, as in flow: a glance
// at the next purchase, never a purchase.
interface Props {
  state: GameState;
  running: NonNullable<BreatherState["running"]>;
  onEndEarly: () => void;
}

export function Breather({ state, running, onEndEarly }: Props) {
  return (
    <>
      <section class="breather-screen" data-breather="" aria-label="Breather">
        <p class="breather-line">
          Step away. The board is running.{" "}
          <span class="breather-clock mono" role="timer" data-breather-clock="">
            {breatherClock(running)}
          </span>
        </p>
        <button type="button" class="quiet" onClick={onEndEarly}>
          End early
        </button>
      </section>
      <div class="breather-console">
        <Console state={state} live={false} onBuy={() => undefined} />
      </div>
    </>
  );
}
