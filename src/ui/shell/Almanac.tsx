import { useEffect, useState } from "preact/hooks";
import type { Shell } from "./shell";
import { AlmanacHabits } from "./AlmanacHabits";
import { AlmanacHistory } from "./AlmanacHistory";
import { AlmanacIntentions } from "./AlmanacIntentions";
import { Notes } from "./Notes";
import "./almanac.css";

// The Almanac (spec chunk 04, issue #43): a planning view with no effect
// on the board, reached from upgrade mode only. One panel, four surfaces,
// each its own file: habits, Intentions, Notes and history. A refusal is
// one quiet line under the surface. Escape closes it.

type Surface = "habits" | "intentions" | "notes" | "history";

const SURFACES: readonly [Surface, string][] = [
  ["habits", "Habits"],
  ["intentions", "Intentions"],
  ["notes", "Notes"],
  ["history", "History"],
];

export function Almanac({ shell, error }: { shell: Shell; error: string | null }) {
  const [surface, setSurface] = useState<Surface>("habits");
  const state = shell.state.value;
  const close = () => shell.closeAlmanac();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") shell.closeAlmanac();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shell]);

  return (
    <section class="shell-panel almanac" aria-labelledby="almanac-title">
      <div class="almanac-head">
        <h2 id="almanac-title" class="shell-title">
          Almanac
        </h2>
        <button type="button" class="quiet small" onClick={close}>
          Close
        </button>
      </div>
      <div class="almanac-tabs" role="group" aria-label="Almanac surfaces">
        {SURFACES.map(([key, label]) => (
          <button type="button" key={key} class="small" aria-pressed={surface === key} onClick={() => setSurface(key)}>
            {label}
          </button>
        ))}
      </div>
      {surface === "habits" && <AlmanacHabits state={state} now={shell.now()} onAct={(action) => shell.almanacAct(action)} />}
      {surface === "intentions" && <AlmanacIntentions state={state} onAct={(action) => shell.almanacAct(action)} />}
      {surface === "notes" && <Notes state={state} onCapture={(text) => shell.almanacAct((now) => ({ type: "writeNote", text, now }))} />}
      {surface === "history" && <AlmanacHistory state={state} />}
      {error !== null && (
        <p class="shell-refusal" data-refusal="" role="status">
          {error}
        </p>
      )}
    </section>
  );
}
