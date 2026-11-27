import { cellKind } from "../../engine/board";
import { FACING_NAMES, sameCell, type Cell } from "../../engine/hex";
import { className } from "../../engine/habits";
import { wallAt } from "../../engine/map";
import { categoryName, categoryOf, hasFacing, moduleName } from "../../engine/modules";
import { moduleAt } from "../../engine/placement";
import { fmtRate } from "../../engine/num";
import type { Board, BoardRates, ModuleType, OscillatorRate, OscillatorType } from "../../engine/types";

// The Hex detail's readout (issue #27; philosophy.md, Words rule 2): the
// full readout of one clicked cell, in `name · number · effect` lines. It
// reads the cached BoardRates, never recomputes them, so in flow the
// numbers are the ones ν rises by. At most five lines, one of them the
// effect line. Legs that are identity today (charge, faders, pressure)
// are left out until their chunks give them a value.

export interface DetailLine {
  text: string;
  // The cell's one effect line: what it does for the board.
  effect?: true;
}

// What closes a resonance, said from the oscillator's side, and what it
// still needs when it isn't resonating.
const RESONANCE_WORDS: Record<OscillatorType, { verb: string; needs: string } | null> = {
  sine: { verb: "between", needs: "needs Triangles on opposite sides" },
  triangle: { verb: "closes", needs: "needs two touching oscillators beside it" },
  square: { verb: "held by", needs: "needs 4 sides occupied" },
  saw: { verb: "ends", needs: "needs two oscillators in a line from it" },
  release: null,
};

export function hexDetail(board: Board, rates: BoardRates, cell: Cell): DetailLine[] {
  const kind = cellKind(board, cell);
  if (kind === "dark") return [{ text: "Dark cell · beyond this arc" }];
  if (kind === "wall") {
    const wall = wallAt(cell);
    if (wall.name === null) return [{ text: "Wall" }];
    if (wall.opens === null) return [{ text: `${wall.name} · Wall` }];
    return [{ text: `${wall.name} · Wall · opens ${className(wall.opens)}`, effect: true }];
  }
  const oscillator = rates.oscillators.find((o) => sameCell(o.cell, cell));
  if (!oscillator) {
    const placed = moduleAt(board, cell);
    if (!placed) return [{ text: "Open cell" }];
    // A modulator names its facing in compass words (issue #31).
    const facing = hasFacing(placed.module) ? ` · facing ${FACING_NAMES[placed.facing ?? 0]}` : "";
    return [{ text: nameLine(placed.module) + facing }];
  }
  return oscillatorLines(oscillator);
}

function nameLine(module: ModuleType): string {
  return `${moduleName(module)} · ${categoryName(categoryOf(module))}`;
}

function oscillatorLines(o: OscillatorRate): DetailLine[] {
  const words = RESONANCE_WORDS[o.module];
  const lines: DetailLine[] = [{ text: nameLine(o.module) }];
  const count = o.instances.length;
  if (words === null) {
    lines.push({ text: "No resonance pattern", effect: true });
  } else if (count === 0) {
    lines.push({ text: `Not resonating · ${words.needs}`, effect: true });
  } else {
    const shapes = [...new Set(o.instances.map((i) => i.partners.map((p) => moduleName(p.module)).sort().join("–")))];
    lines.push({ text: `Resonating ×${count} · ${words.verb} ${shapes.join(", ")}`, effect: true });
    lines.push({ text: `${fmtRate(o.base)} ν/s base · ×${fmtRate(o.resonance)} resonance` });
  }
  lines.push({ text: `${fmtRate(o.rate)} ν/s` });
  return lines;
}
