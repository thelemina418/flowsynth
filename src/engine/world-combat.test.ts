import { expect, it } from "vitest";
import { endBreather, endSession, pauseSession, placeWorldOccupant, prestige, resumeSession, retrieveWorldOccupant, setWorldConduitDirection, setWorldGearBearer, startBreather, startSession } from "./actions";
import { advance, advanceBreather } from "./advance";
import { hex } from "./hex";
import { give } from "./fixtures";
import { createWeapon } from "./state";
import { scenarioOf } from "./scenarios";
import { deserialize, serialize } from "./save";
import { enemyStateOf, worldFactorOf } from "./world";
import { applyGap, flushPendingAway, resolveHonestyReport } from "./trust";
import { syncRates } from "./economy";
import { walkWorldCombatProof } from "./world-combat-walks";

const rng = () => 0.3;

it("lets an unfed creature and its adjacent wall trade timed hits", () => {
  const fixture = scenarioOf("world-combat")!;
  expect(fixture).toBeTruthy();
  const state = fixture.build(0);
  fixture.assert(state, 0);
  const proof = { creature: state.world.creatures[0]! };
  expect(placeWorldOccupant(state, proof.creature.id, hex(0, 0)).ok).toBe(true);
  expect(startSession(state, null).ok).toBe(true);
  expect(advance(state, 3, rng).fault).toBeUndefined();
  expect(proof.creature.hp).toBe(24);
  expect(enemyStateOf(state, "shale").hp).toBe(48);
  advance(state, 3, rng);
  expect(proof.creature.hp).toBe(18);
  expect(enemyStateOf(state, "shale").hp).toBe(45);
});

it("adjacent armor enables a wounded bench return; defeat locks the tray until full HP", () => {
  const state = scenarioOf("world-combat")!.build(0);
  const { creatures: [creature], armor: [armor] } = state.world;
  const front = hex(0, 0);
  expect(placeWorldOccupant(state, creature!.id, front).ok).toBe(true);
  expect(placeWorldOccupant(state, armor!.id, hex(0, 1)).ok).toBe(true);
  startSession(state, null);
  advance(state, 16, rng);
  endSession(state);
  expect(creature!.hp).toBe(12);
  expect(retrieveWorldOccupant(state, creature!.id).ok).toBe(true);
  expect(placeWorldOccupant(state, creature!.id, front).ok).toBe(true);
  expect(creature!.hp).toBe(12);
  expect(placeWorldOccupant(state, armor!.id, hex(1, 1)).ok).toBe(true);
  startSession(state, null);
  advance(state, 8, rng);
  endSession(state);
  expect(creature).toMatchObject({ pos: null, hp: 0, recovering: true });
  expect(armor!.pos).toEqual(hex(1, 1));
  expect(placeWorldOccupant(state, creature!.id, front).ok).toBe(false);
  startSession(state, null);
  advance(state, 11, rng);
  endSession(state);
  expect(creature!.hp).toBe(22);
  expect(placeWorldOccupant(state, creature!.id, front).ok).toBe(false);
  startSession(state, null);
  advance(state, 1, rng);
  endSession(state);
  expect(creature).toMatchObject({ pos: null, hp: 24, recovering: false });
  expect(placeWorldOccupant(state, creature!.id, front).ok).toBe(true);
});

it("rebinds fallen gear to the sole neighbor only when the breather ends", () => {
  const state = scenarioOf("world-combat")!.build(0);
  const [first] = state.world.creatures;
  const [blade] = state.world.weapons;
  const second = { ...first!, id: "second-sentinel" };
  state.world.creatures.push(second);
  expect(startSession(state, 600).ok).toBe(true);
  advance(state, 600, rng);
  expect(endSession(state).ok).toBe(true);
  first!.hp = 1;
  expect(placeWorldOccupant(state, first!.id, hex(0, 0)).ok).toBe(true);
  expect(placeWorldOccupant(state, second.id, hex(0, -1)).ok).toBe(true);
  expect(placeWorldOccupant(state, blade!.id, hex(1, -1)).ok).toBe(true);
  expect(setWorldGearBearer(state, blade!.id, first!.id).ok).toBe(true);
  expect(startBreather(state).ok).toBe(true);
  advanceBreather(state, 4, rng);
  expect(first!.recovering).toBe(true);
  expect(blade!.bearer).toBe(first!.id);
  expect(setWorldGearBearer(state, blade!.id, second.id).ok).toBe(false);
  expect(endBreather(state).ok).toBe(true);
  expect(blade!.bearer).toBe(second.id);
});

