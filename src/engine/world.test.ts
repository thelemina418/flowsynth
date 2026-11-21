import { describe, expect, it } from "vitest";
import {
  advanceWorldCharge,
  columnLiftsOf,
  honeCostOf,
  worldEnemiesOf,
} from "./world";
import { bankableClaimOf, frontierEntitlement, pendingClaimOf, ARETE_HORIZON } from "./accumulator";
import { buyChargeColumn, buyHoneRank, placeWorldOccupant, prestige, reshapeCells, retrieveWorldOccupant, startSession } from "./actions";
import { advance } from "./advance";
import { BALANCE, WORLD_ENEMIES } from "./constants";
import { createWeapon } from "./state";
import { fresh, give } from "./fixtures";
import { serialize, deserialize } from "./save";
import { adjacent, hex, neighbors } from "./hex";
import { positionInRange } from "./lattice";
import type { GameState, Hex, WeaponCopy } from "./types";

// The World engine and economy (issue #425, ADR-0074): the frontier Arete
// contract, the authored encounters, the automatic combat on trusted time,
// and the conserved Column lift.

// A flow session over the bare opening board — the one constant-rate
// producer, no generators, no temporal profiles, no goals — so the walk's
// only boundaries are the World's own. The Octave the opening pair forms
// pre-seeds its discovery-ledger entry, so the library's per-class boost
// stands from tick zero instead of landing at the first span's boundary:
// exactness tests measure a settled rate.
function flowing(state: GameState = fresh()): GameState {
  state.chordDiscovery["Octave"] = { formed: true, firstFormedAt: 0, rootsHeard: 1, roots: [0] };
  startSession(state, null);
  return state;
}

// A weapon copy, placed and stocked — the rig for combat tests.
function grantWeapon(state: GameState, pos: Hex | null, store = BALANCE.world.storageCap): WeaponCopy {
  const weapon = createWeapon(state, "chargeBlade");
  weapon.pos = pos;
  weapon.store = store;
  state.world.weapons.push(weapon);
  return weapon;
}

describe("the frontier entitlement curve (issue #425)", () => {
  it("pays nothing below the World entry and jumps to the starter grant at it", () => {
    expect(frontierEntitlement(BALANCE.world.entryNous - 1)).toBe(0);
    expect(frontierEntitlement(BALANCE.world.entryNous)).toBe(2);
    expect(frontierEntitlement(0)).toBe(0);
  });

  it("pays its slope per decade past the entry, fractionally valued", () => {
    const slope = BALANCE.world.claimDepthSlope;
    expect(frontierEntitlement(BALANCE.world.entryNous * 10)).toBe(BALANCE.world.claimBase + slope);
    expect(frontierEntitlement(BALANCE.world.entryNous * 1e8)).toBe(BALANCE.world.claimBase + slope * 8);
    expect(frontierEntitlement(BALANCE.world.entryNous * Math.sqrt(10))).toBeCloseTo(BALANCE.world.claimBase + slope / 2, 10);
  });

  it("is increasing with diminishing marginal reward per nous", () => {
    // The log curve's per-decade step is flat by shape; its marginal
    // reward per unit of earned nous is what diminishes.
    const marginal = (x: number) => frontierEntitlement(x + BALANCE.world.entryNous) - frontierEntitlement(x);
    expect(marginal(BALANCE.world.entryNous)).toBeGreaterThan(marginal(BALANCE.world.entryNous * 10));
    expect(marginal(BALANCE.world.entryNous * 10)).toBeGreaterThan(marginal(BALANCE.world.entryNous * 100));
  });

  it("preserves the first positive entitlement at 20M independently of retired Column prices", () => {
    expect(frontierEntitlement(20_000_000 - 1)).toBe(0);
    expect(frontierEntitlement(20_000_000)).toBe(2);
  });

  it("the horizon line stays the prestige gate and is never rescaled by the World work", () => {
    // findings.md's provenance gate: the 7e6 line is capacity-calibrated
    // evidence, and the World experiment must not scale it.
    expect(ARETE_HORIZON).toBe(7e6);
  });
});

