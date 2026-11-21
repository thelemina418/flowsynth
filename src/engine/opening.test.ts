import { describe, expect, it } from "vitest";
import {
  buyCell,
  buyDraftUpgrade,
  buyShelfModule,
  endSession,
  pauseSession,
  placeModule,
  startSession,
  upgradeModule,
} from "./actions";
import { BALANCE, MODULE_TYPES, SAVE_VERSION, SHELF_TYPES } from "./constants";
import { computeRates, levelCost, longGoalCost } from "./economy";
import { fresh } from "./fixtures";
import { adjacent, hex } from "./hex";
import { cellNoteOf } from "./lattice";
import { serialize, deserialize } from "./save";
import type { ShelfType } from "./types";

// The opening (board-redesign spec §8, ADR-0022): one plain synthesizer
// pre-placed at C4 on the retained three-cell footprint, an empty tray, and
// a nous grant that affords the first upgrade. No Carrier exists — as a
// type, a module, or a save field.

describe("the opening grant (ADR-0022)", () => {
  it("affords, but does not exactly equal, the first upgrade", () => {
    const s = fresh();
    expect(s.nous).toBe(BALANCE.openingGrant);
    expect(s.nous).toBeGreaterThanOrEqual(levelCost(0));
    expect(s.nous).not.toBe(levelCost(0));
    const opening = s.modules[0]!;
    expect(levelCost(opening.level)).toBeLessThanOrEqual(s.nous);
  });

  it("prices the first upgrade below the shelf floor, so the grant is pre-affordable", () => {
    const shelfFloor = Math.min(...Object.values(BALANCE.shelfPrices));
    expect(levelCost(0)).toBeLessThan(shelfFloor);
    const s = fresh();
    expect(s.nous).toBeGreaterThanOrEqual(levelCost(s.modules[0]!.level));
  });

  it("is a grant, not earnings: the accumulator starts empty", () => {
    const s = fresh();
    expect(s.totalEarned).toBe(0);
  });
});

describe("the carrierless opening board", () => {
  it("one pre-placed synthesizer at C4, an empty tray, and no Carrier anywhere", () => {
    const s = fresh();
    expect(s.modules).toHaveLength(1);
    const opening = s.modules[0]!;
    expect(opening.type).toBe("additive");
    expect(opening.pos).toEqual(hex(0, 0));
    expect(cellNoteOf(hex(0, 0))).toBe("C4");
    // No Carrier as a type, a category member, or a state field.
    expect(MODULE_TYPES.includes("carrier" as never)).toBe(false);
    expect(s.modules.some((m) => (m.type as string) === "carrier")).toBe(false);
    expect("welcomeAcked" in s).toBe(false);
  });

  it("retains the three-cell opening footprint: every cell touches the others", () => {
    const s = fresh();
    expect(s.cells).toHaveLength(3);
    for (const a of s.cells) {
      for (const b of s.cells) {
        if (a === b) continue;
        expect(adjacent(a, b), `${a.q},${a.r} ↔ ${b.q},${b.r}`).toBe(true);
      }
    }
    // The footprint reads as C4 · G4 · C5 on the lattice.
    expect(s.cells.map((c) => cellNoteOf(c)).sort()).toEqual(["C4", "C5", "G4"]);
  });

  it("the shelf's generator charges an adjacent Forge without buying a cell", () => {
    const s = fresh();
    s.nous = 1e6;
    expect(buyShelfModule(s, "generator").ok).toBe(true);
    expect(buyShelfModule(s, "forge").ok).toBe(true);
    const generator = s.modules.find((m) => m.type === "focusKeyed")!;
    const forge = s.modules.find((m) => m.type === "forge")!;
    expect(placeModule(s, generator.id, hex(1, 0)).ok).toBe(true);
    expect(placeModule(s, forge.id, hex(0, 1)).ok).toBe(true);
    generator.reserve = 60;
    const snapshot = computeRates(s, true);
    expect(snapshot.chargeStrength.get(forge.id)).toBe(1);
    expect(snapshot.forgeRate).toBe(1);
  });

  it("beat one — the first upgrade bumps the synth term and spends the grant", () => {
    const s = fresh();
    const opening = s.modules[0]!;
    const before = computeRates(s, true);
    expect(upgradeModule(s, opening.id).ok).toBe(true);
    const after = computeRates(s, true);
    expect(opening.level).toBe(1);
    expect(after.synths).toBeGreaterThan(before.synths);
    expect(s.nous).toBeCloseTo(BALANCE.openingGrant - levelCost(0), 9);
    expect(s.totalEarned).toBe(0);
  });

  it("the grant and the opening survive a save round-trip", () => {
    const s = fresh();
    const restored = deserialize(serialize(s, 1_000)).state!;
    expect(restored.modules).toHaveLength(1);
    expect(restored.modules[0]!.pos).toEqual(hex(0, 0));
    expect(restored.nous).toBe(BALANCE.openingGrant);
    expect(SAVE_VERSION).toBe(15);
  });
});

