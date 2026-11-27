import { cableName } from "../../engine/cables";
import { moduleName } from "../../engine/modules";
import type { CableType, ModuleType } from "../../engine/types";
import { startDrag } from "./drag";
import { CableIcon, GlyphIcon } from "./glyphs";
import type { Placing } from "./placing";

// The tray (issue #25): one entry per arrived type, beside the board, until
// chunk 04 turns it into the allowance chips. An entry is a clear outline
// while it can be placed, a muted one when allowance is spent or the board
// is locked, and a firm inset while picked. With a placed module picked,
// any entry takes it back to unplaced. After the modules, one entry per
// arrived cable type reads the unused cable allowance (issue #33),
// `1 Patch cable`; with a placed cable's plug picked, any entry unplugs it.
interface TrayProps {
  arrived: ModuleType[];
  cables: CableType[];
  placing: Placing;
  onDrop: (target: Element | null) => void;
}

export function Tray({ arrived, cables, placing, onDrop }: TrayProps) {
  const pick = placing.pick.value;
  const unused = placing.unusedCables();
  const returning = pick?.from === "cell" || pick?.from === "plug";
  return (
    <div class="tray" data-tray="" data-returning={returning ? "" : undefined} role="group" aria-label="Unplaced">
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
      {cables.map((cable) => {
        const picked = (pick?.from === "cable" || pick?.from === "jack") && pick.cable === cable;
        return (
          <button
            key={cable}
            type="button"
            class="tray-entry"
            data-cable={cable}
            data-picked={picked ? "" : undefined}
            aria-pressed={picked ? "true" : "false"}
            disabled={!placing.canTakeCable()}
            onClick={() => placing.clickCable(cable)}
          >
            <CableIcon />
            {`${unused} ${cableName(cable)} ${unused === 1 ? "cable" : "cables"}`}
          </button>
        );
      })}
    </div>
  );
}
