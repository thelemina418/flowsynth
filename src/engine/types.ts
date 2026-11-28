import type { Num } from "./num";
import type { Cell, Facing } from "./hex";

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
  // The ν the session made (issue #40): banked from trusted flow time,
  // plus provisional ν once a non-missed honesty answer settles it.
  nousMade: Num;
  // The walls the session fought (issue #50): each wall's net HP lost
  // since it was first fought, and whether it fell. The conquered ones are
  // in conquest order.
  walls: WallTally[];
}

// One wall the session fought (issue #50). `lost` is net: a wall that
// healed after the fight stopped lost less.
export interface WallTally {
  cell: Cell;
  lost: Num;
  conquered: boolean;
}

// The summary's entry: `fought` marks the wall still being fought when
// the session ended, standing.
export interface SummaryWall extends WallTally {
  fought: boolean;
}

// The summary's reflection (spec §8).
export interface SessionReflection {
  text: string;
  slider: number;
}

// The session's closing summary (§5.7; spec chunk 04, issue #40).
export interface SessionSummary {
  sessionNumber: number;
  seconds: number;
  // The session's ν, its habit's class (null while awaiting one), the
  // credited seconds that went to the class, and the class level before
  // and after the session.
  nous: Num;
  habitClass: HabitClass | null;
  classSeconds: number;
  levelBefore: number;
  levelAfter: number;
  // The breather this session banked, in seconds, or null (issue #41).
  breather: number | null;
  plannedTarget: number | null;
  honestyEvents: HonestyEvent[];
  reflection: SessionReflection | null;
  seen: boolean;
  // The walls the session fought (issue #50), from its tally.
  walls: SummaryWall[];
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

export type Mode = "upgrade" | "flow" | "paused" | "breather";

// The way `advance` passes time. 'upgrade' freezes everything; 'breather'
// runs a taken breather to its deadline (issue #41).
export type AdvanceMode = "flow" | "breather" | "upgrade";

// The console's fixed-function instruments (ADR-0012).
export type FocusApp = "habit" | "time" | "notes";

// The breather (spec chunk 04, issue #41; ADR-0095): at most one banked,
// at most one running, and the last completed one's payout until the
// player dismisses it. Lengths and elapsed time are in seconds.
export interface BreatherState {
  banked: { seconds: number } | null;
  running: { seconds: number; elapsed: number; startedAt: number } | null;
  result: { nous: Num } | null;
}

// The Encyclopedia's entries (spec chunk 04, issue #44).
export type EntryId = "resonance" | OscillatorType | "charge" | "cables" | "walls" | "pressure" | "classes" | "breather" | "prestige";

// Revealed and seen entries: unions that only grow (engine/encyclopedia.ts).
export interface EncyclopediaState {
  revealed: EntryId[];
  seen: EntryId[];
}

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

// The module categories (GLOSSARY: Category). Oscillators and Modulators
// exist from chunk 03; Effects and Arms arrive later.
export type ModuleCategory = "oscillator" | "modulator";

// The oscillator types (mechanics-sketch.md). Square, Saw and Release are
// declared now; chunk 04 makes them arrive.
export type OscillatorType = "sine" | "triangle" | "square" | "saw" | "release";

// The modulator types (mechanics-sketch.md, Modulators). The Flywheel
// arrives at the start (spec chunk 03, issue #31); the Pulsewell is
// declared as data (issue #32) and chunk 04 makes it arrive.
export type ModulatorType = "flywheel" | "pulsewell";

// Every module type.
export type ModuleType = OscillatorType | ModulatorType;

// One module on one owned open cell (issue #25). A module whose type has a
// facing (issue #31) carries it: an index into hex.ts's DIRECTIONS; a type
// without one never does.
export interface Placement {
  cell: Cell;
  module: ModuleType;
  facing?: Facing;
}

// The board (spec chunk 02): the owned open cells, the current arc and the
// placements. Cell kinds are derived (engine/board.ts). An open cell holds
// at most one module; an unplaced module is simply absent.
export interface Board {
  open: Cell[];
  arc: Arc;
  placements: Placement[];
  // The placed cables (issue #33), in placement order. A cable occupies no
  // cell.
  cables: Cable[];
  // Every wall below its full HP (issue #49). A wall missing from the list
  // is at full HP; a conquered wall is in `open` and never here.
  walls: WallHp[];
}

// One wall's HP below full (issue #49): above 0 and below its kind's full HP.
export interface WallHp {
  cell: Cell;
  hp: Num;
}

// The cable types (GLOSSARY: Cable). Patch arrives at the start; Mult,
// Inverter and Sync are later chunks'.
export type CableType = "patch";

// One cable (issue #33): from the jack of the modulator on `source` to the
// `target` cell, within length 3 and crossing no other cable. A Patch
// carries the source's whole output to the target in place of its reach.
export interface Cable {
  type: CableType;
  source: Cell;
  target: Cell;
}

// One satisfied instance of an oscillator's pattern (issue #26): a distinct
// set of partner cells, each with the module it holds.
export interface ResonanceInstance {
  partners: Placement[];
}

// One placed oscillator's rate (mechanics-sketch.md, Rates):
// rate = base × resonance × charge × faders × (1 − pressure). Faders are
// an identity leg until chunk 06; pressure is the bordering walls' sum,
// capped at 60% (issue #52).
export interface OscillatorRate {
  cell: Cell;
  module: OscillatorType;
  base: Num;
  // The pattern's R (0 for a type with no pattern).
  strength: Num;
  instances: ResonanceInstance[];
  resonance: Num;
  // charge/s received: the sum of every modulator's delivery to this cell.
  chargeReceived: Num;
  // The charge factor, 1 + ln(1 + chargeReceived) (issue #32).
  charge: Num;
  faders: Num;
  pressure: Num;
  rate: Num;
  // The same product with the breather base (issue #41): Release's 6 in
  // place of its flow base of 0, every other type its flow base.
  breatherRate: Num;
}

// What a reach cell holds when a modulator's charge arrives (issue #32): a
// module, an empty open cell, a wall or a dark cell. In chunk 03 only an
// oscillator takes anything from it.
export type ReachHolds = ModuleType | "empty" | "wall" | "dark";

export interface ChargeDelivery {
  cell: Cell;
  holds: ReachHolds;
}

// One placed modulator's charge (issue #32): its output, charge/s to each
// target, and the cells its reach delivers to, in reach order. `facing` is
// null for a facing-free type.
export interface ModulatorRate {
  cell: Cell;
  module: ModulatorType;
  facing: Facing | null;
  output: Num;
  deliveries: ChargeDelivery[];
}

// One wall a Patch targets (issue #34): the patched charge into it as
// damage at 1:1, its regen from the authored map
// and net = damage − regen. A rate only: nothing applies it until chunk 05.
export interface WallRate {
  cell: Cell;
  damage: Num;
  regen: Num;
  net: Num;
}

// The board's rates (issue #26): one pure computation of the layout and
// the credited Producer time, cached on the game state. Recomputed after
// a layout or facing change, on load and when a flow session ends (issue
// #32); never persisted and never computed per tick. Oscillators and
// modulators are in placement order.
export interface BoardRates {
  oscillators: OscillatorRate[];
  modulators: ModulatorRate[];
  // Walls in the order a Patch first targets them.
  walls: WallRate[];
  total: Num;
  // 2 × the sum of breatherRate: what a breather makes per second.
  breatherTotal: Num;
}

// The game state.
export interface Game {
  nous: Num;
  mode: Mode;
  session: SessionState | null;
  summary: SessionSummary | null;
  breather: BreatherState;
  encyclopedia: EncyclopediaState;
  // The classes a habit may attune to. Engineer and Producer open at the
  // start; later chunks open the others.
  openClasses: HabitClass[];
  // The Almanac's legacy line (`Legacy era · <n> modules · archived`),
  // written once by the v15 migration; null on a fresh start.
  legacyLine: string | null;
  // The allowance and the arrived types are derived from class credit and
  // the open classes (engine/levels.ts, issue #38), never stored.
  board: Board;
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