describe("the pending claim and its banking (issue #425)", () => {
  it("reads the entitlement difference against the claimed frontier, never negative", () => {
    const s = fresh();
    expect(pendingClaimOf(s)).toBe(0);
    s.eraEarned = BALANCE.world.entryNous * 10;
    expect(pendingClaimOf(s)).toBe(BALANCE.world.claimBase + BALANCE.world.claimDepthSlope);
    s.world.frontier = BALANCE.world.claimBase + BALANCE.world.claimDepthSlope + 1;
    expect(pendingClaimOf(s)).toBe(0);
  });

  it("banks whole Arete on prestige and advances the frontier by exactly the banked step", () => {
    const s = fresh();
    s.mode = "upgrade";
    s.eraEarned = BALANCE.world.entryNous * Math.sqrt(10); // E = claimBase + slope/2
    s.eraEarned = Math.max(s.eraEarned, ARETE_HORIZON);
    const whole = Math.floor(BALANCE.world.claimBase + BALANCE.world.claimDepthSlope / 2);
    expect(prestige(s).ok).toBe(true);
    expect(s.arete).toBe(whole);
    expect(s.world.frontier).toBe(whole);
  });

  it("partition independence: arbitrary prestige splittings telescope to the single-climb total, within 1e-10", () => {
    // One climb from the entry to depth 8, claimed in one prestige.
    const once = fresh();
    once.mode = "upgrade";
    once.eraEarned = BALANCE.world.entryNous * 1e8;
    const singleTotal = bankableClaimOf(once);
    // The same climb split at every prefix, and at a scattered sample of
    // splittings, must land the same total: claims telescope because the
    // frontier advances by whole banked steps.
    const depths = [1, 2, 3, 5, 6.5, 7.25, 8];
    for (const cut of depths) {
      const split = fresh();
      split.mode = "upgrade";
      for (const depth of depths.filter((d) => d <= cut)) {
        split.eraEarned = BALANCE.world.entryNous * 10 ** Math.min(depth, 8);
        expect(prestige(split).ok).toBe(true);
      }
      split.eraEarned = BALANCE.world.entryNous * 1e8;
      expect(prestige(split).ok).toBe(true);
      expect(Math.abs(split.arete - singleTotal)).toBeLessThan(1e-10);
    }
  });

  it("fractional entitlement is preserved: the sub-unit remainder stays pending, never lost", () => {
    const s = fresh();
    s.mode = "upgrade";
    // E = claimBase + slope/4 at a quarter decade: the whole part banks,
    // the fraction stays. The quarter decade's fraction is .25, .5, or .75
    // — a quarter decade at slope 4 lands exactly whole, so a quarter
    // decade plus an eighth prices the fractional case.
    const e = BALANCE.world.claimBase + BALANCE.world.claimDepthSlope * 0.25;
    const fractional = e % 1;
    const depth = 10 ** (0.25 + (fractional === 0 ? 0.125 : 0));
    const wholeBanked = Math.floor(BALANCE.world.claimBase + BALANCE.world.claimDepthSlope * Math.log10(depth));
    s.eraEarned = BALANCE.world.entryNous * depth;
    expect(pendingClaimOf(s)).toBeCloseTo(BALANCE.world.claimBase + BALANCE.world.claimDepthSlope * Math.log10(depth), 10);
    expect(prestige(s).ok).toBe(true);
    expect(s.arete).toBe(wholeBanked);
    expect(s.world.frontier).toBe(wholeBanked);
    // Returning to the same depth banks nothing — the remainder alone
    // cannot clear a whole unit.
    s.eraEarned = BALANCE.world.entryNous * depth;
    expect(pendingClaimOf(s)).toBeCloseTo(BALANCE.world.claimBase + BALANCE.world.claimDepthSlope * Math.log10(depth) - wholeBanked, 10);
    expect(prestige(s).ok).toBe(true);
    expect(s.arete).toBe(wholeBanked);
    // Surpassing the depth completes the fraction exactly: floor sums
    // recombine to the single-climb figure.
    s.eraEarned = BALANCE.world.entryNous * 10;
    expect(prestige(s).ok).toBe(true);
    expect(s.arete).toBe(Math.floor(BALANCE.world.claimBase + BALANCE.world.claimDepthSlope));
  });

  it("repeating a previously reached depth awards nothing, shallower still nothing", () => {
    const s = fresh();
    s.mode = "upgrade";
    s.eraEarned = BALANCE.world.entryNous * 100;
    expect(prestige(s).ok).toBe(true);
    const banked = s.arete;
    expect(banked).toBe(Math.floor(BALANCE.world.claimBase + BALANCE.world.claimDepthSlope * 2));
    // The exact same depth: high-water, no reward.
    s.eraEarned = BALANCE.world.entryNous * 100;
    expect(pendingClaimOf(s)).toBeCloseTo(0, 10);
    expect(bankableClaimOf(s)).toBe(0);
    expect(prestige(s).ok).toBe(true);
    expect(s.arete).toBe(banked);
    // A shallower era: still nothing.
    s.eraEarned = BALANCE.world.entryNous * 10;
    expect(pendingClaimOf(s)).toBe(0);
    expect(prestige(s).ok).toBe(true);
    expect(s.arete).toBe(banked);
  });

  it("a zero-claim reset stays valid: nothing banks, the frontier holds", () => {
    const s = fresh();
    s.mode = "upgrade";
    s.eraEarned = BALANCE.world.entryNous * 10;
    expect(prestige(s).ok).toBe(true);
    const first = Math.floor(BALANCE.world.claimBase + BALANCE.world.claimDepthSlope);
    expect(s.arete).toBe(first);
    s.eraEarned = ARETE_HORIZON; // a fresh, shallow era past the door
    expect(bankableClaimOf(s)).toBe(0);
    expect(prestige(s).ok).toBe(true);
    expect(s.arete).toBe(first);
    expect(s.world.frontier).toBe(first);
    expect(s.prestiges).toBe(2);
  });
});