it("unlocks a defeated Sentinel at the same full-HP boundary after fractional recovery", () => {
  const state = scenarioOf("world-combat")!.build(0);
  const sentinel = state.world.creatures[0]!;
  expect(placeWorldOccupant(state, sentinel.id, hex(0, 0)).ok).toBe(true);
  expect(startSession(state, null).ok).toBe(true);
  advance(state, 16, rng);
  expect(sentinel.recovering).toBe(true);
  const long = structuredClone(state);
  advance(long, 12, rng);
  const short = structuredClone(state);
  advance(short, 12 - 5e-10, rng);
  expect(endSession(short).ok).toBe(true);
  expect(placeWorldOccupant(short, sentinel.id, hex(0, 0)).ok).toBe(false);
  let reloaded = structuredClone(state);
  for (let i = 0; i < 1200; i++) {
    advance(state, 0.01, rng);
    advance(reloaded, 0.01, rng);
    if (i === 599) reloaded = deserialize(serialize(reloaded, 0)).state!;
  }
  for (const ready of [long, state, reloaded]) {
    expect(endSession(ready).ok).toBe(true);
    expect(ready.world.creatures[0]!.hp).toBe(24);
    expect(placeWorldOccupant(ready, sentinel.id, hex(0, 0)).ok).toBe(true);
  }
});

it("conserves one Column's supply through a full sink, a real conduit cycle, and a broken route", () => {
  const state = scenarioOf("world-combat")!.build(0);
  const { conduits: [first], spells: [spell], weapons: [blade], columns: [column] } = state.world;
  const second = { ...first!, id: "second-conduit" };
  state.world.conduits.push(second);
  for (const [id, position] of [
    [column!.id, hex(1, 1)], [first!.id, hex(1, 0)], [second.id, hex(1, -1)],
    [blade!.id, hex(1, -2)], [spell!.id, hex(0, 1)],
  ] as const) expect(placeWorldOccupant(state, id, position).ok).toBe(true);
  expect(setWorldConduitDirection(state, second.id, 2).ok).toBe(true);
  expect(startSession(state, null).ok).toBe(true);
  // The rig lifts 1/s. Both unbound stores start empty and share it.
  advance(state, 8, rng);
  expect([blade!.store, spell!.store]).toEqual([4, 4]);
  expect(setWorldConduitDirection(state, second.id, 5).ok).toBe(false);
  // Pulse fills after four more seconds at half-rate; the connected Blade
  // takes the entire lift for the two seconds after that.
  advance(state, 6, rng);
  expect([blade!.store, spell!.store]).toEqual([8, 6]);
  expect(endSession(state).ok).toBe(true);
  // 5 sends the second conduit back into the first. 1 sends into an
  // empty owned cell. Neither route leaks charge into the distant Blade.
  for (const direction of [5, 1]) {
    expect(setWorldConduitDirection(state, second.id, direction).ok).toBe(true);
    expect(startSession(state, null).ok).toBe(true);
    advance(state, 8, rng);
    expect([blade!.store, spell!.store]).toEqual([8, 6]);
    expect(endSession(state).ok).toBe(true);
  }
  expect(setWorldConduitDirection(state, second.id, 2).ok).toBe(true);
  expect(startSession(state, null).ok).toBe(true);
  advance(state, 8, rng);
  expect([blade!.store, spell!.store]).toEqual([16, 6]);
  expect(enemyStateOf(state, "shale").hp).toBe(48);
});

