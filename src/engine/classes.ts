import { BALANCE, EPS } from "./constants";
import { bankRolls, generateOffer, generateSpecialOffer, type Rng } from "./rolls";
import { activeHabit, type Habit } from "./habits";
import { NumericFault, requireFinite } from "./numeric";
import { createWeapon } from "./state";
import { FORGE_WEAPONS, type ForgeWeapon } from "./weapons";
import type { ClassId, ClassPairState, GameState } from "./types";
export type { ClassId, ClassPairState };

// The habit-class layer (ADR-0074, issue #423). A habit wears one class;
// progression belongs to the habit–class PAIR — experience, level, tree
// points, allocations, and partial roll progress — and switching habits or
// classes freezes a pair in place, never destroying what it earned.
// Credited flow time with the pair selected is the only class
// development: the accrual legs are advance's live sink and the honesty
// report's credited reconciliation, exactly where habit seconds and goal
// advancement already ride. Manual logs advance neither class experience
// nor class reward progress; breathers grant neither; unstructured
// practice runs production and charge forging and earns nothing
// class-side.
//
// Each class assigns its own reward to the pair's one practice meter.
// Engineer mints module rolls; Blacksmith banks a weapon choice for
// later. Neither reward takes session attention.

// One tree node. `maxRank` bounds the ranks; `requiredLevel` is the
// explicit prerequisite — the class level the pair must hold before the
// node takes any rank. Effects read the figures from BALANCE; nothing
// here carries a magic number.
export interface ClassNodeDef {
  id: string;
  name: string;
  branch: "draft-control" | "merge-progression";
  maxRank: number;
  requiredLevel: number;
  effect: string;
}

// One authored allocation a player can apply in one move. A preset is an
// ordinary allocation — the same freely adjustable points, never an
// exclusive benefit; applying it requires the node prerequisites the
// current level satisfies and a point budget the pair has actually
// earned.
export interface ClassPresetDef {
  id: string;
  name: string;
  spent: Record<string, number>;
}

export interface ClassDef {
  id: ClassId;
  name: string;
  levelThresholds: readonly number[];
  nodes: readonly ClassNodeDef[];
  presets: readonly ClassPresetDef[];
}

const ENGINEER_NODES: readonly ClassNodeDef[] = [
  {
    id: "governor",
    name: "Governor",
    branch: "draft-control",
    maxRank: 2,
    requiredLevel: 1,
    effect: `flat roll cadence −${Math.round(BALANCE.engineerCadenceDiscountPerRank * 100)}% per rank`,
  },
  {
    id: "reed",
    name: "Reed",
    branch: "merge-progression",
    maxRank: 2,
    requiredLevel: 3,
    effect: `+${Math.round(BALANCE.engineerTierChancePerRank * 100)}% tier chance on practice mints per rank`,
  },
  {
    id: "punch-card",
    name: "Punch card",
    branch: "draft-control",
    maxRank: 1,
    requiredLevel: 5,
    effect: `every ${BALANCE.engineerGuaranteedWeaveNth}th practice mint weaves a guaranteed-rare draft`,
  },
];

export const CLASSES: readonly ClassDef[] = [
  {
    id: "engineer",
    name: "Engineer",
    levelThresholds: BALANCE.engineerLevelThresholds,
    nodes: ENGINEER_NODES,
    presets: [
      { id: "engineer-default", name: "Default", spent: { governor: 2, reed: 1 } },
      { id: "engineer-cadence", name: "Draft control", spent: { governor: 2 } },
      { id: "engineer-merge", name: "Plying", spent: { reed: 2 } },
    ],
  },
  { id: "blacksmith", name: "Blacksmith", levelThresholds: [], nodes: [], presets: [] },
];

const CLASS_BY_ID: ReadonlyMap<ClassId, ClassDef> = new Map(CLASSES.map((def) => [def.id, def]));

export function classDefOf(classId: ClassId): ClassDef {
  return CLASS_BY_ID.get(classId) ?? CLASSES[0]!;
}

// The registry's known ids — the lenient default's whitelist.
export const CLASS_IDS: readonly ClassId[] = CLASSES.map((def) => def.id);

function classAvailable(state: GameState, id: ClassId): boolean {
  return id !== "blacksmith" || state.world.unlocked;
}

export function availableClasses(state: GameState): readonly ClassDef[] {
  return CLASSES.filter(({ id }) => classAvailable(state, id));
}

export function freshClassPair(id: ClassId = "engineer"): ClassPairState {
  return {
    experience: 0, level: id === "blacksmith" ? 1 : 0, points: 0, spent: {}, rollMeter: { progress: 0, earned: 0 },
    ...(id === "blacksmith" && { weaponClaims: 0 }),
  };
}

export function createHabitClasses(): Habit["classes"] {
  return { engineer: freshClassPair() };
}

