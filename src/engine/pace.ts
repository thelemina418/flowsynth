import { advance } from "./advance";
import { apply, type Action, type ApplyResult } from "./apply";
import { createInitialState } from "./state";
import { cellKey } from "./hex";
import { isOscillator, moduleName } from "./modules";
import { fmt, fmtRate, gt, type Num } from "./num";
import type { AdvanceMode, AdvanceResult, GameState, HabitClass, Placement } from "./types";

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
  { kind: "Shale", target: "Sketch, 0–15h (ring 1)" },
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
  roadie: "first contact with Flint (Sketch, 0–15h)",
  mixer: "conquering the marked Schist (Demo, 15–60h)",
};

const title = (word: string) => word[0]!.toUpperCase() + word.slice(1);

export const PROGRESSION_MILESTONES: MilestoneProbe[] = [
  ...CLASSES.map((c) => ({ id: `class-open:${c}`, label: `${title(c)} opens`, target: CLASS_OPENS[c], reached: classOpen(c) })),
  ...WALLS.map((w) => ({ id: `wall:${w.kind.toLowerCase()}`, label: `First ${w.kind} conquered`, target: w.target })),
  ...CLASSES.map((c) => ({ id: `class-level-5:${c}`, label: `${title(c)} level 5`, target: "8h on the class" })),
  { id: "first-prestige", label: "First prestige (Sketch gate)", target: "8–10h, Demo by 15h" },
  { id: "gate:obsidian", label: "Obsidian conquered (Demo gate)", target: "60h" },
  { id: "gate:corundum", label: "Corundum conquered (Record gate)", target: "140h" },
  { id: "gate:master", label: "Master finished (Encore opens)", target: "250h" },
];

// ── The scripted player's seams ───────────────────────────────────────────

// What a tending hook may touch: the current state to read, and the
// engine's two doors to change it. Each door moves the turn to the state it
// returns.
export interface PaceTurn {
  readonly state: GameState;
  apply(action: Action): ApplyResult;
  advance(seconds: number, mode: AdvanceMode): AdvanceResult;
}

// Between sessions the player takes each banked breather, then tends in
// upgrade mode. Each hook is a named seam a later chunk fills; all are
// empty until the engine has the thing they act on.
export interface TendingHooks {
  takeBankedBreathers(turn: PaceTurn): void;
  buyCheapestFader(turn: PaceTurn): void;
  placeAllowance(turn: PaceTurn): void;
  patchChargeToNearestWall(turn: PaceTurn): void;
}

export const DEFAULT_TENDING: TendingHooks = {
  takeBankedBreathers: () => {},
  buyCheapestFader: () => {},
  placeAllowance: placeAllowanceGreedily,
  patchChargeToNearestWall: () => {},
};

// Fill the allowance one oscillator at a time, each where it most raises
// the board's total ν/s (spec chunk 02, issue #28). Every candidate is tried
// through `apply` on the current state, which is pure, so a trial changes
// nothing; only the best is applied through the turn. Ties keep the first
// candidate in arrived-type then owned-cell order, so the run is
// deterministic. Placed oscillators are never moved: a later chunk may
// teach the player to rearrange. Modulators wait for issue #35, which
// teaches the runner to place and aim them.
export function placeAllowanceGreedily(turn: PaceTurn): void {
  for (;;) {
    const { game } = turn.state;
    let best: { action: Action; total: Num } | null = null;
    for (const module of game.arrived.filter(isOscillator)) {
      for (const cell of game.board.open) {
        const action: Action = { type: "placeModule", module, cell };
        const trial = apply(turn.state, action);
        if (!trial.ok) continue;
        const total = trial.state.game.rates.total;
        if (best === null || gt(total, best.total)) best = { action, total };
      }
    }
    if (best === null) return;
    must(turn.apply(best.action), "placing an oscillator");
  }
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
  // it to grant what later chunks will (a larger allowance, say).
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
  rate: Num;
  // The era's nous at the end of the run.
  nous: Num;
  // Every stretch longer than DRY_STRETCH_HOURS with no new milestone,
  // including the one from the last milestone to the end of the run.
  dryStretches: DryStretch[];
}

export const DRY_STRETCH_HOURS = 2;
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
  const turn: PaceTurn = {
    get state() {
      return state;
    },
    apply: (action) => {
      const result = apply(state, action);
      state = result.state;
      return result;
    },
    advance: (seconds, mode) => {
      const result = advance(state, seconds, mode);
      state = result.state;
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

  let now = START_EPOCH_MS;
  let sessions = 0;
  observe();
  // A fresh start is upgrade mode: the player lays out the allowance
  // before the first session, so that session already makes nous.
  tending.placeAllowance(turn);
  observe();
  while (creditedHoursOf(state) < script.creditedHours) {
    if (sessions >= MAX_SESSIONS) throw new Error("pace runner: no credited progress");
    habitsForOpenClasses(turn);
    must(turn.apply({ type: "selectHabit", id: nextHabitId(state, sessions) }), "selecting the habit");
    must(turn.apply({ type: "startSession", target: sessionSeconds, now }), "starting a session");
    const flowed = turn.advance(sessionSeconds, "flow");
    if (flowed.fault) throw new Error(`pace runner: flow faulted on ${flowed.fault}`);
    now += sessionSeconds * 1000;
    must(turn.apply({ type: "endSession", now }), "ending the session");
    must(turn.apply({ type: "dismissSummary" }), "dismissing the summary");
    sessions++;
    observe();

    tending.takeBankedBreathers(turn);
    tending.buyCheapestFader(turn);
    tending.placeAllowance(turn);
    tending.patchChargeToNearestWall(turn);
    turn.advance(tendSeconds, "upgrade");
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
    placements: state.game.board.placements.map((p) => ({ cell: { q: p.cell.q, r: p.cell.r }, module: p.module })),
    rate: state.game.rates.total,
    nous: state.game.nous,
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

export function formatPaceReport(report: PaceReport): string {
  const rows = report.milestones.map((m) => [
    m.label,
    m.reachedAtHours === null ? (m.tracked ? "not reached" : "not reached*") : hours(m.reachedAtHours),
    m.target,
  ]);
  const head = ["Milestone", "Reached", "Target"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  const layout = report.placements.map((p) => `${moduleName(p.module)} (${cellKey(p.cell)})`).join(", ");
  const out = [
    `Pace run: ${report.sessions} sessions, ${hours(report.creditedHours)} credited`,
    `Board: ${report.placements.length} oscillators, ${fmtRate(report.rate)} ν/s${layout ? ` — ${layout}` : ""}`,
    `Era ν: ${fmt(report.nous)}`,
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
