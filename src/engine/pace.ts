import { advance } from "./advance";
import { apply, type Action, type ApplyResult } from "./apply";
import { createInitialState } from "./state";
import { cableName } from "./cables";
import { cellKind, isOpen } from "./board";
import { addCell, cellKey, DIRECTIONS, distance, FACING_NAMES, lifetimeCells, neighbours, sameCell, type Cell } from "./hex";
import { goalOf } from "./goal";
import { BASALT_CELLS, FLINT_CELL, SCHIST_CELL, SHALE_CELL, wallAt, type WallKind } from "./map";
import { cableFrom, moduleAt } from "./placement";
import { classLevel, grantsOf } from "./levels";
import { hasFacing, isArm, isModulator, isOscillator, moduleName } from "./modules";
import { add, D, fmt, fmtRate, gt, type Num } from "./num";
import type { AdvanceMode, AdvanceResult, Cable, GameState, HabitClass, ModuleType, Placement } from "./types";

// The pace runner (spec chunk 01, `npm run pace`): a scripted reasonable
// player driven only through `apply` and `advance`. It reports the credited
// hours at which each progression-map milestone was first reached, beside
// its target, and flags dry stretches. It is consulted, never a gate.
// Pure: the same script always yields the same report.

// ── Milestones ────────────────────────────────────────────────────────────

export interface MilestoneProbe {
  id: string;
  label: string;
  // The progression-map target, as printed.
  target: string;
  // Whether the state shows this milestone. Absent while the engine has no
  // such fact yet: the chunk that adds it fills the probe in here.
  reached?: (state: GameState) => boolean;
}

const classOpen = (habitClass: HabitClass) => (s: GameState) => s.game.openClasses.includes(habitClass);

const WALLS: { kind: string; target: string }[] = [
  { kind: "Shale", target: "the first session or two, under about 1h (spec 05)" },
  { kind: "Basalt", target: "Sketch, 0–15h (ring 1)" },
  { kind: "Flint", target: "Sketch, 0–15h (rings 1–2)" },
  { kind: "Schist", target: "Demo, 15–60h (rings 1–2)" },
  { kind: "Gneiss", target: "Demo, 15–60h (rings 2–3)" },
  { kind: "Obsidian", target: "Demo, by 60h (rings 2–3)" },
  { kind: "Granite", target: "Record, 60–140h (rings 3–4)" },
  { kind: "Quartz", target: "Record, 60–140h (rings 3–4)" },
  { kind: "Corundum", target: "Record, by 140h (rings 4–5)" },
];

const CLASSES: HabitClass[] = ["engineer", "producer", "roadie", "mixer"];

const CLASS_OPENS: Record<HabitClass, string> = {
  engineer: "at the start (0h)",
  producer: "at the start (0h)",
  roadie: "first contact with Flint, by about 3h (spec 05)",
  mixer: "conquering the marked Schist (Demo, 15–60h)",
};

const classAtLevel = (habitClass: HabitClass, level: number) => (s: GameState) => classLevel(s, habitClass).level >= level;

const title = (word: string) => word[0]!.toUpperCase() + word.slice(1);

// A wall kind's first conquest: an owned cell whose authored wall is of
// that kind (spec chunk 05, issue #55).
const kindConquered = (kind: WallKind) => (s: GameState) => s.game.board.open.some((cell) => wallAt(cell)?.kind === kind);
const cellConquered = (cell: Cell) => (s: GameState) => isOpen(s.game.board, cell);

export const PROGRESSION_MILESTONES: MilestoneProbe[] = [
  ...CLASSES.map((c) => ({ id: `class-open:${c}`, label: `${title(c)} opens`, target: CLASS_OPENS[c], reached: classOpen(c) })),
  ...WALLS.map((w) => ({
    id: `wall:${w.kind.toLowerCase()}`,
    label: `First ${w.kind} conquered`,
    target: w.target,
    reached: kindConquered(w.kind.toLowerCase() as WallKind),
  })),
  { id: "wall:marked-flint", label: "Marked Flint conquered", target: "after Roadie opens (Sketch, 0–15h)", reached: cellConquered(FLINT_CELL) },
  { id: "wall:marked-schist", label: "Marked Schist conquered", target: "about 8–12h (spec 05)", reached: cellConquered(SCHIST_CELL) },
  ...CLASSES.map((c) => ({ id: `class-level-5:${c}`, label: `${title(c)} level 5`, target: "8h on the class", reached: classAtLevel(c, 5) })),
  { id: "first-prestige", label: "First prestige (Sketch gate)", target: "8–10h, Demo by 15h" },
  { id: "gate:obsidian", label: "Obsidian conquered (Demo gate)", target: "60h" },
  { id: "gate:corundum", label: "Corundum conquered (Record gate)", target: "140h" },
  { id: "gate:master", label: "Master finished (Encore opens)", target: "250h" },
];