function preparedShale() {
  const state = scenarioOf("world-combat")!.build(0);
  const { creatures: [creature], armor: [armor], conduits: [conduit], spells: [spell] } = state.world;
  for (const [id, pos] of [
    [creature!.id, hex(0, 0)], [armor!.id, hex(-1, 1)], [conduit!.id, hex(1, 0)], [spell!.id, hex(0, 1)],
    [state.world.columns[0]!.id, hex(1, 1)], [state.world.weapons[0]!.id, hex(1, -1)],
  ] as const) expect(placeWorldOccupant(state, id, pos).ok).toBe(true);
  return state;
}

it("spends Blade charge on its own cadence and casts Pulse at its banked threshold", () => {
  const state = preparedShale();
  startSession(state, null);
  advance(state, 4, rng);
  expect(enemyStateOf(state, "shale").hp).toBe(48);
  expect(state.world.creatures[0]!.hp).toBe(21);
  advance(state, 1, rng);
  expect(enemyStateOf(state, "shale").hp).toBe(44);
  expect(state.world.weapons[0]!.store).toBeCloseTo(1.5);
  advance(state, 6.9, rng);
  const before = enemyStateOf(state, "shale").hp;
  expect(state.world.spells[0]!.store).toBeCloseTo(5.95);
  // At t=12 base hit and the banked Pulse land; the wall heals in combat.
  advance(state, 0.1, rng);
  expect(enemyStateOf(state, "shale").hp).toBeCloseTo(before + 0.035 - 3 - 11);
  expect(state.world.spells[0]!.store).toBeCloseTo(0);
});

it("Pulse does not spend a real shortfall, even with no supply or at generator depletion", () => {
  const state = preparedShale();
  const spell = state.world.spells[0]!;
  const generator = state.modules.find(m => m.type === "focusKeyed")!;
  const short = 6 - 5e-10;
  spell.store = short;
  generator.reserve = 0;
  expect(startSession(state, null).ok).toBe(true);
  expect(advance(state, 1, rng).fault).toBeUndefined();
  expect(enemyStateOf(state, "shale").hp).toBe(48);
  expect(spell.store).toBe(short);

  expect(endSession(state).ok).toBe(true);
  // Two sinks share a 1/s lift. Depletion falls just short of full Pulse.
  spell.store = 5.75;
  generator.reserve = 0.5 - 1e-9;
  expect(startSession(state, null).ok).toBe(true);
  expect(advance(state, 0.5, rng).fault).toBeUndefined();
  expect(enemyStateOf(state, "shale").hp).toBe(48);
  expect(spell.store).toBe(short);
  expect(generator.reserve).toBe(0);
  expect(state.world.weapons[0]!.store).toBeCloseTo(0.25 - 5e-10, 14);

  expect(endSession(state).ok).toBe(true);
  generator.reserve = 1;
  expect(startSession(state, null).ok).toBe(true);
  expect(advance(state, 2e-9, rng).fault).toBeUndefined();
  expect(enemyStateOf(state, "shale").hp).toBeCloseTo(37, 8);
  expect(spell.store).toBeCloseTo(5e-10, 14);
});

