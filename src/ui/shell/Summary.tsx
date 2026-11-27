import type { SessionSummary } from "../../engine/types";
import { breatherMinutes, summaryLine } from "./readouts";

// The session summary (issue #40): one line, the breather it banked as a
// second (issue #41), no paragraphs, and one
// dismiss control that leads to upgrade mode. It shows until dismissed,
// across reloads. The reflection is no longer drawn.
export function Summary({ summary, onDismiss }: { summary: SessionSummary; onDismiss: () => void }) {
  return (
    <section class="shell-panel session-summary" aria-label="Session summary">
      <p class="summary-line mono" data-summary-line="">
        {summaryLine(summary)}
      </p>
      {summary.breather !== null && (
        <p class="summary-breather mono" data-summary-breather="">
          {`Breather banked · ${breatherMinutes(summary.breather)}`}
        </p>
      )}
      <div class="summary-actions">
        <button type="button" class="primary" onClick={onDismiss}>
          Continue
        </button>
      </div>
    </section>
  );
}
