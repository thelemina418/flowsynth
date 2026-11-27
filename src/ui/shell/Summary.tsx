import type { SessionSummary } from "../../engine/types";
import { summaryLine } from "./readouts";

// The session summary (issue #40): one line, no paragraphs, and one
// dismiss control that leads to upgrade mode. It shows until dismissed,
// across reloads. The reflection is no longer drawn.
export function Summary({ summary, onDismiss }: { summary: SessionSummary; onDismiss: () => void }) {
  return (
    <section class="shell-panel session-summary" aria-label="Session summary">
      <p class="summary-line mono" data-summary-line="">
        {summaryLine(summary)}
      </p>
      <div class="summary-actions">
        <button type="button" class="primary" onClick={onDismiss}>
          Continue
        </button>
      </div>
    </section>
  );
}