it.each([12, 12 - 2 ** -49])(
  "splits %s generator charge between unfired Blade and Pulse across ticks and reload, without casting short", reserve => {
    const state = scenarioOf("world-combat")!.build(0);
    const { creatures: [creature], columns: [column], weapons: [blade], spells: [pulse] } = state.world;
    for (const [id, pos] of [[creature!.id, hex(0, 0)], [column!.id, hex(1, 1)], [blade!.id, hex(2, 0)], [pulse!.id, hex(0, 1)]] as const) {
      expect(placeWorldOccupant(state, id, pos).ok).toBe(true);
    }
    expect(blade!.bearer).toBeNull(); // Blade takes its share without paying for attacks.
    const generator = state.modules.find(m => m.type === "focusKeyed")!;
    generator.reserve = reserve;
    state.world.enemies.shale!.hp = 38.25;
    expect(startSession(state, null).ok).toBe(true);
    for (const partition of ["whole", "ticks", "reload"]) {
      let run = structuredClone(state);
      const tick = (seconds: number) => expect(advance(run, seconds, rng).fault).toBeUndefined();
      if (partition === "whole") tick(12);
      else for (let i = 0; i < 2400; i++) {
        tick(0.005);
        if (i === 1199 && partition === "reload") run = deserialize(serialize(run, 0)).state!;
      }
      expect(run.modules.find(m => m.id === generator.id)!.reserve).toBe(0);
      expect(enemyStateOf(run, "shale").hp, `${reserve}, ${partition}`).toBeCloseTo(reserve === 12 ? 25.45 : 36.45, 10);
      expect(run.world.weapons[0]!.store).toBe(reserve / 2);
      expect(run.world.spells[0]!.store).toBe(reserve === 12 ? 0 : reserve / 2);
    }
  }, 15_000,
);

it("conserves two generators through a relay, three shares and full-store redistribution", () => {
  const state = scenarioOf("world-combat")!.build(0);
  const { columns: [column], weapons: [blade], spells: [pulse] } = state.world;
  const maul = createWeapon(state, "maul");
  state.world.weapons.push(maul);
  const first = state.modules.find(m => m.type === "focusKeyed")!;
  first.reserve = 2;
  give(state, "focusKeyed", hex(0, 1)).reserve = 10;
  give(state, "amplifier", hex(1, 0));
  // This dormant tail is not a provider. Its reserve must not drain just
  // because there is a Column elsewhere on the board.
  const isolated = give(state, "focusKeyed", hex(-1, 1));
  isolated.reserve = 2 ** -32;
  for (const [id, pos] of [[column!.id, hex(1, 1)], [blade!.id, hex(2, 0)], [pulse!.id, hex(0, 1)], [maul.id, hex(1, 0)]] as const) {
    expect(placeWorldOccupant(state, id, pos).ok).toBe(true);
  }
  expect(startSession(state, null).ok).toBe(true);
  const whole = structuredClone(state);
  expect(advance(whole, 11, rng).fault).toBeUndefined();
  let reloaded = state;
  for (let i = 0; i < 110; i++) {
    expect(advance(reloaded, 0.1, rng).fault).toBeUndefined();
    if (i === 54) reloaded = deserialize(serialize(reloaded, 0)).state!;
  }
  // Each provider delivers its reserve directly and through gain 1, so
  // the Column lifts 24 units. Pulse retains six; the two others take nine.
  for (const run of [whole, reloaded]) {
    expect(run.world.weapons.map(w => w.store)).toEqual([9, 9]);
    expect(run.world.spells[0]!.store).toBe(6);
    expect(run.modules.filter(m => m.type === "focusKeyed").map(m => m.reserve)).toEqual([0, 0, 2 ** -32]);
  }
});

it("hands pressure to the next wall at victory, then preserves victories and wounds at prestige", () => {
  const state = preparedShale();
  const shale = enemyStateOf(state, "shale");
  const basalt = enemyStateOf(state, "basalt");
  const creature = state.world.creatures[0]!;
  const column = state.world.columns[0]!;
  expect(worldFactorOf(state)).toBe(0.8);
  expect(basalt.discovered).toBe(false);
  expect(placeWorldOccupant(state, column.id, hex(-1, 0)).ok).toBe(false);
  startSession(state, null);
  advance(state, 34, rng);
  endSession(state);
  expect(shale.hp).toBe(0);
  expect(creature!.hp).toBeGreaterThan(0);
  expect(basalt.discovered).toBe(true);
  expect(worldFactorOf(state)).toBe(0.65);
  expect(placeWorldOccupant(state, column.id, hex(-1, 0)).ok).toBe(true);
  expect(retrieveWorldOccupant(state, creature!.id).ok).toBe(true);
  startSession(state, null);
  advance(state, 12, rng);
  endSession(state);
  expect(placeWorldOccupant(state, creature!.id, hex(2, -2)).ok).toBe(true);
  startSession(state, null);
  advance(state, 6, rng);
  endSession(state);
  const wounds = { sentinel: creature!.hp, basalt: basalt.hp };
  expect(wounds.basalt).toBeLessThan(35);
  expect(prestige(state).ok).toBe(true);
  expect(creature!.hp).toBe(wounds.sentinel);
  expect(basalt.hp).toBe(wounds.basalt);
  expect(shale.hp).toBe(0);
  expect(basalt.discovered).toBe(false);
  expect(worldFactorOf(state)).toBe(1);
  expect(placeWorldOccupant(state, column.id, hex(2, -1)).ok).toBe(false);
  startSession(state, null);
  advance(state, 1, rng);
  expect(basalt.hp).toBeCloseTo(wounds.basalt + 0.4);
  expect(basalt.discovered).toBe(false);
  advance(state, 200, rng);
  expect(shale.hp).toBe(0);
  expect(basalt.discovered).toBe(true);
  expect(worldFactorOf(state)).toBe(0.65);
});

