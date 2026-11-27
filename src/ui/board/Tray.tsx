import { moduleName } from "../../engine/modules";
import type { ModuleType } from "../../engine/types";
import { startDrag } from "./drag";
import { GlyphIcon } from "./glyphs";
import type { Placing } from "./placing";

// The tray (issue #25): one entry per arrived type, beside the board, until
// chunk 04 turns it into the allowance chips. An entry is a clear outline
// while it can be placed, a muted one when allowance is spent or the board
// is locked, and a firm inset while picked. With a placed module picked,
// any entry takes it back to unplaced.
export function Tray({ arrived, placing, onDrop }: { arrived: ModuleType[]; placing: Placing; onDrop: (target: Element | null) => void }) {
  const pick = placing.pick.value;
  return (
    <div class="tray" data-tray="" data-returning={pick?.from === "cell" ? "" : undefined} role="group" aria-label="Unplaced">
      {arrived.map((module) => {
        const picked = pick?.from === "tray" && pick.module === module;
        return (
          <button
            key={module}
            type="button"
            class="tray-entry"
            data-module={module}
            data-picked={picked ? "" : undefined}
            aria-pressed={picked ? "true" : "false"}
            disabled={!placing.canTake(module)}
            onClick={() => placing.clickTray(module)}
            onPointerDown={(event) => startDrag(event, { begin: () => placing.pickModule(module), drop: onDrop })}
          >
            <GlyphIcon module={module} />
            {moduleName(module)}
          </button>
        );
      })}
    </div>
  );
}
