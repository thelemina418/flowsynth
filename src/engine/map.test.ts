import { describe, expect, it } from "vitest";
import { boardCells } from "./board";
import { fresh } from "./fixtures";
import { wallAt } from "./map";

// The authored map's placeholder (issue #24): Shale and Flint are named,
// Flint opens Roadie, and every other wall stays nameless until chunk 05.

describe("the authored map", () => {
  it("names Shale at (-1,1), with no class mark", () => {
    expect(wallAt({ q: -1, r: 1 })).toEqual({ name: "Shale", opens: null });
  });

  it("names Flint at (2,-1), carrying the Roadie mark", () => {
    expect(wallAt({ q: 2, r: -1 })).toEqual({ name: "Flint", opens: "roadie" });
  });

  it("leaves every other wall on the opening board nameless", () => {
    const walls = boardCells(fresh().game.board).filter((c) => c.kind === "wall");
    const named = walls.map((c) => wallAt(c.cell)).filter((w) => w.name !== null);
    expect(named.map((w) => w.name)).toEqual(["Shale", "Flint"]);
    expect(wallAt({ q: 0, r: -1 })).toEqual({ name: null, opens: null });
  });
});