// ── The scripted player's seams ───────────────────────────────────────────

// What a tending hook may touch: the current state and wall clock to read,
// and the engine's two doors to change it. Each door moves the turn to the
// state it returns, and `advance` moves the wall clock by its seconds.
export interface PaceTurn {
  readonly state: GameState;
  readonly now: number;
  apply(action: Action): ApplyResult;
  advance(seconds: number, mode: AdvanceMode): AdvanceResult;
}

// Between sessions the player tends in upgrade mode first, then takes the
// banked breather (ADR-0095). Each hook is a named seam a later chunk
// fills; a hook stays empty until the engine has the thing it acts on.
export interface TendingHooks {
  takeBankedBreathers(turn: PaceTurn): void;
  buyCheapestFader(turn: PaceTurn): void;
  placeAllowance(turn: PaceTurn): void;
  patchChargeToNearestWall(turn: PaceTurn): void;
}

export const DEFAULT_TENDING: TendingHooks = {
  takeBankedBreathers: takeBreatherInFull,
  buyCheapestFader: () => {},
  placeAllowance: followGoal,
  // The Goal-following layout (issue #55) already patches into the Goal's
  // wall when that makes it fall soonest.
  patchChargeToNearestWall: () => {},
};

// The breather step (spec chunk 04, issue #45): the player takes the
// banked breather, runs breather time for its whole length, and dismisses
// the result, so the next session starts from upgrade mode.
export function takeBreatherInFull(turn: PaceTurn): void {
  const banked = turn.state.game.breather.banked;
  if (!banked) return;
  must(turn.apply({ type: "takeBreather", now: turn.now }), "taking the breather");
  turn.advance(banked.seconds, "breather");
  must(turn.apply({ type: "dismissBreatherResult" }), "dismissing the breather's result");
}

// The greedy placement (spec chunk 02, issue #28; chunk 03, issue #35).
// The player fills its oscillator allowance one oscillator at a time, then
// its modulator allowance one modulator at a time with every facing, then
// its cable allowance one Patch at a time, each step keeping the candidate
// that most raises the board's total ν/s. Every candidate is a short run of
// actions tried through `apply` on the current state, which is pure, so a
// trial changes nothing and a refused one is dropped; only the best is
// applied through the turn. An oscillator or modulator is placed even when
// it raises nothing, since a placed module costs nothing; a cable is left
// unused unless it raises total ν/s. Ties keep the first candidate in
// arrived-type, owned-cell, facing, then target order, so the run is
// deterministic. Nothing placed is ever moved, turned or unplugged: a later
// chunk may teach the player to rearrange. Patching into walls for damage
// is chunk 05's, once damage leads to a milestone.
// With `keep`, a candidate whose resulting state it rejects is dropped:
// the fight layout uses it so the ν/s pass never slows the wall's fall.
export function placeAllowanceGreedily(turn: PaceTurn, keep?: (state: GameState) => boolean): void {
  while (applyBest(turn, oscillatorCandidates(turn.state), true, keep));
  while (applyBest(turn, modulatorCandidates(turn.state), true, keep));
  while (applyBest(turn, armCandidates(turn.state), false, keep));
  while (applyBest(turn, cableCandidates(turn.state), false, keep));
}

type Candidate = Action[];

// Tries each candidate from the current state and applies the one that
// most raises total ν/s. With `always`, the best is applied even when it
// raises nothing. Returns whether one was applied.
function applyBest(turn: PaceTurn, candidates: Candidate[], always: boolean, keep?: (state: GameState) => boolean): boolean {
  let best: { candidate: Candidate; total: Num } | null = null;
  for (const candidate of candidates) {
    const trial = trialState(turn.state, candidate);
    if (trial === null || (keep && !keep(trial))) continue;
    const total = trial.game.rates.total;
    if (best === null || gt(total, best.total)) best = { candidate, total };
  }
  if (best === null) return false;
  if (!always && !gt(best.total, turn.state.game.rates.total)) return false;
  for (const action of best.candidate) must(turn.apply(action), `the pace runner's ${action.type}`);
  return true;
}