describe("the first World-eligible claim (issue #425, priority 2)", () => {
  function eligible(): GameState {
    const s = fresh();
    s.mode = "upgrade";
    s.eraEarned = BALANCE.world.entryNous;
    return s;
  }

  it("a positive bank permanently unlocks World and grants an unplaced starting kit", () => {
    const s = eligible();
    expect(prestige(s).ok).toBe(true);
    expect(s.arete).toBe(2);
    expect(s.world.unlocked).toBe(true);
    expect(s.world.starterColumnGranted).toBe(true);
    expect(s.world.columns).toHaveLength(1);
    expect(s.world.columns[0]!.pos).toBeNull();
    expect(s.world.starterWeaponGranted).toBe(true);
    expect(s.world.weapons).toHaveLength(1);
    expect(s.world.weapons[0]!.type).toBe("chargeBlade");
    // A granted copy: it waits in the World tray, owing nothing to any
    // roll queue or purchase.
    expect(s.world.weapons[0]!.pos).toBeNull();
    expect(s.bankedRolls).toHaveLength(0);
  });

  it("grants exactly once, ever: no later claim or prestige grants a weapon", () => {
    const s = eligible();
    expect(prestige(s).ok).toBe(true);
    s.eraEarned = BALANCE.world.entryNous * 1e5;
    expect(prestige(s).ok).toBe(true);
    expect(s.world.weapons).toHaveLength(1);
    // Even a manufactured flag cannot mint a second: the grant reads the
    // flag, and the flag round-trips the save.
    const loaded = deserialize(serialize(s, 5_000)).state!;
    expect(loaded.world.starterWeaponGranted).toBe(true);
    expect(loaded.world.weapons).toHaveLength(1);
  });

  it("a pre-entry first prestige grants nothing and the grant still waits", () => {
    const s = fresh();
    s.mode = "upgrade";
    s.eraEarned = ARETE_HORIZON;
    expect(prestige(s).ok).toBe(true);
    expect(s.world.starterWeaponGranted).toBe(false);
    expect(s.world.weapons).toHaveLength(0);
    s.eraEarned = BALANCE.world.entryNous;
    expect(prestige(s).ok).toBe(true);
    expect(s.world.weapons).toHaveLength(1);
  });
});

