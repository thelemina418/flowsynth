import { describe, expect, it } from "vitest";
import { buyRowUnlock, prestige } from "./actions";
import { ARETE_HORIZON } from "./accumulator";
import { catalogOpen } from "./catalog";
import { fresh } from "./fixtures";

// Live World offerings and retired Mutator commands have their own suites.
describe("the catalog's lock", () => {
  it("opens with the first reset and never before", () => {
    const state = fresh();
    expect(catalogOpen(state)).toBe(false);
    expect(state.arete).toBe(0);
    state.eraEarned = ARETE_HORIZON;
    expect(prestige(state).ok).toBe(true);
    expect(catalogOpen(state)).toBe(true);
  });

  it("refuses the retired Rack Extenders command even in an eligible old-era position", () => {
    const state = fresh();
    state.prestiges = 1;
    state.arete = 4;
    state.cells.push({ q: 0, r: 2 });
    const before = structuredClone(state);
    expect(buyRowUnlock(state, 3)).toMatchObject({ ok: false, reason: expect.stringContaining("retired") });
    expect(state).toEqual(before);
  });
});
