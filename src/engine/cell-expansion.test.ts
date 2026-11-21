import { describe, expect, it } from "vitest";
import { buyCell, buyRowUnlock, placeModule, placeWorldOccupant, reshapeCells, retrieveWorldOccupant } from "./actions";
import { hex } from "./hex";
import { octaveRowOf } from "./lattice";
import { deserialize, recoverLostSave, serialize } from "./save";
import { createInitialState, createWorldColumn } from "./state";
import { createWorldCombatScenario } from "./world-combat-scenario";

describe("distance-priced shared footprint", () => {
  it("charges the same band across octaves in either purchase order without prestige", () => {
    const above = hex(0, 2);
    const below = hex(1, -2);
    expect(octaveRowOf(above)).not.toBe(octaveRowOf(below));
    for (const pair of [[above, below], [below, above]]) {
      const state = createInitialState();
      state.nous = 250;
      expect(buyCell(state, hex(1, -1)).ok).toBe(true);
      expect(state.nous).toBe(220);
      for (const [i, pos] of pair.entries()) {
        expect(buyCell(state, pos!).ok).toBe(true);
        expect(state.nous).toBe(220 - (i + 1) * 90);
      }
      expect(state.arete).toBe(0);
      expect(state.prestiges).toBe(0);
    }
  });

  it("buys just a connected approach past the old octave cap and charges each steeper band", () => {
    const state = createInitialState();
    state.nous = 1_890;
    expect(buyCell(state, hex(0, 4)).ok).toBe(false);
    for (const [r, remaining] of [[2, 1_800], [3, 1_440], [4, 0]] as const) {
      expect(buyCell(state, hex(0, r)).ok).toBe(true);
      expect(state.nous).toBe(remaining);
    }
    expect(state.cells).toHaveLength(6);
    expect(state.cellsBought).toBe(3);
    expect(state.arete).toBe(0);
    expect(state.prestiges).toBe(0);
  });

  it("refuses a nonfinite balance or unpriceable frontier without granting a cell", () => {
    const state = createInitialState();
    state.nous = Number.POSITIVE_INFINITY;
    expect(buyCell(state, hex(1, -1))).toMatchObject({ ok: false, reason: expect.stringContaining("safely") });
    state.nous = 100;
    state.cells = [hex(0, 512)]; // A corrupted but finite shape cannot turn an infinite quote into a purchase.
    const before = serialize(state, 1);
    expect(buyCell(state, hex(0, 513))).toMatchObject({ ok: false, reason: expect.stringContaining("safely") });
    expect(serialize(state, 1)).toBe(before);
  });

  it("keeps reshaping in-band without charging for layout or occupant moves", () => {
    const state = createInitialState();
    const before = structuredClone(state);
    expect(reshapeCells(state, [hex(0, 0), hex(1, 0), hex(2, 0)])).toMatchObject({ ok: false, reason: expect.stringContaining("distance band") });
    expect(state).toEqual(before);
    expect(reshapeCells(state, [hex(0, 0), hex(1, 0), hex(1, -1)]).ok).toBe(true);
    expect(placeModule(state, state.modules[0]!.id, hex(1, -1)).ok).toBe(true);
    expect(reshapeCells(state, before.cells).ok).toBe(false);
    expect(state.modules[0]?.pos).toEqual(hex(1, -1));
    expect(state.nous).toBe(before.nous);
    state.world.unlocked = true;
    const column = createWorldColumn(state);
    state.world.columns.push(column);
    expect(placeWorldOccupant(state, column.id, hex(1, 0)).ok).toBe(true);
    expect(reshapeCells(state, [hex(0, 0), hex(0, -1), hex(1, -1)])).toMatchObject({ ok: false, reason: expect.stringContaining("World occupant") });
    expect(placeWorldOccupant(state, column.id, hex(0, 0)).ok).toBe(true);
    expect(reshapeCells(state, [hex(0, 0), hex(0, -1), hex(1, -1)]).ok).toBe(true);
    expect(state.nous).toBe(before.nous);
  });

  it("keeps a deployed proof creature's cell even if an in-band replacement is available", () => {
    const state = createWorldCombatScenario();
    const sentinel = state.world.proof!.creature;
    state.cells = state.cells.filter(pos => pos.q !== 0 || pos.r !== -1);
    expect(placeWorldOccupant(state, sentinel.id, hex(-1, 1)).ok).toBe(true);
    const proposal = state.cells.map(pos => pos.q === -1 && pos.r === 1 ? hex(0, -1) : pos);
    expect(reshapeCells(state, proposal)).toMatchObject({ ok: false, reason: expect.stringContaining("World occupant") });
    expect(sentinel.pos).toEqual(hex(-1, 1));
    expect(retrieveWorldOccupant(state, sentinel.id).ok).toBe(true);
    expect(reshapeCells(state, proposal).ok).toBe(true);
  });

  it("retires paid Rack Extenders once without moving cells, changing pitch or resetting a finite v13 save", () => {
    const before = createInitialState();
    before.cells.push(hex(0, 2), hex(0, 3));
    before.modules[0]!.pos = hex(0, 3);
    before.modules[0]!.level = 5;
    before.nous = 456;
    before.arete = 4;
    before.cellsBought = 2;
    before.world.unlocked = before.world.starterColumnGranted = before.world.starterWeaponGranted = true;
    const column = createWorldColumn(before);
    before.world.columns.push(column);
    expect(placeWorldOccupant(before, column.id, hex(0, 3)).ok).toBe(true);
    before.achievements["first-row"] = 160;
    const raw = JSON.stringify({ app: "flowsynth", version: 13, state: { ...before, gatedRows: [0, 1, 2, 3], unlockedRows: [3, -2, 3, 9, "-2"] } });
    const loaded = deserialize(raw);
    expect(loaded.footprintMigration).toEqual({ areteRefunded: 3 });
    const state = loaded.state!;
    expect(state.cells).toEqual(before.cells);
    expect(state.modules).toEqual(before.modules);
    expect(state.world).toEqual(before.world);
    expect(state).toMatchObject({ arete: 7, nous: 456, cellsBought: 2, achievements: { "first-row": 160 } });
    const next = serialize(state, 1);
    expect(JSON.parse(next)).toMatchObject({ version: 14 });
    expect(next).not.toMatch(/gatedRows|unlockedRows/);
    expect(deserialize(next)).toEqual({ state });
    expect(buyRowUnlock(state, -2)).toMatchObject({ ok: false, reason: expect.stringContaining("retired") });
    expect(serialize(state, 1)).toBe(next);
  });

  it("does not let a Rack Extender refund conceal lost Arete before an explicit recovery", () => {
    const raw = JSON.stringify({ app: "flowsynth", version: 13, state: { ...createInitialState(), arete: null, unlockedRows: [3] } });
    expect(deserialize(raw)).toMatchObject({ recoveryRequired: true, lost: ["arete"] });
    const recovered = recoverLostSave(raw);
    expect(recovered.recovered?.lost).toEqual(["arete"]);
    expect(recovered.state?.arete).toBe(1);
    expect(deserialize(serialize(recovered.state!)).state?.arete).toBe(1);
  });
});