it("uses only trusted World time through pause, honesty settlement, and a breather", () => {
  const state = scenarioOf("world-combat")!.build(0);
  const proof = { creature: state.world.creatures[0]! };
  expect(advance(state, 600, rng).nousEarned).toBe(0);
  expect(placeWorldOccupant(state, proof.creature.id, hex(0, 0)).ok).toBe(true);
  startSession(state, null);
  advance(state, 6, rng);
  const hp = () => ({ creature: proof.creature.hp, enemy: enemyStateOf(state, "shale").hp, world: state.world.elapsed });
  expect(hp()).toEqual({ creature: 18, enemy: 45, world: 6 });
  pauseSession(state);
  applyGap(state, 100, "visible", 0, rng);
  expect(hp()).toEqual({ creature: 18, enemy: 45, world: 6 });
  resumeSession(state);
  for (const answer of ["missed", "full"] as const) {
    applyGap(state, 600, "away", 0, rng);
    flushPendingAway(state, rng);
    expect(state.session!.accounting.poolSeconds).toBe(600);
    expect(hp()).toEqual({ creature: 18, enemy: 45, world: 6 });
    expect(resolveHonestyReport(state, answer, rng).ok).toBe(true);
    expect(hp()).toEqual({ creature: 18, enemy: 45, world: 6 });
  }
  expect(state.session!.accounting.creditedSeconds).toBe(606);
  expect(endSession(state).ok).toBe(true);
  expect(retrieveWorldOccupant(state, proof.creature.id).ok).toBe(true);
  advance(state, 100, rng);
  expect(hp()).toEqual({ creature: 18, enemy: 45, world: 6 });
  expect(startBreather(state).ok).toBe(true);
  const records = structuredClone(state.sessionRecords);
  advanceBreather(state, 2, rng);
  expect(hp()).toEqual({ creature: 22, enemy: 45.7, world: 8 });
  expect(state.sessionRecords).toEqual(records);
});

it("splits a trusted hidden stretch, sleep, and the visible tail without spending an offline beat", () => {
  const state = scenarioOf("world-combat")!.build(0);
  const sentinel = state.world.creatures[0]!;
  expect(placeWorldOccupant(state, sentinel.id, hex(0, 0)).ok).toBe(true);
  expect(startSession(state, 600).ok).toBe(true);
  applyGap(state, 3, "away", 0, rng);
  // Pending hidden time stays contiguous with sleep for the honesty
  // decision. Only the three hidden seconds and visible tail can fight.
  applyGap(state, 101, "visible", 100, rng);
  expect(state.session!.accounting).toMatchObject({ creditedSeconds: 104, poolSeconds: 0 });
  expect(state.world.elapsed).toBe(4);
  expect(sentinel.hp).toBe(18);
  expect(enemyStateOf(state, "shale").hp).toBe(48);
  applyGap(state, 40, "visible", -40, rng);
  expect(state.world.elapsed).toBe(4);
  expect(state.session!.accounting.creditedSeconds).toBe(104);
});

