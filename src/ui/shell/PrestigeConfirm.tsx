import { useEffect } from "preact/hooks";
import { fmt, type Num } from "../../engine/num";

// The prestige confirmation (spec chunk 06, issue #62), the spec's block:
//
//   Prestige
//   Resets   ν · fader levels
//   Keeps    board · cables · classes · allowance · Arete · walls conquered
//   Arete +7
//                              [Cancel] [Prestige]
//
// Two plain lists, each its label then the list in a column of its own,
// and the Arete the era is worth now, in the Arete register. Esc cancels,
// like Cancel.
interface Props {
  gain: Num;
  onCancel: () => void;
  onConfirm: () => void;
}

export function PrestigeConfirm({ gain, onCancel, onConfirm }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div class="prestige-scrim">
      <section class="shell-panel prestige-confirm" role="dialog" aria-modal="true" aria-labelledby="prestige-title" data-prestige-confirm="">
        <h2 id="prestige-title" class="shell-title">
          Prestige
        </h2>
        <div class="prestige-lists mono">
          <p class="prestige-list" data-list="">
            <span class="prestige-label">Resets</span>
            <span>ν · fader levels</span>
          </p>
          <p class="prestige-list" data-list="">
            <span class="prestige-label">Keeps</span>
            <span>board · cables · classes · allowance · Arete · walls conquered</span>
          </p>
        </div>
        <p class="mono prestige-gain" data-gain="">{`Arete +${fmt(gain)}`}</p>
        <div class="shell-actions">
          <button type="button" class="quiet" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" class="primary arete" onClick={onConfirm} autoFocus>
            Prestige
          </button>
        </div>
      </section>
    </div>
  );
}
