import { expect, it } from "vitest";
import { buyHoneRank, endSession, pauseSession, placeWorldOccupant, prestige, resumeSession, setWorldConduitDirection, startSession } from "./actions";
import { advance } from "./advance";
import { hex } from "./hex";
import { deserialize, serialize } from "./save";
import { createInitialState, createWeapon } from "./state";
import { scenarioOf } from "./scenarios";
import { applyGap, flushPendingAway, resolveHonestyReport } from "./trust";
import type { GameState, WeaponType } from "./types";

const reload = (state: GameState) => deserialize(serialize(state, 0)).state!;
const tick = (state: GameState, seconds: number) => expect(advance(state, seconds, () => 0.3).fault).toBeUndefined();

function openingFight(): GameState {
  const state = createInitialState();
  state.eraEarned = 20_000_000;
  expect(prestige(state).ok).toBe(true);
  state.eraEarned = 20_000_000;
  const ready = reload(state);
  expect(placeWorldOccupant(ready, ready.world.creatures[0]!.id, hex(0, 0)).ok).toBe(true);
  return ready;
}

function equip(state: GameState, type: WeaponType, store: number) {
  // Controlled input: the equipment and its reserve at the start of a duel.
  const weapon = createWeapon(state, type);
  state.world.weapons.push(weapon);
  weapon.store = store;
  expect(placeWorldOccupant(state, weapon.id, hex(1, 0)).ok).toBe(true);
  expect(startSession(state, null).ok).toBe(true);
  return weapon;
}

it("Striker strikes unfed on its own cadence and spends only a discrete charge payment when funded", () => {
  for (const [banked, after, damage] of [[0, 0, 5], [1 - Number.EPSILON, 1 - Number.EPSILON, 5], [1, 0, 8], [20, 19, 8]] as const) {
    const state = openingFight();
    const weapon = equip(state, "striker", banked);
    tick(state, 3.99);
    expect(state.world.enemies.shale!.hp).toBe(48);
    expect(weapon.store).toBe(banked);
    tick(state, 0.01);
    expect(state.world.enemies.shale!.hp).toBe(48 - damage);
    expect(weapon.store).toBe(after);
    expect(endSession(state).ok).toBe(true);
    expect(reload(state).world.weapons.find(({ id }) => id === weapon.id)).toMatchObject({ type: "striker", store: after, bearer: state.world.creatures[0]!.id });
  }
});

it("funds the same Striker beat with one second of supply or ten tenth-second spans", () => {
  const state = scenarioOf("world-combat")!.build(0);
  const striker = createWeapon(state, "striker");
  state.world.weapons.push(striker);
  for (const [id, q, r] of [[state.world.creatures[0]!.id, 0, 0], [state.world.columns[0]!.id, 1, 1], [striker.id, 0, 1]] as const) {
    expect(placeWorldOccupant(state, id, hex(q, r)).ok).toBe(true);
  }
  // Model a carried beat and empty store at the start of the session.
  striker.cooldown = 3;
  expect(startSession(state, null).ok).toBe(true);
  const single = structuredClone(state);
  const short = structuredClone(state);
  tick(single, 1);
  for (let i = 0; i < 10; i++) tick(state, 0.1);
  tick(short, 0.99999999); // truly short, far outside floating-point noise
  expect(single.world.enemies.shale!.hp).toBe(40);
  expect(state.world.enemies.shale!.hp).toBe(40);
  expect(state.world.weapons.find(w => w.id === striker.id)!.store).toBeCloseTo(0, 12);
  expect(short.world.enemies.shale!.hp).toBe(48);
});