// The state after the candidate's actions, or null when any is refused.
function trialState(state: GameState, candidate: Candidate): GameState | null {
  let trial = state;
  for (const action of candidate) {
    const result = apply(trial, action);
    if (!result.ok) return null;
    trial = result.state;
  }
  return trial;
}

function oscillatorCandidates(state: GameState): Candidate[] {
  const { game } = state;
  return grantsOf(state).arrived.filter(isOscillator).flatMap((module) =>
    game.board.open.map((cell): Candidate => [{ type: "placeModule", module, cell }]));
}

// Each arrived cable from each placed modulator to each cell of the
// lifetime board; `apply` refuses what isn't a valid target.
function cableCandidates(state: GameState): Candidate[] {
  const { game } = state;
  const sources = game.board.placements.filter((p) => !isOscillator(p.module)).map((p) => p.cell);
  return grantsOf(state).arrivedCables.flatMap((cable) =>
    sources.flatMap((source) =>
      lifetimeCells().map((target): Candidate => [{ type: "patchCable", cable, source, target }])));
}

// Each arrived modulator on each owned cell, in each of the six facings: a
// placement (which faces NE) and then that many clockwise turns. A
// facing-free modulator has the placement alone.
function modulatorCandidates(state: GameState): Candidate[] {
  return facedCandidates(state, grantsOf(state).arrived.filter(isModulator));
}

// Each arrived Arm likewise (issue #55). An Arm goes down only where it
// raises ν/s, so a Guard Plate lands where it shields the most ν and a
// Blade is left in the tray unless the fight layout feeds it.
function armCandidates(state: GameState): Candidate[] {
  return facedCandidates(state, grantsOf(state).arrived.filter(isArm));
}

function facedCandidates(state: GameState, modules: ModuleType[]): Candidate[] {
  const { game } = state;
  return modules.flatMap((module) =>
    game.board.open.flatMap((cell) => {
      const place: Action = { type: "placeModule", module, cell };
      if (!hasFacing(module)) return [[place]];
      return [0, 1, 2, 3, 4, 5].map((turns): Candidate => [
        place,
        ...Array.from({ length: turns }, (): Action => ({ type: "rotateModule", cell, turn: "clockwise" })),
      ]);
    }));
}

// ── The Goal-following player (spec chunk 05, issue #55) ─────────────────

// The walls the Goal asks to bring down, while it names one, most useful
// first: `Reach Flint` is done by conquering any wall bordering the marked
// Flint, and of the two Basalts the one beside it also serves that next
// Goal. Null when the Goal names no wall.
export function goalWalls(state: GameState): Cell[] | null {
  const standing = (cells: readonly Cell[]) => cells.filter((cell) => cellKind(state.game.board, cell) === "wall");
  switch (goalOf(state)) {
    case "Conquer Shale":
      return standing([SHALE_CELL]);
    case "Conquer Basalt":
      return standing([...BASALT_CELLS].sort((a, b) => Number(distance(b, FLINT_CELL) === 1) - Number(distance(a, FLINT_CELL) === 1)));
    case "Reach Flint":
      return standing(neighbours(FLINT_CELL));
    case "Conquer Flint":
      return standing([FLINT_CELL]);
    case "Conquer Schist":
      return standing([SCHIST_CELL]);
    default:
      return null;
  }
}

// Seconds of flow until the soonest of these walls falls under the
// state's rates: HP ÷ net, Infinity while none is losing HP.
export function secondsToFall(state: GameState, targets: readonly Cell[]): number {
  return soonestFall(state, targets).seconds;
}

// The soonest fall and which target it is (its index, so the earlier,
// more useful target wins a tie); index targets.length when none falls.
function soonestFall(state: GameState, targets: readonly Cell[]): { seconds: number; rank: number } {
  let best = { seconds: Infinity, rank: targets.length };
  for (const rate of state.game.rates.walls) {
    const rank = targets.findIndex((t) => sameCell(t, rate.cell));
    if (rank === -1 || !gt(rate.net, 0)) continue;
    const entry = state.game.board.walls.find((w) => sameCell(w.cell, rate.cell));
    const hp = entry ? entry.hp : wallAt(rate.cell)!.hp;
    const seconds = hp.toNumber() / rate.net.toNumber();
    if (seconds < best.seconds || (seconds === best.seconds && rank < best.rank)) best = { seconds, rank };
  }
  return best;
}

