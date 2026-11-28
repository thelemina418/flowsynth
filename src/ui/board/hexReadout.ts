import { cellKind, wallHp } from "../../engine/board";
import { FACING_NAMES, ring, sameCell, type Cell } from "../../engine/hex";
import { className } from "../../engine/habits";
import { modifierName, wallOf } from "../../engine/map";
import { categoryName, categoryOf, moduleName, takesCharge } from "../../engine/modules";
import { cableFrom, moduleAt } from "../../engine/placement";
import { fmtHp, fmtPercent, fmtRate, gt } from "../../engine/num";
import { wallRateAt } from "../../engine/rates";
import type { ArmRate, Board, BoardRates, ModulatorRate, ModuleType, OscillatorRate, OscillatorType, ReachHolds } from "../../engine/types";

// The Hex detail's readout (issue #27; philosophy.md, Words rule 2): the
// full readout of one clicked cell, in `name · number · effect` lines. It
// reads the cached BoardRates, never recomputes them, so in flow the
// numbers are the ones ν rises by. At most five lines, one of them the
// effect line. A leg shows only while it isn't identity: resonance while
// resonating, charge while charge is received (issue #32), pressure while
// a wall presses on it (issue #52); faders wait for chunk 06.

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
  if (kind === "wall") return wallLines(board, rates, cell);
  const oscillator = rates.oscillators.find((o) => sameCell(o.cell, cell));
  if (oscillator) return oscillatorLines(oscillator);
  const modulator = rates.modulators.find((m) => sameCell(m.cell, cell));
  if (modulator) return modulatorLines(board, modulator);
  const arm = rates.arms.find((a) => sameCell(a.cell, cell));
  if (arm) return armLines(arm);
  const placed = moduleAt(board, cell);
  if (!placed) return [{ text: "Open cell" }];
  return [{ text: nameLine(placed.module) }];
}

// A wall's static lines (issue #48): its name, ring and the class it
// opens; its HP and regen; its modifier by name; its pressure, doubled for
// `Pressure ×2`, and the bordering oscillators it reduces (issue #52). Once
// a Patch targets it, the damage it takes is its effect line (issue #34).
// The HP is the board's, live in flow (issue #49); the rest is the wall's
// rate (spec chunk 05).
function wallLines(board: Board, rates: BoardRates, cell: Cell): DetailLine[] {
  const wall = wallOf(cell);
  const rate = wallRateAt(rates, cell);
  const opens = wall.opens === null ? "" : ` · opens ${className(wall.opens)}`;
  const lines: DetailLine[] = [
    { text: `${wall.name} · Wall · ring ${ring(cell)}${opens}` },
    { text: `${fmtHp(wallHp(board, cell))} / ${fmtHp(rate.full)} HP · regen ${fmtRate(rate.regen)}/s` },
  ];
  if (wall.modifier !== null) lines.push({ text: modifierName(wall.modifier) });
  const on = rate.pressed === 0 ? "" : ` on ${modules(rate.pressed)}`;
  lines.push({ text: `Pressure ${fmtPercent(rate.pressure)}%${on}` });
  if (gt(rate.damage, 0)) lines.push({ text: `Taking ${fmtRate(rate.damage)}/s`, effect: true });
  return lines;
}

// `1 module`, `2 modules`.
function modules(count: number): string {
  return `${count} ${count === 1 ? "module" : "modules"}`;
}

// A modulator names its facing in compass words (issue #31), then its
// output and the oscillators its reach charges, nearest first (issue #32),
// or, once patched, its Patch's target (issue #33).
function modulatorLines(board: Board, m: ModulatorRate): DetailLine[] {
  const facing = m.facing === null ? "" : ` · facing ${FACING_NAMES[m.facing]}`;
  const name = { text: nameLine(m.module) + facing };
  if (cableFrom(board, m.cell)) {
    const { cell, holds } = m.deliveries[0]!;
    return [name, { text: `${fmtRate(m.output)} charge/s · patched → ${targetName(cell, holds)}`, effect: true }];
  }
  const charged = m.deliveries.flatMap((d) => (takesCharge(d.holds) ? [moduleName(d.holds)] : []));
  const reach = charged.length === 0 ? "no module in reach" : `reach → ${charged.join(", ")}`;
  return [name, { text: `${fmtRate(m.output)} charge/s · ${reach}`, effect: true }];
}

// A Blade names its facing, the charge it receives, and as its effect the
// damage it deals to the wall it faces (issue #53). Facing a cell that
// isn't a wall, it does nothing. A Guard Plate's effect is the modules it
// shields from pressure, while it borders a wall (issue #54).
function armLines(a: ArmRate): DetailLine[] {
  if (a.role === "guard") {
    const effect = a.active ? `Cancels pressure on ${modules(a.shields)}` : "No wall in reach";
    return [{ text: nameLine(a.module) }, { text: effect, effect: true }];
  }
  const effect = a.facesWall ? `${fmtRate(a.damage)}/s to ${wallOf(a.faces).name}` : "No wall in reach";
  return [
    { text: `${nameLine(a.module)} · facing ${FACING_NAMES[a.facing]}` },
    { text: `${fmtRate(a.chargeReceived)} charge/s received` },
    { text: effect, effect: true },
  ];
}

// A Patch's target: an open cell, a module, or a wall by its name (issue
// #34). A dark cell is refused as a target.
function targetName(cell: Cell, holds: ReachHolds): string {
  switch (holds) {
    case "empty": return "Open cell";
    case "wall": return wallOf(cell).name;
    case "dark": throw new Error("a cable never targets a dark cell");
    default: return moduleName(holds);
  }
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
  // appears only when charge is received (issue #32), the pressure leg only
  // while a wall presses on it (issue #52).
  const legs = [`${fmtRate(o.base)} ν/s base`];
  if (count > 0) legs.push(`×${fmtRate(o.resonance)} resonance`);
  if (gt(o.chargeReceived, 0)) legs.push(`×${fmtRate(o.charge)} charge`);
  if (gt(o.pressure, 0)) legs.push(`−${fmtPercent(o.pressure)}% pressure`);
  if (legs.length > 1) lines.push({ text: legs.join(" · ") });
  lines.push({ text: `${fmtRate(o.rate)} ν/s` });
  return lines;
}