// The pair's own def — defaults to the launch class for an unknown id
// (the one lenient spelling, like normalizeGoalColor).
export function pairDef(habit: Habit): ClassDef {
  return classDefOf(habit.classId);
}

// The habit's selected pair — the accrual target. A save can carry an
// unknown classId only before normalization; readers guard with the same
// default the normalizer writes.
export function pairOf(habit: Habit): ClassPairState {
  return habit.classes[habit.classId] ?? freshClassPair(habit.classId);
}

// The session's active pair: the active habit wearing its selected class.
// Null whenever no habit is selected — unstructured sessions earn nothing
// class-side.
export function activePair(state: GameState): { habit: Habit; classId: ClassId; pair: ClassPairState } | null {
  const habit = activeHabit(state);
  if (!habit) return null;
  return { habit, classId: habit.classId, pair: pairOf(habit) };
}

// The node's allocated rank, validated against the def.
export function rankOf(pair: ClassPairState, node: ClassNodeDef): number {
  const rank = pair.spent[node.id] ?? 0;
  return Number.isInteger(rank) && rank > 0 ? Math.min(rank, node.maxRank) : 0;
}

// Whether the node's prerequisite stands at the pair's current level.
export function nodeAvailable(pair: ClassPairState, node: ClassNodeDef): boolean {
  return pair.level >= node.requiredLevel;
}

// The def's node by id — the registry is code, so an unknown id reads
// undefined and every caller guards.
function nodeOf(def: ClassDef, nodeId: string): ClassNodeDef | undefined {
  return def.nodes.find((node) => node.id === nodeId);
}

// The Governor ranks' discount on the flat cadence block.
function cadenceDiscount(pair: ClassPairState, def: ClassDef): number {
  const governor = nodeOf(def, "governor");
  if (!governor) return 0;
  return rankOf(pair, governor) * BALANCE.engineerCadenceDiscountPerRank;
}

// The practice-roll meter's threshold: the one fast opening fill, then
// the flat cadence block — discounted only on the flat side by the
// Governor's bounded ranks. A duration of credited seconds.
export function practiceRollThreshold(pair: ClassPairState, earned: number, def: ClassDef = classDefOf("engineer")): number {
  if (earned === 0) return BALANCE.flowOpeningSeconds;
  const discount = Math.min(0.99, cadenceDiscount(pair, def));
  return BALANCE.flowCadenceSeconds * (1 - discount);
}

// The Reed ranks' extra tier-lift chance on this pair's practice mints.
function mintTierChance(pair: ClassPairState, def: ClassDef): number {
  const reed = nodeOf(def, "reed");
  if (!reed) return 0;
  return rankOf(pair, reed) * BALANCE.engineerTierChancePerRank;
}

// Every practice-minted roll ever banked from any pair — the truth the
// first-roll rig and the rolls-taken feats read, whatever the class
// layout. The retired flow meter's earned count fed the same figure.
export { totalPracticeRollsEarned } from "./rolls";

// The pair's mint generator: the ordinary draw with the pair's own tree
// shapes — the Reed ranks' tier lift on every candidate, and the Punch
// card's guaranteed-rare weave on every nth crossing. One crossing mints
// one offer, whichever shape it takes.
function generatePracticeOffer(state: GameState, pair: ClassPairState, def: ClassDef, rng: Rng) {
  const punchCard = nodeOf(def, "punch-card");
  if (
    punchCard &&
    rankOf(pair, punchCard) > 0 &&
    pair.rollMeter.earned > 0 &&
    pair.rollMeter.earned % BALANCE.engineerGuaranteedWeaveNth === 0
  ) {
    return generateSpecialOffer(state, "rare", "oscillator", rng);
  }
  return generateOffer(state, rng, mintTierChance(pair, def));
}

export function weaponChoicesOf(habit: Habit): number {
  const pair = habit.classes.blacksmith;
  return pair?.weaponClaims !== undefined ? pair.rollMeter.earned - pair.weaponClaims : 0;
}

function creditWeaponForge(pair: ClassPairState, seconds: number): void {
  const meter = pair.rollMeter;
  const threshold = BALANCE.blacksmithForgeSeconds;
  const total = requireFinite(meter.progress + seconds, "Blacksmith forge progress");
  const remainder = total % threshold;
  // Thousands of fractional credits can leave a completed fill a few
  // ulps short. Allow one nanosecond of accumulation error at the edge,
  // not a tolerance proportional to the total or number of fills.
  const atEdge = threshold - remainder <= 1e-9;
  const progress = atEdge ? 0 : remainder;
  const fills = Math.round((total - remainder) / threshold) + (atEdge ? 1 : 0);
  const earned = meter.earned + fills;
  if (!Number.isSafeInteger(earned)) throw new NumericFault("Blacksmith weapon choices");
  meter.progress = progress;
  meter.earned = earned;
}