it("keeps HP, charge, and threshold-split production when the advance is subdivided", () => {
  const once = preparedShale();
  const split = preparedShale();
  startSession(once, null);
  startSession(split, null);
  advance(once, 34, rng);
  for (let i = 0; i < 340; i++) advance(split, 0.1, rng);
  expect(enemyStateOf(once, "shale").hp).toBe(0);
  expect(enemyStateOf(split, "shale").hp).toBe(0);
  expect(split.eraEarned).toBeCloseTo(once.eraEarned, 5);
  expect(split.world.creatures[0]!.hp).toEqual(once.world.creatures[0]!.hp);
  expect(split.world.spells[0]!.store).toBeCloseTo(once.world.spells[0]!.store, 6);
  expect(split.world.weapons[0]!.store).toBeCloseTo(once.world.weapons[0]!.store, 6);
});

it("separates a win, attrition, lost ground, and a Hone-funded return from equal starts", () => {
  const walks = walkWorldCombatProof();
  const [effective, attrition, weak] = walks.shale;
  expect(effective.outcome).toBe("won");
  expect(effective.deployments).toBe(1);
  expect(attrition.outcome).toBe("won");
  expect(attrition.deployments).toBeGreaterThan(1);
  expect(effective.start).toEqual(attrition.start);
  expect(effective.start).toEqual(weak.start);
  expect(weak.outcome).toBe("lost ground");
  expect(weak.end.shaleHp).toBeGreaterThan(weak.start.shaleHp);
  const [unspent, honed] = walks.basalt;
  expect(unspent.start).toEqual(honed.start);
  expect(unspent.outcome).toBe("defeated");
  expect(honed.outcome).toBe("won");
  expect(honed.honeRank).toBe(2);
  expect(honed.start.shaleHp).toBe(0);
  expect(walks.beforePrestige.bladeDamage).toBe(walks.afterPrestige.bladeDamage);
});

it("does not activate the next wall until its own threshold, even if the predecessor is cleared", () => {
  // Same trusted command seam; this starts a fresh era just before the
  // next threshold, rather than walking through a live-economy claim.
  const state = scenarioOf("world-combat")!.build(0);
  state.world.enemies.shale!.hp = 0;
  state.eraEarned = 17;
  expect(placeWorldOccupant(state, state.world.creatures[0]!.id, hex(2, -2)).ok).toBe(true);
  startSession(state, null);
  const large = structuredClone(state);
  expect(worldFactorOf(state)).toBe(1);
  const before = syncRates(state).rate;
  const until = (18 - state.eraEarned) / before;
  advance(state, until / 2, rng);
  expect(enemyStateOf(state, "basalt").discovered).toBe(false);
  advance(state, until / 2, rng);
  expect(enemyStateOf(state, "basalt").discovered).toBe(true);
  expect(worldFactorOf(state)).toBe(0.65);
  expect(state.world.creatures[0]!.hp).toBe(24);
  advance(state, 4, rng);
  advance(large, until + 4, rng);
  expect(state.world.creatures[0]!.hp).toBe(16);
  expect(large.world.creatures[0]!.hp).toBe(16);
  expect(large.eraEarned).toBeCloseTo(state.eraEarned, 9);
});

it("clearing an unowned wall removes its World reservation without granting the cell", () => {
  const state = preparedShale();
  expect(placeWorldOccupant(state, state.world.creatures[0]!.id, hex(-1, 0)).ok).toBe(false);
  // The spare target is made unowned before the encounter; winning should
  // not populate it. World availability remains separate from ownership.
  state.cells = state.cells.filter((p) => p.q !== -1 || p.r !== 0);
  startSession(state, null);
  advance(state, 34, rng);
  endSession(state);
  expect(enemyStateOf(state, "shale").hp).toBe(0);
  expect(placeWorldOccupant(state, state.world.creatures[0]!.id, hex(-1, 0))).toMatchObject({ ok: false, reason: "Only an owned cell carries a World face." });
});
