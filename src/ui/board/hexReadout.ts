import { cellKind } from "../../engine/board";
import { sameHex, type Hex } from "../../engine/hex";
import { className } from "../../engine/habits";
import { wallAt } from "../../engine/map";
import { categoryName, categoryOf, moduleName, patternOf } from "../../engine/modules";
import { fmt, type Num } from "../../engine/num";
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

export function hexDetail(board: Board, rates: BoardRates, cell: Hex): DetailLine[] {
  const kind = cellKind(board, cell);
  if (kind === "dark") return [{ text: "Dark cell · beyond this arc" }];
  if (kind === "wall") {
    const wall = wallAt(cell);
    if (wall.name === null) return [{ text: "Wall" }];
    if (wall.opens === null) return [{ text: `${wall.name} · Wall` }];
    return [{ text: `${wall.name} · Wall · opens ${className(wall.opens)}`, effect: true }];
  }
  const oscillator = rates.oscillators.find((o) => sameHex(o.cell, cell));
  if (!oscillator) {
    const module = board.placements.find((p) => sameHex(p.cell, cell))?.module;
    return module ? [{ text: nameLine(module) }] : [{ text: "Open cell" }];
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
  if (words === null || patternOf(o.module) === null) {
    lines.push({ text: "No resonance pattern", effect: true });
  } else if (count === 0) {
    lines.push({ text: `Not resonating · ${words.needs}`, effect: true });
  } else {
    const shapes = [...new Set(o.instances.map((i) => i.partners.map((p) => moduleName(p.module)).sort().join("–")))];
    lines.push({ text: `Resonating ×${count} · ${words.verb} ${shapes.join(", ")}`, effect: true });
    lines.push({ text: `${rate(o.base)} ν/s base · ×${rate(o.resonance)} resonance` });
  }
  lines.push({ text: `${rate(o.rate)} ν/s` });
  return lines;
}

// Rates and factors to two decimals with at least one (1.0, 1.75, 4.5);
// from a thousand up, the game's usual figures.
function rate(value: Num): string {
  if (value.gte(1000)) return fmt(value);
  return value.toNumber().toFixed(2).replace(/(\.\d)0$/, "$1");
}