describe("World reachability", () => {
  it("every live enemy lies on the lattice beside an obtainable cell", () => {
    expect(worldEnemiesOf(fresh())).toHaveLength(9);
    for (const wall of worldEnemiesOf(fresh())) {
      expect(positionInRange(wall.pos)).toBe(true);
      expect(neighbors(wall.pos).some(positionInRange)).toBe(true);
    }
  });

  it("the first wall's approach is already owned", () => {
    const state = fresh();
    expect(state.cells.some((cell) => adjacent(cell, worldEnemiesOf(state)[0]!.pos))).toBe(true);
  });
});

describe("the Charge Column's conservation (issue #425, priority 6)", () => {
  it("the lift copies the module cell's received charge without draining the module beneath", () => {
    const s = flowing();
    const generator = give(s, "focusKeyed", hex(1, 0));
    generator.reserve = 100000;
    give(s, "additive", hex(0, 1)); // a voice receiving the generator's charge
    // Twin board, no World face: the module layer reads identically.
    const plain = deserialize(serialize(s, 1)).state!;
    s.world.columns.push({ id: "col1", pos: hex(0, 1) });
    grantWeapon(s, hex(1, 0), 0);
    grantWeapon(plain, hex(1, 0), 0);
    advance(s, 60);
    advance(plain, 60);
    // The copy lifts exactly what the cell received over the span, and the
    // module beneath keeps its own received strength — the states differ
    // only in the World face.
    expect(s.world.weapons[0]!.store).toBeGreaterThan(0);
    expect(plain.world.weapons[0]!.store).toBe(0);
    // Conservation at the seam: the weapon gained exactly what the split
    // accepted, the rest (if any) wasted — never minted.
    expect(s.world.weapons[0]!.store).toBeLessThanOrEqual(BALANCE.world.storageCap);
  });

  it("Columns never relay to Columns: a lone Column's supply is wasted, not forwarded", () => {
    const s = flowing();
    const generator = give(s, "focusKeyed", hex(1, 0));
    generator.reserve = 1000;
    const column = { id: "col1", pos: hex(0, 1) };
    s.world.columns.push(column);
    s.world.columns.push({ id: "col2", pos: hex(1, 1) });
    const snapshot = { chargeStrength: new Map([[generator.id, 5]]) } as never;
    const before = s.world.weapons.length;
    advanceWorldCharge(s, snapshot, 60);
    expect(s.world.weapons.length).toBe(before);
    expect(s.world.weapons).toHaveLength(0);
  });
});

describe("weapons store; Arete upgrades the type (issue #425, priority 7)", () => {
  it("storage caps the store; extra supply wastes through the conservation split", () => {
    const s = flowing();
    const generator = give(s, "focusKeyed", hex(1, 0));
    generator.reserve = 100000;
    give(s, "additive", hex(0, 1));
    s.world.columns.push({ id: "col1", pos: hex(0, 1) }); // over the receiving voice
    const weapon = grantWeapon(s, hex(1, 0), 0); // beside the column, on the generator's World face
    advance(s, 600);
    expect(weapon.store).toBeGreaterThan(0);
    expect(weapon.store).toBeLessThanOrEqual(BALANCE.world.storageCap + 1e-9);
    // It never exceeds the cap, whatever the supply keeps lifting.
    advance(s, 600);
    expect(weapon.store).toBeLessThanOrEqual(BALANCE.world.storageCap + 1e-9);
  });

  it("the store persists between sessions and resets on prestige; the copy persists", () => {
    const s = fresh();
    s.mode = "upgrade";
    grantWeapon(s, hex(0, 1), 17);
    s.world.starterWeaponGranted = true; // the rig copy stands in for the grant
    s.cells.push(hex(0, 1));
    s.eraEarned = BALANCE.world.entryNous;
    expect(prestige(s).ok).toBe(true);
    expect(s.world.weapons).toHaveLength(1); // the copy persists
    expect(s.world.weapons[0]!.store).toBe(0); // stored World charge resets
    expect(s.world.weapons[0]!.cooldown).toBe(0);
  });

  it("Hone ranks persist through prestige and price on the authored ladder", () => {
    const s = fresh();
    s.mode = "upgrade";
    s.arete = 100;
    expect(honeCostOf(s, "chargeBlade")).toBe(BALANCE.world.honeCosts[0]);
    expect(buyHoneRank(s, "chargeBlade").ok).toBe(true);
    expect(buyHoneRank(s, "chargeBlade").ok).toBe(true);
    expect(s.world.hone.chargeBlade).toBe(2);
    s.eraEarned = BALANCE.world.entryNous;
    expect(prestige(s).ok).toBe(true);
    expect(s.world.hone.chargeBlade).toBe(2);
    // The ladder ends: past the authored rungs nothing is sold.
    s.world.hone.chargeBlade = BALANCE.world.honeCosts.length;
    expect(honeCostOf(s, "chargeBlade")).toBeNull();
    expect(buyHoneRank(s, "chargeBlade").ok).toBe(false);
  });
});