// The credited-time boundary: called only by live advance and resolved
// honesty credit. Returns module rolls only; Blacksmith never touches the
// shared roll queue, its RNG, the first-roll rig, or Forge notifications.
export function accrueClassDevelopment(state: GameState, seconds: number, rng: Rng): number {
  if (seconds <= EPS) return 0;
  const active = activePair(state);
  if (!active || !classAvailable(state, active.classId)) return 0;
  const { habit, classId } = active;
  const pair = habit.classes[classId] ??= freshClassPair(classId);
  pair.experience = requireFinite(pair.experience + seconds, "class experience");
  if (classId === "blacksmith") {
    creditWeaponForge(pair, seconds);
    return 0;
  }
  const def = pairDef(habit);
  const thresholds = def.levelThresholds;
  while (pair.level < thresholds.length && pair.experience >= thresholds[pair.level]!) {
    pair.level++;
    pair.points++;
  }
  return bankRolls(
    pair.rollMeter,
    "flow",
    seconds,
    (earned) => practiceRollThreshold(pair, earned, def),
    state,
    rng,
    state.bankedRolls,
    (s, r) => generatePracticeOffer(s, pair, def, r),
  );
}

// ── Between-sessions actions (upgrade mode only; the session lock) ──────

// The habit-lock's class sibling (issue #423's one-place rule): the same
// refusal surface, one sentence over.
const CLASS_MODE_LOCK = "The active class is locked during flow.";

// The one habit lookup every class action shares: upgrade-mode gate, the
// live-habit find, and the shared refusal.
function classHabitOf(state: GameState, habitId: string): { habit: Habit } | { ok: false; reason: string } {
  if (state.mode !== "upgrade") return { ok: false, reason: CLASS_MODE_LOCK };
  const habit = state.habits.find((h) => h.id === habitId && !h.archived);
  if (!habit) return { ok: false, reason: "Habit not found." };
  return { habit };
}

export function selectHabitClass(state: GameState, habitId: string, classId: ClassId): { ok: boolean; reason?: string } {
  const found = classHabitOf(state, habitId);
  if (!("habit" in found)) return found;
  if (!CLASS_IDS.includes(classId)) return { ok: false, reason: "That class does not exist." };
  if (!classAvailable(state, classId)) return { ok: false, reason: "Discover World to select Blacksmith." };
  found.habit.classId = classId;
  found.habit.classes[classId] ??= freshClassPair(classId);
  return { ok: true };
}

export function claimForgedWeapon(state: GameState, habitId: string, type: ForgeWeapon): { ok: boolean; reason?: string } {
  const found = classHabitOf(state, habitId);
  if (!("habit" in found)) return found;
  const { habit } = found;
  if (!state.world.unlocked || state.activeHabitId !== habitId || habit.classId !== "blacksmith") {
    return { ok: false, reason: "Select the habit and its Blacksmith class to forge a weapon." };
  }
  if (!FORGE_WEAPONS.includes(type)) return { ok: false, reason: "Choose a Blacksmith weapon." };
  if (weaponChoicesOf(habit) < 1) return { ok: false, reason: "No weapon choice is banked." };
  const pair = pairOf(habit);
  state.world.weapons.push(createWeapon(state, type));
  pair.weaponClaims = (pair.weaponClaims ?? 0) + 1;
  return { ok: true };
}

export function allocateClassNode(state: GameState, habitId: string, nodeId: string): { ok: boolean; reason?: string } {
  const found = classHabitOf(state, habitId);
  if (!("habit" in found)) return found;
  const def = pairDef(found.habit);
  const node = nodeOf(def, nodeId);
  if (!node) return { ok: false, reason: "That tree node does not exist." };
  const pair = pairOf(found.habit);
  if (!nodeAvailable(pair, node)) return { ok: false, reason: `${node.name} unlocks at class level ${node.requiredLevel}.` };
  if (rankOf(pair, node) >= node.maxRank) return { ok: false, reason: `${node.name} is fully ranked.` };
  if (pair.points < 1) return { ok: false, reason: "No tree points to allocate — level up through practice." };
  pair.points--;
  pair.spent[node.id] = rankOf(pair, node) + 1;
  return { ok: true };
}

// Respec (ADR-0074): all spent points return to the balance between
// sessions. Experience, level, and the meter are untouched — the free
// reassignment is the whole act.
export function respecClassTree(state: GameState, habitId: string): { ok: boolean; reason?: string } {
  const found = classHabitOf(state, habitId);
  if (!("habit" in found)) return found;
  const pair = pairOf(found.habit);
  for (const node of pairDef(found.habit).nodes) {
    pair.points += rankOf(pair, node);
  }
  pair.spent = {};
  return { ok: true };
}