// A layout under construction: a trial state and the actions that built
// it, every one taken by `apply`. It is itself a PaceTurn (that never
// advances), so the greedy placement can build on it.
class Plan implements PaceTurn {
  readonly actions: Action[] = [];
  constructor(public state: GameState, readonly now: number) {}
  apply(action: Action): ApplyResult {
    const result = apply(this.state, action);
    if (result.ok) {
      this.state = result.state;
      this.actions.push(action);
    }
    return result;
  }
  advance(): AdvanceResult {
    throw new Error("pace runner: a plan does not advance");
  }
  // Tries a run of actions; keeps them only if all are taken.
  tryAll(actions: readonly Action[]): GameState | null {
    let trial = this.state;
    for (const action of actions) {
      const result = apply(trial, action);
      if (!result.ok) return null;
      trial = result.state;
    }
    return trial;
  }
  applyAll(actions: readonly Action[]): void {
    for (const action of actions) must(this.apply(action), `the pace runner's planned ${action.type}`);
  }
}

// An empty board: every module lifted, which unplugs every cable.
function clearedPlan(state: GameState, now: number): Plan {
  const plan = new Plan(state, now);
  for (const placement of state.game.board.placements) must(plan.apply({ type: "removeModule", cell: placement.cell }), "lifting a module");
  return plan;
}

const turns = (cell: Cell, facing: number): Action[] =>
  Array.from({ length: facing }, (): Action => ({ type: "rotateModule", cell, turn: "clockwise" }));

function emptyOwnedCells(state: GameState): Cell[] {
  return state.game.board.open.filter((cell) => !moduleAt(state.game.board, cell));
}

// The layout that brings the Goal's wall down soonest, ties by ν/s:
// Blades on cells bordering the wall, facing it; then, one at a time, the
// modulator placement or Patch that most shortens the fall (into a Blade
// for 10× damage, or into a wall that takes a Patch); then the Blades no
// modulator feeds are lifted, and the rest of the allowance goes down by
// ν/s, as before.
function fightLayout(state: GameState, now: number, targets: readonly Cell[]): Plan {
  const plan = clearedPlan(state, now);
  const grants = grantsOf(plan.state);
  if (grants.arrived.includes("blade")) {
    const room = Math.min(grants.allowance.arm, grants.allowance.modulator);
    let placed = 0;
    for (const cell of emptyOwnedCells(plan.state)) {
      if (placed >= room) break;
      const facing = DIRECTIONS.findIndex((d) => targets.some((t) => sameCell(t, addCell(cell, d))));
      if (facing === -1) continue;
      plan.applyAll([{ type: "placeModule", module: "blade", cell }, ...turns(cell, facing)]);
      placed++;
    }
  }
  // Soonest fall; while none falls, the most damage on the Goal's walls,
  // so feeders that only together outpace the regen still go down; then
  // ν/s, then the more useful target.
  const score = (s: GameState) => {
    const fall = soonestFall(s, targets);
    const damage = s.game.rates.walls.filter((w) => targets.some((t) => sameCell(t, w.cell))).reduce((sum, w) => sum + w.damage.toNumber(), 0);
    return { time: fall.seconds, damage, rate: s.game.rates.total, rank: fall.rank };
  };
  type Scored = ReturnType<typeof score>;
  const better = (a: Scored, b: Scored) => {
    if (a.time !== b.time) return a.time < b.time;
    if (!Number.isFinite(a.time) && a.damage !== b.damage) return a.damage > b.damage;
    if (gt(a.rate, b.rate) || gt(b.rate, a.rate)) return gt(a.rate, b.rate);
    return a.rank < b.rank;
  };
  for (;;) {
    const current = score(plan.state);
    let best: ({ actions: Action[] } & Scored) | null = null;
    for (const actions of feederCandidates(plan.state)) {
      const trial = plan.tryAll(actions);
      if (!trial) continue;
      const scored = score(trial);
      if (best === null || better(scored, best)) best = { actions, ...scored };
    }
    const gains = best !== null && (best.time < current.time || (!Number.isFinite(best.time) && best.damage > current.damage));
    if (!gains) break;
    plan.applyAll(best!.actions);
  }
  for (const arm of plan.state.game.rates.arms) {
    if (arm.module === "blade" && !gt(arm.chargeReceived, 0)) must(plan.apply({ type: "removeModule", cell: arm.cell }), "lifting an unfed Blade");
  }
  const fought = secondsToFall(plan.state, targets);
  placeAllowanceGreedily(plan, (s) => !(secondsToFall(s, targets) > fought));
  return plan;
}