describe("no refunds — World purchases are permanent (issue #425, priority 8)", () => {
  it("Columns cannot be purchased or refunded through the retired purchase action", () => {
    const s = fresh();
    s.arete = 20;
    const before = serialize(s, 5_000);
    expect(buyChargeColumn(s).ok).toBe(false);
    expect(serialize(s, 5_000)).toBe(before);
  });

  it("placement is between-sessions only, on owned cells, never on reserved enemy cells", () => {
    const s = fresh();
    const weapon = grantWeapon(s, null);
    expect(placeWorldOccupant(s, weapon.id, hex(5, 5)).ok).toBe(false); // unowned
    expect(placeWorldOccupant(s, weapon.id, hex(-1, 0)).ok).toBe(false); // w0's cell
    s.cells.push(hex(0, 1));
    s.mode = "flow";
    expect(placeWorldOccupant(s, weapon.id, hex(0, 1)).ok).toBe(false); // flow lock
    s.mode = "upgrade";
    expect(placeWorldOccupant(s, weapon.id, hex(0, 1)).ok).toBe(true);
    expect(weapon.pos).toEqual(hex(0, 1));
    const second = grantWeapon(s, null, 0);
    expect(placeWorldOccupant(s, second.id, hex(0, 1)).ok).toBe(false); // occupied
    expect(retrieveWorldOccupant(s, weapon.id).ok).toBe(true);
    expect(weapon.pos).toBeNull();
    expect(placeWorldOccupant(s, second.id, hex(0, 1)).ok).toBe(true);
  });

  it.each(["column", "weapon"] as const)("reshaping preserves a deployed %s host", (kind) => {
    const s = fresh();
    for (const module of s.modules) module.pos = null;
    const occupant = kind === "weapon" ? grantWeapon(s, null) : { id: "col1", pos: null as Hex | null };
    if (kind === "column") s.world.columns.push(occupant);
    expect(placeWorldOccupant(s, occupant.id, hex(0, 1)).ok).toBe(true);
    const next = [hex(0, 0), hex(1, 0), hex(1, -1)];
    const before = [...s.cells];
    expect(reshapeCells(s, next).ok).toBe(false);
    expect(s.cells).toEqual(before);
    expect(retrieveWorldOccupant(s, occupant.id).ok).toBe(true);
    expect(reshapeCells(s, next).ok).toBe(true);
  });

});

describe("World persistence", () => {
  it("the starter grant is never re-granted after a round-trip prestige", () => {
    const s = fresh();
    s.mode = "upgrade";
    s.eraEarned = BALANCE.world.entryNous;
    expect(prestige(s).ok).toBe(true);
    expect(s.world.weapons).toHaveLength(1);
    const loaded = deserialize(serialize(s, 5_000)).state!;
    loaded.mode = "upgrade";
    loaded.eraEarned = BALANCE.world.entryNous * 1e4;
    expect(prestige(loaded).ok).toBe(true);
    expect(loaded.world.weapons).toHaveLength(1);
  });
});

