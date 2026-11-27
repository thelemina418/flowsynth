import type { Num } from "./num";
import type { Hex } from "./hex";

// The single serialisable GameState (spec chunk 01, issue #17). It has two
// parts: the real-life records, which nothing in the game ever resets, and
// the game state, which later chunks grow (board, walls, console,
// prestige). `apply` is the only way it changes and `advance` the only way
// time passes (engine/apply.ts, engine/advance.ts).

// The per-reconciliation honesty outcome (focus-tool spec §2).
export type HonestyOutcome = "missed" | "planned" | "full";

// One settled reconciliation's factual line (spec §9).
export interface HonestyEvent {
  awaySeconds: number;
  outcome: HonestyOutcome;
}

// Trust accounting for the running session (focus-tool spec §1–3,
// ADR-0019). Presence is always trusted; away time is trusted up to a
// planned target, and provisional past it (all provisional on open-ended,
// beyond the floor). The pool holds provisional minutes until the honesty
// report settles them. creditedSeconds is the seam every focus-side
// consumer keys off.
export interface SessionAccounting {
  creditedSeconds: number;
  poolSeconds: number;
  // Away time accumulated by the current contiguous absence, classified in
  // one pass when presence returns.
  pendingAwaySeconds: number;
  events: HonestyEvent[];
  // The provisional nous (story 27): what the board made during provisional
  // time, held aside until the honesty report settles it. Didn't-practice
  // drops it; either other answer banks it into nous.
  provisionalNous: Num;
}

export interface SessionState {
  target: number | null;
  elapsed: number;
  accounting: SessionAccounting;
  // Set at the first wake-up past the target (spec §4); persisted so a
  // reload never re-delivers the signals.
  targetSignaled: boolean;
  // Wall-clock epoch ms from the start gesture (§9).
  startedAt: number;
  // goalId → credited seconds accrued while the session ran (§9).
  goalSeconds: Record<string, number>;
}

// The summary's reflection (spec §8).
export interface SessionReflection {
  text: string;
  slider: number;
}

// The session's closing summary (§5.7), interim: practice facts only.
export interface SessionSummary {
  sessionNumber: number;
  seconds: number;
  plannedTarget: number | null;
  honestyEvents: HonestyEvent[];
  reflection: SessionReflection | null;
  seen: boolean;
}

export type SessionMode = "planned" | "open-ended";

// The goals-advanced snapshot (§9), captured at close. Saved fields keep
// their pre-Intention names (goalId, goal, goalsAdvanced, the session's
// goalSeconds): a v15 save writes them, and v16 reads them as written.
export interface IntentionAdvanceSnapshot {
  goal?: Intention;
  goalId: string;
  seconds: number;
}

// The session record (§9): written once at close, append-only, never pruned.
export interface SessionRecord {
  sessionNumber: number;
  startedAt: number;
  endedAt: number;
  habitId: string | null;
  mode: SessionMode;
  plannedTarget: number | null;
  creditedSeconds: number;
  honestyEvents: HonestyEvent[];
  reflection: SessionReflection | null;
  goalsAdvanced: IntentionAdvanceSnapshot[];
}

export interface NoteEntry {
  id: string;
  sessionId: number;
  atElapsed: number;
  text: string;
  // The habit-keyed tag (§9): the session's selected habit at capture.
  habitId: string | null;
  at: number;
}

export type HabitColor = "vermillion" | "amber" | "green" | "cyan" | "indigo" | "violet";

// The four habit classes (GLOSSARY). Each grants allowance of its craft.
export type HabitClass = "engineer" | "producer" | "mixer" | "roadie";

export interface Habit {
  id: string;
  name: string;
  seconds: number;
  archived: boolean;
  color: HabitColor;
  // The attuned class, or null while the habit awaits its class (a
  // migrated habit, or one created before its class was chosen).
  habitClass: HabitClass | null;
}

export interface PracticeEntry {
  id: string;
  habitId: string;
  seconds: number;
  source: "live" | "manual";
  at: number;
}

export interface IntentionCondition {
  kind: "habit-minutes";
  habitId: string | null;
  minutes: number;
}

export type IntentionSchedule = { kind: "once" } | { kind: "daily" } | { kind: "weekly" };

