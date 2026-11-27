import { formatClock, formatDuration } from "../../engine/clock";
import { fmt } from "../../engine/num";
import type { HonestyOutcome, SessionState } from "../../engine/types";

// The honesty report (issue #40), ported from the old console's exit
// report (`8ecaeac^` render.ts renderHonestyModal, focus.ts
// OUTCOME_PHRASES): shown only at End, only while provisional time is
// owed. The readout leads, the one reassurance stays visible, and each
// answer carries its consequence. It can't be dismissed: the answer
// settles the pool, then the session ends.

interface Option {
  outcome: HonestyOutcome;
  label: string;
  consequence: string;
}

interface Props {
  session: SessionState;
  error: string | null;
  onAnswer: (outcome: HonestyOutcome) => void;
}

export function HonestyReport({ session, error, onAnswer }: Props) {
  const pool = session.accounting.poolSeconds;
  const held = fmt(session.accounting.provisionalNous);
  const target = session.target;
  const options: Option[] = [
    { outcome: "missed", label: "Didn't practice", consequence: `the ${held} ν drop; those minutes don't count` },
    ...(target !== null
      ? [{ outcome: "planned" as const, label: "Did what I planned", consequence: `credit rises to your ${formatClock(target)} plan; the ν banks` }]
      : []),
    { outcome: "full", label: "Practiced the whole time away", consequence: `all ${formatDuration(pool)} count; the ν banks` },
  ];
  return (
    <section class="shell-panel honesty-report" aria-labelledby="honesty-title">
      <p class="eyebrow">BEFORE YOU WRAP UP</p>
      <h2 id="honesty-title" class="shell-title">
        While you were away
      </h2>
      <div class="honesty-readout">
        <p class="honesty-row">
          <span class="mono">{`${formatDuration(pool)} away${target !== null ? " · past your plan" : ""}`}</span>
          <span class="mono">{`${held} ν held`}</span>
        </p>
        <p class="muted">Nothing already banked is taken back.</p>
      </div>
      <div class="honesty-choices">
        {options.map((option) => (
          <button type="button" key={option.outcome} class="honesty-choice" data-honesty={option.outcome} onClick={() => onAnswer(option.outcome)}>
            <span class="honesty-label">{option.label}</span>
            <small class="honesty-consequence mono">{option.consequence}</small>
          </button>
        ))}
      </div>
      {error !== null && (
        <p class="shell-refusal" data-refusal="" role="status">
          {error}
        </p>
      )}
    </section>
  );
}
