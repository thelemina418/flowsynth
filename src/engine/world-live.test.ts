import { expect, it } from "vitest";
import { buyCell, buyHoneRank, endSession, pauseSession, placeWorldOccupant, prestige, resumeSession, retrieveWorldOccupant, setWorldGearBearer, startBreather, startSession } from "./actions";
import { advance, advanceBreather } from "./advance";
import { syncRates } from "./economy";
import { give } from "./fixtures";
import { hex } from "./hex";
import { deserialize, serialize } from "./save";
import { createInitialState, createWeapon } from "./state";
import { applyGap, flushPendingAway, resolveHonestyReport } from "./trust";
import type { GameState } from "./types";
import { activeWallOf, attackPowerOf, columnLiftsOf, enemyPenaltyOf, worldCellReserved, worldEnemiesOf, worldFactorOf, worldPiecesOf } from "./world";

const rng = () => 0.3;
const reload = (state: GameState): GameState => deserialize(serialize(state, 5_000)).state!;
function banked(): GameState {
  const state = createInitialState();
  state.eraEarned = 20_000_000;
  expect(prestige(state).ok).toBe(true);
  expect(state.world.proof).toBeUndefined();
  return state;
}
function advanceLive(state: GameState, seconds: number): void {
  expect(advance(state, seconds, rng).fault).toBeUndefined();
}
function place(state: GameState, id: string, q: number, r: number): void {
  expect(placeWorldOccupant(state, id, hex(q, r))).toMatchObject({ ok: true });
}

it("crosses many thresholds with exactly one bounded nous penalty and hands off inside the winning advance", () => {
  const initial = banked();
  // No shifted layout, grants, or pre-played fights: load a save at a
  // later era-earned checkpoint to exercise ordered pressure directly.
  initial.eraEarned = 2e15;
  initial.nous = 0;
  initial.world.enemies.shale!.hp = 2;
  const state = reload(initial);
  const [shale, basalt, ...later] = worldEnemiesOf(state);
  expect(activeWallOf(state)?.key).toBe("shale");
  expect(state.world.enemies.basalt!.discovered).toBe(false);
  for (const def of [basalt!, ...later]) expect(enemyPenaltyOf(state, def.key)).toBe(0);
  const osc = give(state, "additive", hex(0, 1));
  const source = give(state, "focusKeyed", hex(1, 0));
  source.reserve = 60;
  place(state, state.world.creatures[0]!.id, 0, 0);
  place(state, state.world.weapons[0]!.id, 1, 0);
  place(state, state.world.columns[0]!.id, 0, 1);
  const unpressed = structuredClone(state);
  for (const wall of worldEnemiesOf(unpressed)) {
    unpressed.world.enemies[wall.key]!.hp = 0;
  }
  const before = syncRates(state, true);
  const control = syncRates(unpressed, true);
  expect(before.worldFactor).toBe(0.8);
  expect(before.rate / control.rate).toBeCloseTo(0.8, 10);
  expect(before.chargeStrength.get(osc.id)).toBe(control.chargeStrength.get(osc.id));
  expect(columnLiftsOf(state, before).byWeapon.get(state.world.weapons[0]!.id)).toBeGreaterThan(0);
  const split = structuredClone(state);
  startSession(state, null);
  startSession(split, null);
  advanceLive(state, 9);
  advanceLive(split, 5);
  expect(activeWallOf(split)?.key).toBe("basalt");
  advanceLive(split, 4);
  expect(state.world.enemies[shale!.key]!.hp).toBe(0);
  expect(state.world.enemies[basalt!.key]!.hp).toBe(35);
  expect(worldFactorOf(state)).toBe(0.65);
  expect(state.nous).toBeCloseTo(split.nous, 9);
  expect(state.world.weapons[0]!.store).toBeCloseTo(split.world.weapons[0]!.store, 9);
  expect(state.world.creatures[0]!.hp).toBe(18);
});

