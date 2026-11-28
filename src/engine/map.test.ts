import { describe, expect, it } from "vitest";
import { boardCells, OPENING_CELLS } from "./board";
import { fresh } from "./fixtures";
import { cellKey, lifetimeCells, ring, type Cell } from "./hex";
import { wallAt } from "./map";

// The authored map (spec chunk 05, issue #48), through its public readers:
// `wallAt` and the board's cell kinds. All 91 cells are authored: the four
// opening cells, then 87 walls, each with a kind, and a modifier and a
// class mark where it has them.

// The bands, from mechanics-sketch.md's Walls table.
const BANDS: Record<string, [number, number]> = {
  Shale: [1, 1],
  Basalt: [1, 1],
  Flint: [1, 2],
  Schist: [2, 2],
  Gneiss: [2, 3],
  Obsidian: [3, 3],
  Granite: [3, 4],
  Quartz: [4, 4],
  Corundum: [4, 5],
};

const isOpening = (cell: Cell) => OPENING_CELLS.some((o) => cellKey(o) === cellKey(cell));
const walls = () => lifetimeCells().filter((c) => !isOpening(c)).map((cell) => ({ cell, wall: wallAt(cell)! }));
const brief = (cell: Cell) => {
  const w = wallAt(cell)!;
  return { name: w.name, modifier: w.modifier, opens: w.opens };
};

describe("the authored map", () => {
  it("has 91 cells: the 4 opening cells and 87 walls", () => {
    expect(lifetimeCells()).toHaveLength(91);
    for (const cell of OPENING_CELLS) expect(wallAt(cell)).toBeNull();
    expect(walls().filter((w) => w.wall !== null)).toHaveLength(87);
  });

  it("puts every wall's kind in its band", () => {
    for (const { cell, wall } of walls()) {
      const [inner, outer] = BANDS[wall.name]!;
      expect(ring(cell), `${wall.name} at ${cellKey(cell)}`).toBeGreaterThanOrEqual(inner);
      expect(ring(cell), `${wall.name} at ${cellKey(cell)}`).toBeLessThanOrEqual(outer);
    }
  });

  it("gives each kind its HP, regen and pressure", () => {
    const shale = wallAt({ q: -1, r: 1 })!;
    expect([shale.hp.toNumber(), shale.regen.toNumber(), shale.pressure]).toEqual([600, 0.1, 0.05]);
    const basalt = wallAt({ q: 0, r: -1 })!;
    expect([basalt.hp.toNumber(), basalt.regen.toNumber(), basalt.pressure]).toEqual([6e3, 1, 0.08]);
    const flint = wallAt({ q: 0, r: -2 })!;
    expect([flint.hp.toNumber(), flint.regen.toNumber(), flint.pressure]).toEqual([6e4, 10, 0.1]);
    const edge = wallAt({ q: -5, r: 0 })!;
    expect([edge.name, edge.hp.toNumber(), edge.regen.toNumber(), edge.pressure]).toEqual(["Corundum", 1e16, 1e11, 0.4]);
  });

  it("authors ring 1: Shale, the doubled Basalt and the plain Basalt", () => {
    expect(brief({ q: -1, r: 1 })).toEqual({ name: "Shale", modifier: null, opens: null });
    expect(brief({ q: -1, r: 0 })).toEqual({ name: "Basalt", modifier: "pressureDouble", opens: null });
    expect(brief({ q: 0, r: -1 })).toEqual({ name: "Basalt", modifier: null, opens: null });
  });

  it("authors ring 2: the marked Flint, the marked Schist, and Flint and Schist alternating clockwise from (2,-2)", () => {
    expect(brief({ q: 0, r: -2 })).toEqual({ name: "Flint", modifier: "armOnly", opens: "roadie" });
    expect(brief({ q: -2, r: 1 })).toEqual({ name: "Schist", modifier: null, opens: "mixer" });
    const clockwise: [Cell, string][] = [
      [{ q: 2, r: -2 }, "Flint"],
      [{ q: 2, r: -1 }, "Schist"],
      [{ q: 2, r: 0 }, "Flint"],
      [{ q: 1, r: 1 }, "Schist"],
      [{ q: 0, r: 2 }, "Flint"],
      [{ q: -1, r: 2 }, "Schist"],
      [{ q: -2, r: 2 }, "Flint"],
      [{ q: -2, r: 0 }, "Schist"],
      [{ q: -1, r: -1 }, "Flint"],
      [{ q: 1, r: -2 }, "Schist"],
    ];
    for (const [cell, name] of clockwise) expect(brief(cell)).toEqual({ name, modifier: null, opens: null });
  });

  it("places the marked Flint behind Basalt (0,-1), bordering no opening cell", () => {
    const flint = { q: 0, r: -2 };
    expect(OPENING_CELLS.some((o) => ring({ q: o.q - flint.q, r: o.r - flint.r }) === 1)).toBe(false);
    expect(ring({ q: 0 - flint.q, r: -1 - flint.r })).toBe(1);
  });

  it("carries exactly two modifiers inside radius 2, one of each kind, and at most 1 in 6 overall", () => {
    const modified = walls().filter((w) => w.wall.modifier !== null);
    const sketch = modified.filter((w) => ring(w.cell) <= 2).map((w) => w.wall.modifier);
    expect(sketch.sort()).toEqual(["armOnly", "pressureDouble"]);
    expect(modified.length * 6).toBeLessThanOrEqual(87);
  });

  it("marks only Flint and the Schist", () => {
    const marked = walls().filter((w) => w.wall.opens !== null).map((w) => [cellKey(w.cell), w.wall.opens]);
    expect(marked).toEqual([
      ["0,-2", "roadie"],
      ["-2,1", "mixer"],
    ]);
  });

  it("reads every cell beyond Sketch's radius as dark on the opening board", () => {
    const cells = boardCells(fresh().game.board);
    expect(cells.filter((c) => c.kind === "dark").every((c) => ring(c.cell) > 2)).toBe(true);
    expect(cells.filter((c) => c.kind === "dark")).toHaveLength(72);
    expect(cells.filter((c) => c.kind === "wall")).toHaveLength(15);
  });
});