// Each arrived modulator on each empty owned cell, in each facing or
// patched to each cell a Patch reaches; and a Patch from each placed,
// unpatched modulator. `apply` refuses what the rules don't allow.
function feederCandidates(state: GameState): Candidate[] {
  const board = state.game.board;
  const grants = grantsOf(state);
  const targetsFrom = (source: Cell) => lifetimeCells().filter((t) => distance(source, t) <= 3 && !sameCell(t, source));
  const patches = (source: Cell): Candidate[] =>
    grants.arrivedCables.flatMap((cable) => targetsFrom(source).map((target): Candidate => [{ type: "patchCable", cable, source, target }]));
  const out: Candidate[] = [];
  for (const module of grants.arrived.filter(isModulator)) {
    for (const cell of emptyOwnedCells(state)) {
      const place: Action = { type: "placeModule", module, cell };
      const facings = hasFacing(module) ? [0, 1, 2, 3, 4, 5] : [0];
      for (const facing of facings) out.push([place, ...turns(cell, facing)]);
      for (const patch of patches(cell)) out.push([place, ...patch]);
    }
  }
  for (const placement of board.placements) {
    if (isModulator(placement.module) && !cableFrom(board, placement.cell)) out.push(...patches(placement.cell));
  }
  return out;
}

// The layout that makes the most ν/s: the greedy placement from an empty
// board.
function rateLayout(state: GameState, now: number): Plan {
  const plan = clearedPlan(state, now);
  placeAllowanceGreedily(plan);
  return plan;
}

// The tending step (issue #55). While the Goal names a wall, the player
// lays out the board to bring it down soonest, breaking ties by ν/s; when
// no layout can (every one leaves it regenerating as fast as it's hit),
// or the Goal names no wall, it lays out for ν/s. It rebuilds only when
// that beats the board it has, so a layout is never churned for nothing.
// What a layout choice depends on: the Goal, the owned cells, the grants,
// and the Producer hour (a Flywheel's output grows 0.1 per hour). The
// player replans only when one changes, since replanning is costly.
function layoutKey(state: GameState): string {
  const open = state.game.board.open.map(cellKey).join(" ");
  const producerHour = Math.floor(state.records.classCredit.producer / 3600);
  return JSON.stringify([goalOf(state), open, grantsOf(state), producerHour]);
}

const plannedFor = new WeakMap<PaceTurn, string>();

export function followGoal(turn: PaceTurn): void {
  const state = turn.state;
  const key = layoutKey(state);
  if (plannedFor.get(turn) === key) return;
  plannedFor.set(turn, key);
  const targets = goalWalls(state);
  let plan: Plan | null = null;
  if (targets && targets.length > 0) {
    const fight = fightLayout(state, turn.now, targets);
    const time = secondsToFall(fight.state, targets);
    const held = secondsToFall(state, targets);
    if (time < held || (time === held && Number.isFinite(time) && gt(fight.state.game.rates.total, state.game.rates.total))) plan = fight;
    if (Number.isFinite(held) && !plan) return;
  }
  if (!plan) {
    const nu = rateLayout(state, turn.now);
    // Fill any allowance onto the board as it stands, the cheaper move.
    const kept = new Plan(state, turn.now);
    placeAllowanceGreedily(kept);
    plan = gt(nu.state.game.rates.total, kept.state.game.rates.total) ? nu : kept;
  }
  for (const action of plan.actions) must(turn.apply(action), `the pace runner's ${action.type}`);
}

// ── The run ───────────────────────────────────────────────────────────────

export interface PaceScript {
  // Run until the player has at least this many credited hours.
  creditedHours: number;
  sessionMinutes?: number;
  // Wall-clock gap between sessions, for the actions' `now`.
  restMinutes?: number;
  // The upgrade-mode visit after each session.
  tendMinutes?: number;
  milestones?: MilestoneProbe[];
  tending?: Partial<TendingHooks>;
  // The state the player starts from; a fresh start when absent. Tests use
  // it to start from given class credit, say.
  start?: GameState;
}

