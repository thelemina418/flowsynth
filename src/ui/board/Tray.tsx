import { cableName } from "../../engine/cables";
import { categoryName, categoryOf, moduleName } from "../../engine/modules";
import type { CableType, ModuleCategory, ModuleType } from "../../engine/types";
import { startDrag } from "./drag";
import { CableIcon, GlyphIcon } from "./glyphs";
import type { Placing } from "./placing";

// The tray (issue #25): one entry per arrived type, beside the board, in
// a group per category (issue #38). Once a session has completed, each
// group is headed by its count chip, its unplaced allowance
// (`Oscillators 1`), muted at 0 and never removed; on the first screen
// there are no chips. An entry is a clear outline while it can be placed,
// a muted one when allowance is spent or the board is locked, and a firm
// inset while picked. With a placed module picked, any entry takes it
// back to unplaced. After the modules, one entry per arrived cable type
// reads the unused cable allowance (issue #33), `1 Patch cable`: that
// count is the cables' chip. With a placed cable's plug picked, any entry
// unplugs it. Once Roadie opens, an `Arms <n>` group follows the cables
// (issue #53).
interface TrayProps {
  arrived: ModuleType[];
  cables: CableType[];
  // The unplaced allowance per category.
  unplaced: Record<ModuleCategory, number>;
  chips: boolean;
  placing: Placing;
  onDrop: (target: Element | null) => void;
}

const CATEGORIES: readonly ModuleCategory[] = ["oscillator", "modulator"];

export function Tray({ arrived, cables, unplaced, chips, placing, onDrop }: TrayProps) {
  const pick = placing.pick.value;
  const unused = placing.unusedCables();
  const returning = pick?.from === "cell" || pick?.from === "plug";
  const group = (category: ModuleCategory) => (
    <div key={category} class="tray-group" data-group={category}>
      {chips && (
        <p class="tray-chip mono" data-chip={category} data-muted={unplaced[category] === 0 ? "" : undefined}>
          {`${categoryName(category)}s ${unplaced[category]}`}
        </p>
      )}
      {arrived.filter((module) => categoryOf(module) === category).map((module) => {
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
  return (
    <div class="tray" data-tray="" data-returning={returning ? "" : undefined} role="group" aria-label="Unplaced">
      {CATEGORIES.map((category) => group(category))}
      <div class="tray-group" data-group="cable">
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
      {/* Arms follow the cables entry once Roadie brings them (issue #53). */}
      {arrived.some((module) => categoryOf(module) === "arm") && group("arm")}
    </div>
  );
}