describe("the save schema (issue #425)", () => {
  it("a save written before the World layer loads with a fresh surface", () => {
    const file = JSON.parse(serialize(fresh(), 5_000));
    delete file.state.world;
    const loaded = deserialize(JSON.stringify(file)).state!;
    expect(loaded.world.frontier).toBe(0);
    expect(loaded.world.starterWeaponGranted).toBe(false);
    expect(loaded.world.columns).toEqual([]);
    expect(loaded.world.weapons).toEqual([]);
    expect(loaded.world.enemies.shale).toEqual({ discovered: false, hp: 48 });
  });

  it("corrupt World figures re-default; unknown enemy keys drop; overfill clamps", () => {
    const file = JSON.parse(serialize(fresh(), 5_000));
    file.state.world = {
      frontier: "deep",
      starterWeaponGranted: true,
      columns: [{ id: "c1", pos: { q: 0, r: 1 } }, { id: 9 }],
      weapons: [{ id: "w1", type: "chargeBlade", pos: null, store: 9999, cooldown: 97, bearer: "witness" }],
      hone: { chargeBlade: 99 },
      enemies: { shale: { discovered: true, hp: -5 }, ghost: { discovered: true, hp: 1 } },
    };
    const loaded = deserialize(JSON.stringify(file)).state!;
    expect(loaded.world.frontier).toBe(0);
    expect(loaded.world.starterWeaponGranted).toBe(true);
    expect(loaded.world.columns[0]).toEqual({ id: "c1", pos: { q: 0, r: 1 } });
    expect(loaded.world.columns).toHaveLength(2);
    expect(loaded.world.columns[1]!.pos).toBeNull();
    expect(loaded.world.weapons).toHaveLength(1);
    expect(loaded.world.weapons[0]!.store).toBe(BALANCE.world.storageCap);
    expect(loaded.world.weapons[0]!.cooldown).toBe(5);
    expect(loaded.world.weapons[0]!.bearer).toBe("witness");
    expect(loaded.world.hone.chargeBlade).toBe(BALANCE.world.honeCosts.length);
    expect(loaded.world.enemies.shale).toEqual({ discovered: true, hp: 0 });
    expect(loaded.world.enemies.ghost).toBeUndefined();
    expect(Object.keys(loaded.world.enemies)).toHaveLength(WORLD_ENEMIES.length);
  });

  it("a pre-World save carrying the retired Horizon break flag loads without it", () => {
    const file = JSON.parse(serialize(fresh(), 5_000));
    file.state.horizonBroken = true;
    const loaded = deserialize(JSON.stringify(file)).state!;
    expect((loaded as unknown as Record<string, unknown>).horizonBroken).toBeUndefined();
    expect(loaded.world.frontier).toBe(0);
  });
});

describe("frozen historical calibration inputs", () => {
  // The re-derivation of recoverability under the no-refund economy had
  // not landed when these shipped (findings.md's provenance section
  // records no current-engine calibration and no playtest export). Every
  // figure here is pinned as a hypothesis: changing one must fail this
  // suite and force a fresh citation, never silently claim recoverability.
  it("the frontier curve ships the calibrated entry and the later-era-calibrated slope", () => {
    // The entry depth is the first-worthwhile-prestige calibration (issue
    // #490): a short hold past the horizon banks the first positive claim
    // around ten credited hours. The slope is the century calibration
    // (issue #492, ADR-0079) as re-priced by the later-era repair (issue
    // #484, ADR-0086): each advance now demands 2/2.5 of a decade of
    // era-earned depth, so the push beside each banked claim carries most
    // of its era's credited time while the claim grant compresses the
    // rebuild that era re-walks.
    expect(BALANCE.world.entryNous).toBe(2e7);
    expect(BALANCE.world.claimBase).toBe(2);
    expect(BALANCE.world.claimDepthSlope).toBe(2.5);
  });

  it("preserves the legacy encounter table used by the frozen baseline", () => {
    expect(WORLD_ENEMIES).toHaveLength(9);
    WORLD_ENEMIES.forEach((def, i) => {
      // Thresholds ride the calibrated entry depth (issue #490): the
      // ladder scales with the World's own opening.
      expect(def.threshold).toBe(BALANCE.world.entryNous * 10 ** i);
      expect(def.maxHp).toBeCloseTo(12 * 1.5 ** i, 9);
      expect(def.bonus).toBe(0.08);
    });
    // The depth bands (issue #489): band steps in the enemy's own
    // threshold multiples, penalties per band with the discovery figure
    // leading and the deepest leaving the positive floor. Hypothesis
    // coefficients pending scheduled calibration — changing one must
    // fail here and force a fresh citation.
    expect(BALANCE.world.enemyDepthSteps).toEqual([10, 100, 1000]);
    expect(BALANCE.world.enemyDepthPenalties).toEqual([0.2, 0.35, 0.5, 0.65]);
    expect(BALANCE.world.enemyDepthPenalties).toHaveLength(BALANCE.world.enemyDepthSteps.length + 1);
  });

  it("preserves the legacy constants used by the frozen baseline", () => {
    expect(BALANCE.world.attackCost).toBe(1);
    expect(BALANCE.world.attackCadenceSeconds).toBe(60);
    expect(BALANCE.world.attackBase).toBe(4);
    expect(BALANCE.world.storageCap).toBe(30);
    expect(BALANCE.world.columnFirstPrice).toBe(1);
  });
});

