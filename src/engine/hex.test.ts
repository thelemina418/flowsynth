import { describe, expect, it } from "vitest";
import { DIRECTIONS, distance, hexKey, lifetimeCells, LIFETIME_RADIUS, mirror, neighbours, ring, ringCells, rotate, toPixel } from "./hex";

// The board's geometry (spec chunk 02, issue #24): axial (q, r) cells,
// flat-top drawing.

describe("hex distance and ring", () => {
  it("measures steps between cells", () => {
    expect(distance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
    expect(distance({ q: 0, r: 0 }, { q: 1, r: -1 })).toBe(1);
    expect(distance({ q: -1, r: 1 }, { q: 2, r: -1 })).toBe(3);
    expect(distance({ q: 2, r: 3 }, { q: -3, r: 0 })).toBe(8);
  });

  it("a cell's ring is its distance from (0,0)", () => {
    expect(ring({ q: 0, r: 0 })).toBe(0);
    expect(ring({ q: -1, r: 1 })).toBe(1);
    expect(ring({ q: 2, r: -1 })).toBe(2);
    expect(ring({ q: 5, r: -5 })).toBe(5);
  });

  it("ring n holds 6n cells, each at distance n", () => {
    expect(ringCells(0)).toEqual([{ q: 0, r: 0 }]);
    for (const n of [1, 2, 3, 5]) {
      const cells = ringCells(n);
      expect(cells).toHaveLength(6 * n);
      expect(new Set(cells.map(hexKey)).size).toBe(6 * n);
      for (const cell of cells) expect(ring(cell)).toBe(n);
    }
  });

  it("the lifetime board has radius 5 and 91 cells", () => {
    expect(LIFETIME_RADIUS).toBe(5);
    const cells = lifetimeCells();
    expect(cells).toHaveLength(91);
    expect(new Set(cells.map(hexKey)).size).toBe(91);
    expect(Math.max(...cells.map(ring))).toBe(5);
  });
});

describe("neighbours", () => {
  it("lists the six neighbours clockwise on screen, from upper-right", () => {
    expect(neighbours({ q: 0, r: 0 })).toEqual([
      { q: 1, r: -1 },
      { q: 1, r: 0 },
      { q: 0, r: 1 },
      { q: -1, r: 1 },
      { q: -1, r: 0 },
      { q: 0, r: -1 },
    ]);
    expect(neighbours({ q: 2, r: -1 })[3]).toEqual({ q: 1, r: 0 });
  });

  it("the direction order matches flat-top drawing: -30°, then 60° clockwise each", () => {
    DIRECTIONS.forEach((d, i) => {
      const { x, y } = toPixel(d, 1);
      // Screen y points down, so a clockwise turn is a growing angle.
      const angle = (Math.atan2(y, x) * 180) / Math.PI;
      expect(angle).toBeCloseTo(((-30 + 60 * i + 180) % 360) - 180, 6);
      expect(Math.hypot(x, y)).toBeCloseTo(Math.sqrt(3), 6);
    });
  });

  it("every neighbour is one step away", () => {
    for (const n of neighbours({ q: -2, r: 3 })) expect(distance(n, { q: -2, r: 3 })).toBe(1);
  });
});

describe("rotation and mirroring", () => {
  it("rotating by 60° turns each direction into the next", () => {
    DIRECTIONS.forEach((d, i) => expect(rotate(d, 1)).toEqual(DIRECTIONS[(i + 1) % 6]));
  });

  it("six turns come back, negative turns go the other way, and rotation keeps the ring", () => {
    const cell = { q: 2, r: -3 };
    expect(rotate(cell, 6)).toEqual(cell);
    expect(rotate(cell, 0)).toEqual(cell);
    expect(rotate(rotate(cell, 2), -2)).toEqual(cell);
    expect(rotate(cell, -1)).toEqual(rotate(cell, 5));
    for (let k = 0; k < 6; k++) expect(ring(rotate(cell, k))).toBe(ring(cell));
    expect(rotate({ q: 1, r: 0 }, 3)).toEqual({ q: -1, r: 0 });
  });

  it("mirroring flips the drawing top to bottom, and twice is the identity", () => {
    expect(mirror({ q: 1, r: -1 })).toEqual({ q: 1, r: 0 });
    expect(mirror({ q: 0, r: 1 })).toEqual({ q: 0, r: -1 });
    expect(mirror({ q: -1, r: 0 })).toEqual({ q: -1, r: 1 });
    const cell = { q: 3, r: -1 };
    expect(mirror(mirror(cell))).toEqual(cell);
    const a = toPixel(cell, 1);
    const b = toPixel(mirror(cell), 1);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(-a.y, 9);
  });
});