it("releases a lifetime victory and preserves both sides' wounds through prestige and reload", () => {
  const initial = banked();
  initial.eraEarned = 200_000_000;
  initial.nous = 500;
  initial.world.enemies.shale!.hp = 0.5;
  const state = reload(initial);
  const sentinel = state.world.creatures[0]!;
  expect(worldCellReserved(state, hex(-1, 0))).toBe(true);
  expect(buyCell(state, hex(-1, 0)).ok).toBe(true);
  expect(buyCell(state, hex(2, 0)).ok).toBe(true);
  place(state, sentinel.id, 0, 0);
  startSession(state, null);
  advanceLive(state, 6);
  endSession(state);
  expect(state.world.enemies.shale!.hp).toBe(0);
  const armor = state.world.armor[0]!;
  place(state, armor.id, -1, 0);
  place(state, sentinel.id, 2, 0);
  startSession(state, null);
  advanceLive(state, 6);
  endSession(state);
  expect(sentinel.hp).toBe(10);
  expect(state.world.enemies.basalt!.hp).toBe(32);
  expect(prestige(state).ok).toBe(true);
  const saved = reload(state);
  expect(activeWallOf(saved)).toBeUndefined();
  expect(worldFactorOf(saved)).toBe(1);
  expect(saved.world.creatures[0]!.hp).toBe(10);
  expect(saved.world.enemies.basalt!.hp).toBe(32);
  expect(saved.world.enemies.shale!.hp).toBe(0);
  expect(saved.world.armor[0]!.pos).toEqual(hex(-1, 0));
  expect(retrieveWorldOccupant(saved, armor.id).ok).toBe(true);
  place(saved, armor.id, -1, 0);
  startSession(saved, null);
  advanceLive(saved, 6);
  expect(saved.world.enemies.basalt!.hp).toBeCloseTo(34.4);
  expect(saved.world.creatures[0]!.hp).toBe(10);
});

it("never retro-fights or heals on an honesty answer, but a breather runs the same World clock", () => {
  const initial = banked();
  initial.eraEarned = 20_000_000;
  const state = reload(initial);
  const sentinel = state.world.creatures[0]!;
  place(state, sentinel.id, 0, 0);
  startSession(state, null);
  advanceLive(state, 6);
  const hp = () => [sentinel.hp, state.world.enemies.shale!.hp, state.world.elapsed];
  expect(hp()).toEqual([18, 45, 6]);
  pauseSession(state);
  applyGap(state, 100, "visible", 0, rng);
  expect(hp()).toEqual([18, 45, 6]);
  resumeSession(state);
  for (const answer of ["missed", "full"] as const) {
    applyGap(state, 600, "away", 0, rng);
    flushPendingAway(state, rng);
    expect(state.session!.accounting.poolSeconds).toBe(600);
    expect(hp()).toEqual([18, 45, 6]);
    expect(resolveHonestyReport(state, answer, rng).ok).toBe(true);
    expect(hp()).toEqual([18, 45, 6]);
  }
  expect(endSession(state).ok).toBe(true);
  const records = structuredClone(state.sessionRecords);
  expect(startBreather(state).ok).toBe(true);
  expect(advanceBreather(state, 2, rng).fault).toBeUndefined();
  expect(hp()).toEqual([12, 45.7, 8]);
  expect(state.sessionRecords).toEqual(records);
});

it("fits defense first or a fueled Blade first on the same starter triangle without a draft", () => {
  const initial = banked();
  initial.eraEarned = 20_000_000;
  const state = reload(initial);
  give(state, "additive", hex(0, 1));
  give(state, "focusKeyed", hex(1, 0)).reserve = 60;
  place(state, state.world.creatures[0]!.id, 0, 0);
  const defense = structuredClone(state);
  const charge = structuredClone(state);
  place(defense, defense.world.armor[0]!.id, 0, 1);
  place(charge, charge.world.columns[0]!.id, 0, 1);
  place(charge, charge.world.weapons[0]!.id, 1, 0);
  expect(state.cells).toHaveLength(3);
  expect(worldPiecesOf(state)).toHaveLength(6);
  for (const branch of [defense, charge]) {
    startSession(branch, null);
    advanceLive(branch, 8);
  }
  expect(defense.world.creatures[0]!.hp).toBe(18);
  expect(charge.world.creatures[0]!.hp).toBe(12);
  expect(defense.world.enemies.shale!.hp).toBeCloseTo(45.7);
  expect(charge.world.enemies.shale!.hp).toBeCloseTo(42.05);
  expect(charge.world.weapons[0]!.store).toBeGreaterThan(0);
});