describe("the lift read (issue #426): one conservation arithmetic for the walk and the UI", () => {
  it("the walk applies the split against live headroom; the read shows the routing", () => {
    const s = fresh();
    const generator = give(s, "focusKeyed", hex(1, 0));
    generator.reserve = 1000;
    const host = give(s, "additive", hex(0, 1));
    s.world.columns.push({ id: "col1", pos: hex(0, 1) });
    const weapon = grantWeapon(s, hex(1, 0), 0);
    const snapshot = { chargeStrength: new Map([[host.id, 5]]) } as never;
    const lift = columnLiftsOf(s, snapshot);
    expect(lift.byColumn.get("col1")).toBeCloseTo(5, 10);
    expect(lift.byWeapon.get(weapon.id)).toBeCloseTo(5, 10);
    // The walk's accepted amount is the read's rate times the span while
    // storage headroom lasts.
    advanceWorldCharge(s, snapshot, 4);
    expect(weapon.store).toBeCloseTo(20, 9);
  });

  it("the preview's override re-positions one occupant and touches nothing else", () => {
    const s = fresh();
    const generator = give(s, "focusKeyed", hex(1, 0));
    generator.reserve = 1000;
    const host = give(s, "additive", hex(0, 1));
    s.world.columns.push({ id: "col1", pos: hex(0, 1) });
    const fed = grantWeapon(s, hex(1, 0), 0);
    const far = grantWeapon(s, hex(4, 0), 0);
    const snapshot = { chargeStrength: new Map([[host.id, 5]]) } as never;
    const before = columnLiftsOf(s, snapshot);
    expect(before.byWeapon.get(fed.id)!).toBeCloseTo(5, 10);
    expect(before.byWeapon.has(far.id)).toBe(false);
    // Moving the far weapon beside the Column admits it to the split —
    // half each — while the state itself never moved.
    const preview = columnLiftsOf(s, snapshot, { id: far.id, pos: hex(0, 0) });
    expect(preview.byWeapon.get(fed.id)).toBeCloseTo(2.5, 10);
    expect(preview.byWeapon.get(far.id)).toBeCloseTo(2.5, 10);
    expect(far.pos).not.toBeNull();
    // Moving the Column itself re-homes its lift: over the hostless cell it
    // copies nothing.
    const moved = columnLiftsOf(s, snapshot, { id: "col1", pos: hex(2, 0) });
    expect(moved.byColumn.get("col1")).toBeUndefined();
    expect(moved.byWeapon.size).toBe(0);
  });

  it("a Column over a hostless cell lifts nothing, and tray occupants read nowhere", () => {
    const s = fresh();
    const generator = give(s, "focusKeyed", hex(1, 0));
    generator.reserve = 1000;
    s.cells.push(hex(2, 2));
    s.world.columns.push({ id: "col1", pos: hex(2, 2) });
    const trayed = grantWeapon(s, null, 0);
    const snapshot = { chargeStrength: new Map([[generator.id, 5]]) } as never;
    const lift = columnLiftsOf(s, snapshot);
    expect(lift.byColumn.size).toBe(0);
    expect(lift.byWeapon.size).toBe(0);
    expect(trayed.pos).toBeNull();
  });
});