// Applying a preset writes the ordinary allocation it names — subject to
// the same prerequisites and the same point budget as a hand
// allocation. Nothing exclusive, nothing extra: unlisted nodes reset,
// and the pair's earned points must cover every rank the preset spends.
export function applyClassPreset(state: GameState, habitId: string, presetId: string): { ok: boolean; reason?: string } {
  const found = classHabitOf(state, habitId);
  if (!("habit" in found)) return found;
  const def = pairDef(found.habit);
  const preset = def.presets.find((p) => p.id === presetId);
  if (!preset) return { ok: false, reason: "That preset does not exist." };
  const pair = pairOf(found.habit);
  let wanted = 0;
  for (const node of def.nodes) {
    const rank = preset.spent[node.id] ?? 0;
    if (rank > node.maxRank) return { ok: false, reason: "That preset spends past a node's rank cap." };
    if (rank > 0 && !nodeAvailable(pair, node)) {
      return { ok: false, reason: `${node.name} unlocks at class level ${node.requiredLevel}.` };
    }
    wanted += rank;
  }
  let owned = pair.points;
  for (const node of def.nodes) owned += rankOf(pair, node);
  if (wanted > owned) return { ok: false, reason: "Not enough tree points for that preset yet." };
  pair.spent = {};
  for (const node of def.nodes) {
    const rank = preset.spent[node.id] ?? 0;
    if (rank > 0) pair.spent[node.id] = rank;
  }
  pair.points = owned - wanted;
  return { ok: true };
}

// Load-time lenient defaults (issue #423): a habit saved before the class
// wave carries neither a class id nor per-pair state — every habit reads
// as an Engineer from zero, exactly what a fresh shape writes. Unknown
// class ids fall back to the launch class; unknown pair keys drop;
// corrupt figures re-default; spent node ids the registry does not know
// drop, and ranks clamp at their caps. Mutates in place over the merged
// state's habit list.
export function normalizeHabitClasses(habits: Habit[]): void {
  for (const habit of habits) {
    if (!habit || typeof habit !== "object") continue;
    habit.classId = CLASS_IDS.includes(habit.classId as ClassId) ? (habit.classId as ClassId) : "engineer";
    const carried: Partial<Habit["classes"]> = habit.classes && typeof habit.classes === "object" ? habit.classes : {};
    const classes = createHabitClasses();
    for (const id of CLASS_IDS) {
      const raw = carried[id];
      if (id === "blacksmith" && !raw && habit.classId !== id) continue;
      const pair: ClassPairState = raw && typeof raw === "object" ? raw : freshClassPair(id);
      pair.experience = Number.isFinite(pair.experience) && pair.experience > 0 ? pair.experience : 0;
      pair.level = Number.isInteger(pair.level) && pair.level > 0 ? pair.level : 0;
      pair.points = Number.isFinite(pair.points) && pair.points > 0 ? Math.floor(pair.points) : 0;
      const meter = pair.rollMeter && typeof pair.rollMeter === "object" ? pair.rollMeter : freshClassPair().rollMeter;
      const progress = Number.isFinite(meter.progress) && meter.progress > 0 ? meter.progress : 0;
      if (id === "blacksmith") {
        // A lost claim count cannot turn prior claims back into banked weapons.
        const claimed = pair.weaponClaims;
        const validCounts = Number.isSafeInteger(meter.earned) && claimed !== undefined &&
          Number.isSafeInteger(claimed) && claimed >= 0 && meter.earned >= claimed;
        pair.rollMeter = {
          progress: progress < BALANCE.blacksmithForgeSeconds ? progress : 0,
          earned: validCounts ? meter.earned : 0,
        };
        pair.weaponClaims = validCounts ? claimed : 0;
        pair.level = 1;
        pair.points = 0;
      } else {
        pair.rollMeter = {
          progress,
          earned: Number.isFinite(meter.earned) && meter.earned > 0 ? Math.floor(meter.earned) : 0,
        };
        delete pair.weaponClaims;
      }
      const def = classDefOf(id);
      const spent: Record<string, number> = {};
      if (pair.spent && typeof pair.spent === "object") {
        for (const node of def.nodes) {
          const rank = pair.spent[node.id];
          if (Number.isInteger(rank) && rank! > 0) spent[node.id] = Math.min(rank!, node.maxRank);
        }
      }
      pair.spent = spent;
      // A carried shape that claims ranks past its level's reach re-derives
      // unspent points from the conservation read (earned = spent + unspent
      // can never exceed the level count).
      const spentTotal = Object.values(spent).reduce((sum, rank) => sum + rank, 0);
      pair.points = Math.max(0, Math.min(pair.points, Math.max(0, pair.level - spentTotal)));
      classes[id] = pair;
    }
    habit.classes = classes;
  }
}