export interface MilestoneRow {
  id: string;
  label: string;
  target: string;
  // Credited hours when first seen; null when not reached.
  reachedAtHours: number | null;
  // False while the engine has no such fact to read.
  tracked: boolean;
}

export interface DryStretch {
  fromHours: number;
  toHours: number;
}

export interface PaceReport {
  creditedHours: number;
  sessions: number;
  milestones: MilestoneRow[];
  // The board at the end of the run: its layout and total ν/s.
  placements: Placement[];
  cables: Cable[];
  rate: Num;
  // The modulators' summed output in charge/s, and each wall a Patch
  // damages, by its authored name.
  charge: Num;
  walls: { name: string; cell: Cell; damage: Num }[];
  // The era's nous at the end of the run.
  nous: Num;
  // Each open class's level at the end of the run, in class order.
  classLevels: { habitClass: HabitClass; level: number }[];
  breathersTaken: number;
  // Every stretch longer than DRY_STRETCH_HOURS with no new milestone,
  // including the one from the last milestone to the end of the run.
  dryStretches: DryStretch[];
}

export const DRY_STRETCH_HOURS = 2;
const FLOW_STEP_SECONDS = 60;
const START_EPOCH_MS = Date.UTC(2026, 0, 5, 9, 0, 0);
const MAX_SESSIONS = 100_000;

export function creditedHoursOf(state: GameState): number {
  return state.records.habits.reduce((sum, h) => sum + h.seconds, 0) / 3600;
}

function must(result: ApplyResult, what: string): ApplyResult {
  if (!result.ok) throw new Error(`pace runner: ${what} was refused: ${result.reason}`);
  return result;
}

// One habit per open class, so every open class earns credit.
function habitsForOpenClasses(turn: PaceTurn): void {
  for (const habitClass of turn.state.game.openClasses) {
    if (turn.state.records.habits.some((h) => h.habitClass === habitClass && !h.archived)) continue;
    must(turn.apply({ type: "createHabit", name: `${title(habitClass)} practice`, habitClass }), `a ${habitClass} habit`);
  }
}

// Round-robin over the attuned habits.
function nextHabitId(state: GameState, sessionIndex: number): string {
  const habits = state.records.habits.filter((h) => !h.archived && h.habitClass !== null);
  return habits[sessionIndex % habits.length]!.id;
}

export function runPace(script: PaceScript): PaceReport {
  const sessionSeconds = (script.sessionMinutes ?? 50) * 60;
  const restMs = (script.restMinutes ?? 10) * 60_000;
  const tendSeconds = (script.tendMinutes ?? 10) * 60;
  const probes = script.milestones ?? PROGRESSION_MILESTONES;
  const tending: TendingHooks = { ...DEFAULT_TENDING, ...script.tending };

  let state = script.start ?? createInitialState();
  let now = START_EPOCH_MS;
  let breathersTaken = 0;
  const turn: PaceTurn = {
    get state() {
      return state;
    },
    get now() {
      return now;
    },
    apply: (action) => {
      const result = apply(state, action);
      state = result.state;
      if (result.ok && action.type === "takeBreather") breathersTaken++;
      return result;
    },
    advance: (seconds, mode) => {
      const result = advance(state, seconds, mode);
      state = result.state;
      now += seconds * 1000;
      return result;
    },
  };
  const reachedAt = new Map<string, number>();
  const observe = () => {
    const hours = creditedHoursOf(state);
    for (const probe of probes) {
      if (!reachedAt.has(probe.id) && probe.reached?.(state)) reachedAt.set(probe.id, hours);
    }
  };

  let sessions = 0;
  observe();
  // A fresh start is upgrade mode: the player lays out the allowance
  // before the first session, so that session already makes nous.
  tending.placeAllowance(turn);
  observe();
  while (creditedHoursOf(state) < script.creditedHours) {
    if (sessions >= MAX_SESSIONS) throw new Error("pace runner: no credited progress");
    habitsForOpenClasses(turn);
    must(turn.apply({ type: "startSession", habitId: nextHabitId(state, sessions), target: sessionSeconds, now }), "starting a session");
    // Flow runs a minute at a time, and the milestones are read after
    // each, so a conquest mid-session is reported within the minute.
    for (let flowed = 0; flowed < sessionSeconds; flowed += FLOW_STEP_SECONDS) {
      const step = turn.advance(Math.min(FLOW_STEP_SECONDS, sessionSeconds - flowed), "flow");
      if (step.fault) throw new Error(`pace runner: flow faulted on ${step.fault}`);
      observe();
    }
    must(turn.apply({ type: "endSession", now }), "ending the session");
    must(turn.apply({ type: "dismissSummary" }), "dismissing the summary");
    sessions++;
    observe();

    tending.placeAllowance(turn);
    tending.patchChargeToNearestWall(turn);
    tending.buyCheapestFader(turn);
    turn.advance(tendSeconds, "upgrade");
    tending.takeBankedBreathers(turn);
    observe();
    now += restMs;
  }

  const creditedHours = creditedHoursOf(state);
  return {
    creditedHours,
    sessions,
    milestones: probes.map((p) => ({
      id: p.id,
      label: p.label,
      target: p.target,
      reachedAtHours: reachedAt.get(p.id) ?? null,
      tracked: p.reached !== undefined,
    })),
    placements: state.game.board.placements.map((p) => ({
      cell: { q: p.cell.q, r: p.cell.r },
      module: p.module,
      ...(p.facing === undefined ? {} : { facing: p.facing }),
    })),
    cables: state.game.board.cables.map((c) => ({ type: c.type, source: { ...c.source }, target: { ...c.target } })),
    rate: state.game.rates.total,
    charge: state.game.rates.modulators.reduce((sum, m) => add(sum, m.output), D(0)),
    walls: state.game.rates.walls.map((w) => ({ name: wallAt(w.cell)!.name, cell: { ...w.cell }, damage: w.damage })),
    nous: state.game.nous,
    classLevels: CLASSES.filter((c) => state.game.openClasses.includes(c)).map((habitClass) => ({ habitClass, level: classLevel(state, habitClass).level })),
    breathersTaken,
    dryStretches: dryStretches([...reachedAt.values()], creditedHours),
  };
}

