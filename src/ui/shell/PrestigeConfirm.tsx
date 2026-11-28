import { useEffect } from "preact/hooks";
import { fmt, type Num } from "../../engine/num";

// The prestige confirmation (spec chunk 06, issue #62): two plain lists in
// the spec's words, what resets and what stays, and the Arete the era is
// worth now, in the Arete register. Esc cancels, like Cancel.
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
        <h2 id="prestige-title" class="sr-only">
          Prestige
        </h2>
        <p class="mono" data-line="">
          <span class="prestige-label">Resets</span>
          {" · ν · fader levels"}
        </p>
        <p class="mono" data-line="">
          <span class="prestige-label">Keeps</span>
          {" · board · cables · classes · allowance · Arete · walls conquered"}
        </p>
        <p class="mono prestige-gain" data-line="">{`Arete +${fmt(gain)}`}</p>
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
