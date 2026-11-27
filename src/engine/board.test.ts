import { describe, expect, it } from "vitest";
import { arcRadius, boardCells, cellKind } from "./board";
import { fresh } from "./fixtures";
import { cellKey, lifetimeCells, ring } from "./hex";

// The board in GameState (spec chunk 02, issue #24): the owned open cells
// and the current arc. A cell's kind is derived, never stored.

describe("a fresh board", () => {
  it("owns exactly the four opening cells, in Sketch", () => {
    const s = fresh();
    expect(s.game.board.open.map(cellKey).sort()).toEqual(["0,0", "0,1", "1,-1", "1,0"]);
    expect(s.game.board.arc).toBe("sketch");
    expect(arcRadius(s.game.board.arc)).toBe(2);
  });

  it("is open on its four cells, wall up to ring 2, and dark in rings 3 to 5", () => {
    const { board } = fresh().game;
    const kinds = lifetimeCells().map((cell) => ({ ring: ring(cell), kind: cellKind(board, cell) }));
    expect(kinds.filter((c) => c.kind === "open")).toHaveLength(4);
    expect(kinds.filter((c) => c.kind === "wall")).toHaveLength(15);
    expect(kinds.filter((c) => c.kind === "wall").every((c) => c.ring <= 2)).toBe(true);
    expect(kinds.filter((c) => c.kind === "dark")).toHaveLength(72);
    expect(kinds.filter((c) => c.ring >= 3).every((c) => c.kind === "dark")).toBe(true);
    expect(cellKind(board, { q: -1, r: 1 })).toBe("wall");
    expect(cellKind(board, { q: 3, r: 0 })).toBe("dark");
  });

  it("a cell owned beyond the arc still reads open", () => {
    const { board } = fresh().game;
    board.open.push({ q: 0, r: 3 });
    expect(cellKind(board, { q: 0, r: 3 })).toBe("open");
  });

  it("boardCells lists the lifetime board with each cell's kind", () => {
    const cells = boardCells(fresh().game.board);
    expect(cells).toHaveLength(91);
    expect(cells.find((c) => cellKey(c.cell) === "1,-1")?.kind).toBe("open");
    expect(cells.find((c) => cellKey(c.cell) === "2,-1")?.kind).toBe("wall");
  });
});