describe("purchase windows — all nous spending is upgrade-mode-only (§3)", () => {
  it("live sessions are read-only on every purchase surface", () => {
    const s = fresh();
    s.nous = 1e6;
    startSession(s, 600);
    for (const type of SHELF_TYPES) {
      expect(buyShelfModule(s, type).ok).toBe(false);
    }
    expect(buyCell(s, hex(2, 0)).ok).toBe(false);
    expect(buyDraftUpgrade(s).ok).toBe(false);
    const opening = s.modules[0]!;
    expect(upgradeModule(s, opening.id).ok).toBe(false);
    expect(s.purchased.forge).toBe(false);
    expect(s.cellsBought).toBe(0);
    expect(opening.level).toBe(0);
    endSession(s);
    // Back in upgrade mode the same purchases go through (ADR-0019: the
    // apps were always free — there is no ladder to buy from).
    expect(buyShelfModule(s, "forge").ok).toBe(true);
    expect(buyCell(s, hex(2, 0)).ok).toBe(true);
    expect(upgradeModule(s, opening.id).ok).toBe(true);
  });

  it("paused sessions are no window either", () => {
    const s = fresh();
    s.nous = 1e6;
    startSession(s, 600);
    pauseSession(s);
    expect(buyShelfModule(s, "generator").ok).toBe(false);
    expect(buyCell(s, hex(2, 0)).ok).toBe(false);
    expect(upgradeModule(s, s.modules[0]!.id).ok).toBe(false);
  });
});

describe("the opening economy", () => {
  it("the grant reaches nothing but the first upgrade", () => {
    const s = fresh();
    const grant = s.nous;
    for (const type of SHELF_TYPES) {
      expect(grant, type).toBeLessThan(BALANCE.shelfPrices[type]);
      expect(buyShelfModule(s, type).ok).toBe(false);
    }
    // The grant reaches nothing past the first upgrade, whatever the
    // balance (ADR-0019: the apps were always free).
    expect(buyCell(s, hex(1, -1)).ok).toBe(false);
    expect(longGoalCost(0)).toBeGreaterThan(grant);
    expect(buyDraftUpgrade(s).ok).toBe(false);
    expect(s.nous).toBe(grant);
  });

  it("the shelf sells the non-synthesizer landscape only — no additive, no spacer", () => {
    expect(SHELF_TYPES).toEqual(["generator", "infusor", "forge"]);
    const s = fresh();
    s.nous = 1e6;
    for (const type of SHELF_TYPES) {
      expect(buyShelfModule(s, type).ok, type).toBe(true);
    }
    const types = new Set(s.modules.map((m) => m.type));
    expect(types.has("focusKeyed")).toBe(true);
    expect(types.has("infusor")).toBe(true);
    expect(types.has("forge")).toBe(true);
    // The shelf-sold additive is retired (ADR-0022): synthesizers come only
    // from the opening grant and forge rolls; the spacer never shelves.
    expect(buyShelfModule(s, "additive" as ShelfType).ok).toBe(false);
    expect(buyShelfModule(s, "spacer" as ShelfType).ok).toBe(false);
  });

  it("buying space and buying shelf modules record distinct purchases", () => {
    const s = fresh();
    s.nous = 1e6;
    buyCell(s, hex(2, 0));
    buyCell(s, hex(1, 1));
    buyShelfModule(s, "generator");
    expect(s.cellsBought).toBe(2);
    expect(SHELF_TYPES.filter((type) => !s.purchased[type])).toEqual(["infusor", "forge"]);
  });
});