function dryStretches(reached: number[], endHours: number): DryStretch[] {
  const points = [0, ...reached.sort((a, b) => a - b), endHours];
  const out: DryStretch[] = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i]! - points[i - 1]! > DRY_STRETCH_HOURS) out.push({ fromHours: points[i - 1]!, toHours: points[i]! });
  }
  return out;
}

// ── Printing ──────────────────────────────────────────────────────────────

const hours = (h: number) => `${h.toFixed(1)}h`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function formatPaceReport(report: PaceReport): string {
  const rows = report.milestones.map((m) => [
    m.label,
    m.reachedAtHours === null ? (m.tracked ? "not reached" : "not reached*") : hours(m.reachedAtHours),
    m.target,
  ]);
  const head = ["Milestone", "Reached", "Target"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  const layout = [
    ...report.placements.map((p) =>
      `${moduleName(p.module)} (${cellKey(p.cell)})${p.facing === undefined ? "" : ` facing ${FACING_NAMES[p.facing]}`}`),
    ...report.cables.map((c) => `${cableName(c.type)} (${cellKey(c.source)}) → (${cellKey(c.target)})`),
  ].join(", ");
  const oscillators = report.placements.filter((p) => isOscillator(p.module)).length;
  const modulators = report.placements.length - oscillators;
  const rates = [
    plural(oscillators, "oscillator"),
    plural(modulators, "modulator"),
    `${fmtRate(report.rate)} ν/s`,
    `${fmtRate(report.charge)} charge/s`,
    ...report.walls.map((w) => `${w.name} ${fmtRate(w.damage)} damage/s`),
  ].join(", ");
  const out = [
    `Pace run: ${report.sessions} sessions, ${hours(report.creditedHours)} credited`,
    `Board: ${rates}${layout ? ` — ${layout}` : ""}`,
    `Era ν: ${fmt(report.nous)}`,
    `Classes: ${report.classLevels.map((c) => `${title(c.habitClass)} Lv ${c.level}`).join(", ")}`,
    `Breathers taken: ${report.breathersTaken}`,
    "",
    line(head),
    line(widths.map((w) => "-".repeat(w))),
    ...rows.map(line),
  ];
  if (report.milestones.some((m) => !m.tracked)) out.push("", "* the engine has no such fact yet");
  out.push("");
  if (report.dryStretches.length === 0) out.push(`No stretch over ${DRY_STRETCH_HOURS}h without a new milestone.`);
  for (const d of report.dryStretches) {
    out.push(`DRY ${hours(d.fromHours)}–${hours(d.toHours)}: ${hours(d.toHours - d.fromHours)} with no new milestone`);
  }
  return out.join("\n");
}
