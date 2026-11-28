import { useEffect, useRef } from "preact/hooks";
import { entriesOf } from "../../engine/encyclopedia";
import type { EntryId } from "../../engine/types";
import type { Shell } from "./shell";
import "./encyclopedia.css";

// The Encyclopedia (spec chunk 04, issue #44): the voluntary reference,
// ported from the old frame and trimmed. A list of revealed entries (an
// unrevealed entry is absent, never shown locked) and one entry's view.
// Opening an entry marks it seen. Escape or a tap away closes it. No
// search, groups or related links.

export function Encyclopedia({ shell, entry }: { shell: Shell; entry: EntryId | null }) {
  const panel = useRef<HTMLElement>(null);
  const entries = entriesOf(shell.state.value);
  const shown = entry === null ? null : (entries.find((e) => e.id === entry) ?? null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") shell.closeEncyclopedia();
    };
    const onTap = (event: Event) => {
      if (panel.current && event.target instanceof Node && !panel.current.contains(event.target)) shell.closeEncyclopedia();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onTap);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onTap);
    };
  }, [shell]);

  return (
    <section ref={panel} class="shell-panel encyclopedia" data-encyclopedia="" aria-labelledby="encyclopedia-title">
      <div class="encyclopedia-head">
        <h2 id="encyclopedia-title" class="shell-title">
          Encyclopedia
        </h2>
        <button type="button" class="quiet small" onClick={() => shell.closeEncyclopedia()}>
          Close
        </button>
      </div>
      {shown === null ? (
        <ul class="encyclopedia-list">
          {entries.map((e) => (
            <li key={e.id}>
              <button type="button" class="quiet" data-entry={e.id} onClick={() => shell.openEntry(e.id)}>
                {e.title}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <article class="encyclopedia-entry" data-entry-view={shown.id}>
          <button type="button" class="quiet small" onClick={() => shell.openEntry(null)}>
            ‹ Entries
          </button>
          <h3 class="encyclopedia-title">{shown.title}</h3>
          <ul class="encyclopedia-lines mono">
            {shown.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>
      )}
    </section>
  );
}
