import type { BreatherState } from "../../engine/types";
import { breatherResultLine } from "./readouts";

// The breather's result (issue #41): one line on the next upgrade-mode
// view, until dismissed.
export function BreatherResult({ result, onDismiss }: { result: NonNullable<BreatherState["result"]>; onDismiss: () => void }) {
  return (
    <section class="shell-panel session-summary" aria-label="Breather result">
      <p class="summary-line mono" data-breather-result="">
        {breatherResultLine(result)}
      </p>
      <div class="summary-actions">
        <button type="button" class="primary" onClick={onDismiss}>
          Continue
        </button>
      </div>
    </section>
  );
}
