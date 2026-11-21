// A bounded, deterministic evaluation of the fixed World-combat proof.
// Every change after fixture construction uses normal game actions and
// the existing trusted session walk, not a second combat simulator.
import { buyCell, buyHoneRank, endSession, placeWorldOccupant, prestige, retrieveWorldOccupant, startSession, type ActionResult } from "./actions";
import { advance } from "./advance";
import { hex } from "./hex";
import type { GameState, Hex } from "./types";
import { attackPowerOf, enemyStateOf, syncWorldDiscoveries, worldEnemiesOf, worldPiecesOf } from "./world";
import { createInitialState, createWeapon } from "./state";
import { createWorldCombatScenario } from "./world-combat-scenario";

const EPOCH = Date.UTC(2026, 10, 21, 12);
const rng = () => 0.3;
const kitOf = ({ world }: GameState) => ({
  creature: world.creatures[0]!, armor: world.armor[0]!, spell: world.spells[0]!, conduit: world.conduits[0]!,
});
const stamp = (state: GameState) => EPOCH + state.world.elapsed * 1_000;

function sample(state: GameState) {
  const { creature, spell } = kitOf(state);
  return {
    worldSeconds: state.world.elapsed,
    creditedSeconds: state.sessionRecords.reduce((total, record) => total + record.creditedSeconds, 0) + (state.session?.accounting.creditedSeconds ?? 0),
    sentinelHp: creature.hp,
    deployed: creature.pos !== null,
    recovering: creature.recovering,
    shaleHp: enemyStateOf(state, "shale").hp,
    basaltHp: enemyStateOf(state, "basalt").hp,
    basaltActive: enemyStateOf(state, "basalt").discovered,
    bladeCharge: state.world.weapons[0]!.store,
    pulseCharge: spell.store,
    eraEarned: state.eraEarned,
  };
}

type Point = ReturnType<typeof sample> & { phase: string };
function accept(what: string, result: ActionResult): void {
  if (!result.ok) throw new Error(`${what}: ${result.reason}`);
}
function land(state: GameState, id: string, pos: Hex): void {
  accept(`Place ${id} at ${pos.q},${pos.r}`, placeWorldOccupant(state, id, pos));
}
function flow(state: GameState, phase: string, seconds: number, points: Point[], stop: () => boolean = () => false, step = 1): void {
  accept("Start flow", startSession(state, null, stamp(state)));
  points.push({ phase, ...sample(state) });
  for (let left = seconds; left > 0 && !stop();) {
    const span = Math.min(step, left);
    const { fault } = advance(state, span, rng);
    if (fault) throw new Error(`${phase}: ${fault}`);
    left -= span;
    points.push({ phase, ...sample(state) });
  }
  accept("Finish flow", endSession(state, stamp(state)));
}

function layout(state: GameState) {
  return worldPiecesOf(state).map(({ kind, copy }) => ({ kind, id: copy.id, pos: copy.pos }));
}

function shaleWalk(origin: GameState, variant: "effective" | "attrition" | "weak") {
  const state = structuredClone(origin);
  const { armor, conduit, creature, spell } = kitOf(state);
  if (variant !== "effective") accept("Bench armor", retrieveWorldOccupant(state, armor.id));
  const [column] = state.world.columns;
  const [blade] = state.world.weapons;
  land(state, column!.id, variant === "weak" ? hex(0, -1) : hex(1, 1));
  land(state, conduit.id, hex(1, 0));
  land(state, blade!.id, hex(1, -1));
  land(state, spell.id, hex(0, 1));
  const start = sample(state);
  const points: Point[] = [];
  const wall = enemyStateOf(state, "shale");
  const limit = variant === "effective" ? 1 : variant === "weak" ? 3 : 6;
  let firstLayout: ReturnType<typeof layout> = [];
  let deployments = 0;
  for (let attempt = 1; attempt <= limit && wall.hp > 0; attempt++) {
    land(state, creature.id, hex(0, 0));
    if (attempt === 1) firstLayout = layout(state);
    deployments++;
    flow(state, `deployment ${attempt}`, 40, points, () => wall.hp === 0 || creature.recovering);
    if (creature.recovering) flow(state, `recovery ${attempt}`, 12, points);
    else break;
  }
  const end = sample(state);
  const outcome = wall.hp === 0 ? "won" : wall.hp > start.shaleHp ? "lost ground" : "not cleared";
  return { state, record: { variant, layout: firstLayout, start, end, outcome, deployments, points } };
}