export interface Intention {
  // Retired intentions retain their facts for session history but never run.
  retired?: true;
  // A carried-over row awaiting the player's retain-one choice (issue #445).
  pendingChoice?: true;
  id: string;
  condition: IntentionCondition;
  schedule: IntentionSchedule;
  occurrenceKey: string;
  progressSeconds: number;
  completed: boolean;
  completedCount: number;
  createdAt: number;
}

export type Mode = "upgrade" | "flow" | "paused";

// The way `advance` passes time. 'upgrade' freezes everything; 'breather'
// is reserved for chunk 04.
export type AdvanceMode = "flow" | "breather" | "upgrade";

// The console's fixed-function instruments (ADR-0012).
export type FocusApp = "habit" | "time" | "notes";

// The real-life records: nothing in the game ever resets them.
export interface Records {
  habits: Habit[];
  // The habit a session credits, locked for the session (ADR-0001).
  activeHabitId: string | null;
  practiceLog: PracticeEntry[];
  sessionRecords: SessionRecord[];
  notes: NoteEntry[];
  // The player's Intentions (the old goals) and their schedules.
  intentions: Intention[];
  // Class credit: credited flow seconds per class. Live credited time only;
  // manual log entries never add to it. Levels are chunk 04's.
  classCredit: Record<HabitClass, number>;
  // Session accounting: the session counter and the completed count.
  sessionIndex: number;
  sessionsCompleted: number;
  nextId: number;
}

// The macro stages (GLOSSARY: Arc). Each sets the board's reach.
export type Arc = "sketch" | "demo" | "record" | "master" | "encore";

// The module categories (GLOSSARY: Category). Only Oscillators exist in
// chunk 02; Modulators arrive in chunk 03, Effects and Arms later.
export type ModuleCategory = "oscillator";

// The oscillator types (mechanics-sketch.md). Square, Saw and Release are
// declared now; chunk 04 makes them arrive.
export type OscillatorType = "sine" | "triangle" | "square" | "saw" | "release";

// Every module type. Chunk 03 widens it with the modulator types.
export type ModuleType = OscillatorType;

// One module on one owned open cell (issue #25).
export interface Placement {
  cell: Hex;
  module: ModuleType;
}

// The board (spec chunk 02): the owned open cells, the current arc and the
// placements. Cell kinds are derived (engine/board.ts). An open cell holds
// at most one module; an unplaced module is simply absent.
export interface Board {
  open: Hex[];
  arc: Arc;
  placements: Placement[];
}

// One satisfied instance of an oscillator's pattern (issue #26): a distinct
// set of partner cells, each with the module it holds.
export interface ResonanceInstance {
  partners: Placement[];
}

// One placed oscillator's rate (mechanics-sketch.md, Rates):
// rate = base × resonance × charge × faders × (1 − pressure). Charge,
// faders and pressure are identity legs until chunks 03, 05 and 06 fill
// them in.
export interface OscillatorRate {
  cell: Hex;
  module: OscillatorType;
  base: Num;
  // The pattern's R (0 for a type with no pattern).
  strength: Num;
  instances: ResonanceInstance[];
  resonance: Num;
  charge: Num;
  faders: Num;
  pressure: Num;
  rate: Num;
}

// The board's rates (issue #26): one pure computation of the layout,
// cached on the game state, recomputed after a layout change and on load,
// never persisted and never computed per tick. Oscillators are in
// placement order.
export interface BoardRates {
  oscillators: OscillatorRate[];
  total: Num;
}

// The game state.
export interface Game {
  nous: Num;
  mode: Mode;
  session: SessionState | null;
  summary: SessionSummary | null;
  // The classes a habit may attune to. Engineer and Producer open at the
  // start; later chunks open the others.
  openClasses: HabitClass[];
  // The Almanac's legacy line (`Legacy era · <n> modules · archived`),
  // written once by the v15 migration; null on a fresh start.
  legacyLine: string | null;
  board: Board;
  // How many modules of each category may be placed at once (GLOSSARY:
  // Allowance). Plain facts here; chunk 04's class levels grant them.
  allowance: Record<ModuleCategory, number>;
  // The module types the player has, in arrival order. Sine and Triangle
  // at the start; chunk 04 adds the rest.
  arrived: ModuleType[];
  // Derived from the board, never saved (engine/rates.ts).
  rates: BoardRates;
}

export interface GameState {
  records: Records;
  game: Game;
}

export interface AdvanceResult {
  intentionsCompleted: number;
  // The numeric-fault refusal (issue #486): set when the update was
  // refused whole; names the figure that refused.
  fault?: string | undefined;
}