it("Charge Blade skips an unfed beat, then all copies use the same purchased Hone at the original cadence", () => {
  const state = openingFight();
  const blade = equip(state, "chargeBlade", 0);
  tick(state, 5);
  expect(state.world.enemies.shale!.hp).toBe(48);
  expect(endSession(state).ok).toBe(true);
  expect(buyHoneRank(state, "striker").ok).toBe(false);
  expect(buyHoneRank(state, "chargeBlade").ok).toBe(true);
  blade.store = 1;
  const future = createWeapon(state, "chargeBlade");
  future.store = 1;
  state.world.weapons.push(future);
  expect(placeWorldOccupant(state, future.id, hex(0, 1)).ok).toBe(true);
  const ready = reload(state);
  expect(startSession(ready, null).ok).toBe(true);
  tick(ready, 5);
  // Sentinel's carried beat lands after one second, followed by four
  // seconds of regeneration and the two six-HP Blade hits at second five.
  expect(ready.world.enemies.shale!.hp).toBeCloseTo(34.4);
  expect(ready.world.weapons.map(({ store }) => store)).toEqual([0, 0, 0]);
});

it("resolves two adjacent ordinary copies at their own beats and never spends on a dead target", () => {
  const state = openingFight();
  const first = equip(state, "striker", 1);
  expect(endSession(state).ok).toBe(true);
  const second = createWeapon(state, "striker");
  second.store = 1;
  state.world.weapons.push(second);
  expect(placeWorldOccupant(state, second.id, hex(0, 1)).ok).toBe(true);
  expect(first.bearer).toBe(second.bearer);
  state.world.enemies.shale!.hp = 20;
  expect(startSession(state, null).ok).toBe(true);
  tick(state, 4);
  expect(state.world.enemies.shale!.hp).toBeCloseTo(5.4);
  expect([first.store, second.store]).toEqual([0, 0]);
  expect(endSession(state).ok).toBe(true);
  // A funded first hit finishes this same living wall; the second copy
  // does not pay into an already won duel.
  first.store = second.store = 1;
  expect(startSession(state, null).ok).toBe(true);
  tick(state, 4);
  expect(state.world.enemies.shale!.hp).toBe(0);
  expect([first.store, second.store]).toEqual([0, 1]);
});

it("one Column shares conserved charge across two ordinary weapons without an unbound hit", () => {
  // Fixed routing fixture with one charge per second reaching the Column.
  const state = scenarioOf("world-combat")!.build(0);
  const [column] = state.world.columns;
  const [conduit] = state.world.conduits;
  const striker = createWeapon(state, "striker");
  const maul = createWeapon(state, "maul");
  state.world.weapons.push(striker, maul);
  for (const [id, q, r] of [[column!.id, 1, 1], [conduit!.id, 1, 0], [striker.id, 1, -1], [maul.id, 0, 1]] as const) {
    expect(placeWorldOccupant(state, id, hex(q, r)).ok).toBe(true);
  }
  expect(startSession(state, null).ok).toBe(true);
  tick(state, 8);
  expect([striker.store, maul.store, state.world.enemies.shale!.hp]).toEqual([4, 4, 48]);
  expect(endSession(state).ok).toBe(true);
  expect(setWorldConduitDirection(state, conduit!.id, 5).ok).toBe(true);
  expect(startSession(state, null).ok).toBe(true);
  tick(state, 8);
  expect([striker.store, maul.store]).toEqual([4, 12]);
});

it("does not advance an ordinary weapon on paused or provisional clocks, even after honesty credit", () => {
  const state = openingFight();
  const striker = equip(state, "striker", 1);
  const rng = () => 0.3;
  tick(state, 3);
  expect(pauseSession(state).ok).toBe(true);
  applyGap(state, 600, "visible", 0, rng);
  expect(resumeSession(state).ok).toBe(true);
  applyGap(state, 600, "away", 0, rng);
  flushPendingAway(state, rng);
  expect(resolveHonestyReport(state, "full", rng).ok).toBe(true);
  expect([striker.store, state.world.enemies.shale!.hp]).toEqual([1, 48]);
  tick(state, 1);
  expect([striker.store, state.world.enemies.shale!.hp]).toEqual([0, 40]);
});