it("resolves two staggered Blades and two layers of armor, and never gives fallen gear to a survivor during flow or reload", () => {
  const initial = banked();
  initial.eraEarned = 20_000_000;
  initial.nous = 1_000;
  const state = reload(initial);
  const [sentinel] = state.world.creatures;
  const [blade] = state.world.weapons;
  const [armor] = state.world.armor;
  // Additional physical copies are a controlled multi-bearer fixture;
  // the slice intentionally adds no acquisition family for them.
  state.world.creatures.push({ ...sentinel!, id: "second" });
  state.world.armor.push({ ...armor!, id: "second-plate" });
  const secondBlade = createWeapon(state, "chargeBlade");
  state.world.weapons.push(secondBlade);
  expect(buyCell(state, hex(-1, 1)).ok).toBe(true);
  expect(buyCell(state, hex(0, -1)).ok).toBe(true);
  expect(buyCell(state, hex(1, -1)).ok).toBe(true);
  place(state, sentinel!.id, 0, 0);
  place(state, armor!.id, 0, 1);
  place(state, "second-plate", 1, 0);
  place(state, blade!.id, 1, -1);
  place(state, secondBlade.id, -1, 1);
  place(state, "second", 0, -1);
  expect(blade!.bearer).toBeNull();
  expect(secondBlade.bearer).toBe(sentinel!.id);
  expect(setWorldGearBearer(state, blade!.id, sentinel!.id).ok).toBe(true);
  blade!.store = secondBlade.store = 3;
  // A legitimate partially completed cadence, as if carried from a
  // previous advance with only this Blade deployed.
  blade!.cooldown = 2;
  startSession(state, null);
  expect(setWorldGearBearer(state, blade!.id, "second").ok).toBe(false);
  advanceLive(state, 3);
  expect(blade!.store).toBe(2);
  expect(secondBlade.store).toBe(3);
  advanceLive(state, 2);
  expect(secondBlade.store).toBe(2);
  expect(sentinel!.hp).toBe(22.5);
  expect(endSession(state).ok).toBe(true);
  expect(retrieveWorldOccupant(state, armor!.id).ok).toBe(true);
  expect(retrieveWorldOccupant(state, "second-plate").ok).toBe(true);
  blade!.store = 10;
  secondBlade.store = 0;
  startSession(state, null);
  advanceLive(state, 17);
  expect(sentinel!.recovering).toBe(true);
  expect(blade!.bearer).toBe(sentinel!.id);
  const held = blade!.store;
  const saved = reload(state);
  advanceLive(saved, 6);
  expect(saved.world.weapons[0]!.store).toBe(held);
  expect(saved.world.weapons[0]!.bearer).toBe(sentinel!.id);
  expect(endSession(saved).ok).toBe(true);
  expect(setWorldGearBearer(saved, blade!.id, "second").ok).toBe(true);
  expect(saved.world.weapons[0]!.bearer).toBe("second");
});

it("turns late-wall defeat into a clear at the same cadence with paid high-scale Hone", () => {
  const initial = banked();
  // Constructed late frontier, not a claim that a representative player
  // or the runner reached it. Prices are paid by the real command.
  initial.eraEarned = 2e15;
  initial.nous = 30_000;
  initial.arete = 15;
  for (const wall of worldEnemiesOf(initial).slice(0, -1)) initial.world.enemies[wall.key]!.hp = 0;
  const state = reload(initial);
  expect(activeWallOf(state)?.key).toBe("corundum");
  expect(state.world.enemies.corundum!.hp).toBe(3600);
  for (const [q, r] of [[1, -1], [2, -1], [2, -2], [1, -2]] as const) expect(buyCell(state, hex(q, r)).ok).toBe(true);
  const blade2 = createWeapon(state, "chargeBlade");
  state.world.weapons.push(blade2);
  place(state, state.world.creatures[0]!.id, 2, -2);
  place(state, state.world.armor[0]!.id, 1, -2);
  place(state, state.world.weapons[0]!.id, 2, -1);
  place(state, blade2.id, 1, -1);
  for (const blade of state.world.weapons) blade.store = 6;
  const base = attackPowerOf(state, "chargeBlade");
  for (let i = 0; i < 3; i++) expect(buyHoneRank(state, "chargeBlade").ok).toBe(true);
  const tuned = structuredClone(state);
  expect(buyHoneRank(tuned, "chargeBlade").ok).toBe(true);
  expect(tuned.arete).toBe(0);
  expect(attackPowerOf(tuned, "chargeBlade") / base).toBe(128);
  for (const branch of [state, tuned]) {
    startSession(branch, null);
    advanceLive(branch, 24);
    expect(Number.isFinite(branch.nous)).toBe(true);
  }
  expect(state.world.creatures[0]!.recovering).toBe(true);
  expect(state.world.enemies.corundum!.hp).toBeGreaterThan(3500);
  expect(tuned.world.enemies.corundum!.hp).toBe(0);
  expect(tuned.world.creatures[0]!.hp).toBe(8);
  expect(tuned.world.weapons.map(({ store }) => store)).toEqual([2, 2]);
});
