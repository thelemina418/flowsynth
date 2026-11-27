import { cellKind } from "../../engine/board";
import { cableFrom } from "../../engine/cables";
import { FACING_NAMES, sameCell, type Cell } from "../../engine/hex";
import { className } from "../../engine/habits";
import { wallAt } from "../../engine/map";
import { categoryName, categoryOf, isOscillator, moduleName } from "../../engine/modules";
import { moduleAt } from "../../engine/placement";
import { fmtRate } from "../../engine/num";
import type { Board, BoardRates, ModulatorRate, ModuleType, OscillatorRate, OscillatorType, ReachHolds } from "../../engine/types";

// The Hex detail's readout (issue #27; philosophy.md, Words rule 2): the
// full readout of one clicked cell, in `name · number · effect` lines. It
// reads the cached BoardRates, never recomputes them, so in flow the
// numbers are the ones ν rises by. At most five lines, one of them the
// effect line. A leg shows only while it isn't identity: resonance while
// resonating, charge while charge is received (issue #32); faders and
// pressure wait for their chunks.

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
  if (kind === "wall") return wallLines(rates, cell);
  const oscillator = rates.oscillators.find((o) => sameCell(o.cell, cell));
  if (oscillator) return oscillatorLines(oscillator);
  const modulator = rates.modulators.find((m) => sameCell(m.cell, cell));
  if (modulator) return modulatorLines(board, modulator);
  const placed = moduleAt(board, cell);
  if (!placed) return [{ text: "Open cell" }];
  return [{ text: nameLine(placed.module) }];
}

// A wall names itself, and what it opens. Once a Patch targets it, its
// effect line is the damage it takes and its regen (issue #34); the opens
// note then stays on the name line.
function wallLines(rates: BoardRates, cell: Cell): DetailLine[] {
  const wall = wallAt(cell);
  const name = wall.name === null ? "Wall" : `${wall.name} · Wall`;
  const opens = wall.opens === null ? "" : ` · opens ${className(wall.opens)}`;
  const patched = rates.walls.find((w) => sameCell(w.cell, cell));
  if (!patched) return [opens ? { text: name + opens, effect: true } : { text: name }];
  const regen = patched.regen === null ? "" : ` · regen ${fmtRate(patched.regen)}/s`;
  return [{ text: name + opens }, { text: `Taking ${fmtRate(patched.damage)}/s${regen}`, effect: true }];
}

// A modulator names its facing in compass words (issue #31), then its
// output and the oscillators its reach charges, nearest first (issue #32),
// or, once patched, its Patch's target (issue #33).
function modulatorLines(board: Board, m: ModulatorRate): DetailLine[] {
  const facing = m.facing === null ? "" : ` · facing ${FACING_NAMES[m.facing]}`;
  const name = { text: nameLine(m.module) + facing };
  if (cableFrom(board, m.cell)) {
    const { cell, holds } = m.deliveries[0]!;
    // A wall target goes by its name, a placeholder as Wall (issue #34).
    const target = holds === "empty" ? "Open cell" : holds === "wall" || holds === "dark" ? (wallAt(cell).name ?? "Wall") : moduleName(holds);
    return [name, { text: `${fmtRate(m.output)} charge/s · patched → ${target}`, effect: true }];
  }
  const charged = m.deliveries.flatMap((d) => (isChargedBy(d.holds) ? [moduleName(d.holds)] : []));
  const reach = charged.length === 0 ? "no module in reach" : `reach → ${charged.join(", ")}`;
  return [name, { text: `${fmtRate(m.output)} charge/s · ${reach}`, effect: true }];
}

// Only an oscillator takes anything from charge in chunk 03.
function isChargedBy(holds: ReachHolds): holds is OscillatorType {
  return holds !== "empty" && holds !== "wall" && holds !== "dark" && isOscillator(holds);
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
  }
  // The legs line: base, then each leg that isn't identity. The charge leg
  // appears only when charge is received (issue #32).
  const legs = [`${fmtRate(o.base)} ν/s base`];
  if (count > 0) legs.push(`×${fmtRate(o.resonance)} resonance`);
  if (o.chargeReceived.gt(0)) legs.push(`×${fmtRate(o.charge)} charge`);
  if (legs.length > 1) lines.push({ text: legs.join(" · ") });
  lines.push({ text: `${fmtRate(o.rate)} ν/s` });
  return lines;
}
