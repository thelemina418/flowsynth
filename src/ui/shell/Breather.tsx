import type { BreatherState } from "../../engine/types";
import { breatherClock } from "./readouts";

// The breather's calm screen (issue #41): one line, counting down, and a
// quiet `End early`. The board runs out of sight; nothing else is drawn.
export function Breather({ running, onEndEarly }: { running: NonNullable<BreatherState["running"]>; onEndEarly: () => void }) {
  return (
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
  );
}