function basaltWalk(origin: GameState, invest: boolean) {
  const state = structuredClone(origin);
  const { creature, armor, spell } = kitOf(state);
  const start = sample(state);
  const areteBeforeBuy = state.arete;
  if (invest) for (let rank = 0; rank < 2; rank++) accept("Buy type-wide Hone", buyHoneRank(state, "chargeBlade"));
  // The Blade uses the same Column–conduit route as in the Shale walk.
  // Remove Pulse from the comparison to observe the purchased change alone.
  accept("Bench Pulse", retrieveWorldOccupant(state, spell.id));
  land(state, creature.id, hex(2, -2));
  land(state, armor.id, hex(1, -2));
  const deployedLayout = layout(state);
  const wall = enemyStateOf(state, "basalt");
  const points: Point[] = [];
  flow(state, invest ? "Hone ranks 1+2" : "bare prestige", 24, points);
  return {
    start, end: sample(state), layout: deployedLayout, points,
    outcome: wall.hp === 0 ? "won" : creature.recovering ? "defeated" : "not cleared",
    honeRank: state.world.hone.chargeBlade, bladeDamage: attackPowerOf(state, "chargeBlade"),
    areteBeforeBuy, areteAfterBuy: state.arete,
  };
}

// The production schedule and real action prices, but NOT an acquisition
// walk. Both branches start at the same constructed frontier and reserves.
export function walkWorldCombatScale() {
  const origin = createInitialState();
  origin.eraEarned = 20_000_000;
  accept("Discover World", prestige(origin));
  origin.eraEarned = 2e15;
  origin.nous = 30_000;
  origin.arete = 15;
  const walls = worldEnemiesOf(origin);
  const wall = walls.at(-1)!;
  for (const earlier of walls.slice(0, -1)) {
    origin.world.enemies[earlier.key] = { discovered: true, hp: 0 };
  }
  syncWorldDiscoveries(origin);
  for (const [q, r] of [[1, -1], [2, -1], [2, -2], [1, -2]] as const) accept("Buy seat", buyCell(origin, hex(q, r)));
  const blade2 = createWeapon(origin, "chargeBlade");
  origin.world.weapons.push(blade2);
  land(origin, origin.world.creatures[0]!.id, hex(2, -2));
  land(origin, origin.world.armor[0]!.id, hex(1, -2));
  land(origin, origin.world.weapons[0]!.id, hex(2, -1));
  land(origin, blade2.id, hex(1, -1));
  for (const blade of origin.world.weapons) blade.store = 6;
  const baseHit = attackPowerOf(origin, "chargeBlade");
  for (let i = 0; i < 3; i++) accept("Buy shared Hone rank", buyHoneRank(origin, "chargeBlade"));
  const read = (state: GameState) => ({
    seconds: state.world.elapsed, wallHp: enemyStateOf(state, wall.key).hp,
    sentinelHp: state.world.creatures[0]!.hp, recovering: state.world.creatures[0]!.recovering,
    hit: attackPowerOf(state, "chargeBlade"), stores: state.world.weapons.map(({ store }) => store),
    arete: state.arete, nous: state.nous,
  });
  const start = read(origin);
  const play = (state: GameState) => {
    accept("Start scale fight", startSession(state, null, EPOCH));
    const { fault } = advance(state, 24, rng);
    if (fault) throw new Error(`Scale fight: ${fault}`);
    return read(state);
  };
  const invested = structuredClone(origin);
  accept("Buy final Hone rank", buyHoneRank(invested, "chargeBlade"));
  return {
    scope: "constructed production Corundum; not live acquisition, pacing, or balance calibration",
    wall: wall.name, oppositionRatioFromBasalt: wall.maxHp / walls[1]!.maxHp, baseHit,
    layout: layout(origin), start, rank3: play(origin), rank4: play(invested),
  };
}

export function walkWorldCombatProof() {
  const origin = createWorldCombatScenario();
  const { creature, armor, conduit } = kitOf(origin);
  const preparation: Point[] = [];
  // A common, played injury checkpoint matters: a weak build starting
  // against full HP can only stand still, never show an actual loss.
  land(origin, creature.id, hex(0, 0));
  land(origin, armor.id, hex(-1, 1));
  flow(origin, "common armored probe without charge", 32, preparation);
  flow(origin, "common full recovery", 12, preparation);
  const effective = shaleWalk(origin, "effective");
  const attrition = shaleWalk(origin, "attrition");
  const weak = shaleWalk(origin, "weak");

  const returned = effective.state;
  accept("Bench Sentinel for rebuild", retrieveWorldOccupant(returned, creature.id));
  const beforePrestige = { ...sample(returned), arete: returned.arete, bladeDamage: attackPowerOf(returned, "chargeBlade") };
  accept("Prestige and bank the existing claim", prestige(returned));
  const afterPrestige = { ...sample(returned), arete: returned.arete, bladeDamage: attackPowerOf(returned, "chargeBlade"), rebuildNous: returned.nous };
  const rebuild: Point[] = [];
  flow(returned, "common credited return (no deployment)", 900, rebuild, undefined, 30);
  return {
    seed: "constant RNG 0.3; no draft picks or post-fixture grants",
    conduitDirection: conduit.direction,
    preparation, beforePrestige, afterPrestige, rebuild,
    shale: [effective.record, attrition.record, weak.record] as const,
    basalt: [basaltWalk(returned, false), basaltWalk(returned, true)] as const,
  };
}
