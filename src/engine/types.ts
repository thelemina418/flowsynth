import type { Num } from "./num";

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

// The goals-advanced snapshot (§9), captured at close.
export interface GoalAdvanceSnapshot {
  goal?: Goal;
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
  goalsAdvanced: GoalAdvanceSnapshot[];
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

export interface GoalCondition {
  kind: "habit-minutes";
  habitId: string | null;
  minutes: number;
}

export type GoalSchedule = { kind: "once" } | { kind: "daily" } | { kind: "weekly" };

export interface Goal {
  // Retired goals retain their facts for session history but never run.
  retired?: true;
  // A carried-over row awaiting the player's retain-one choice (issue #445).
  pendingChoice?: true;
  id: string;
  condition: GoalCondition;
  schedule: GoalSchedule;
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
  intentions: Goal[];
  // Class credit: credited flow seconds per class. Live credited time only;
  // manual log entries never add to it. Levels are chunk 04's.
  classCredit: Record<HabitClass, number>;
  // Session accounting: the session counter and the completed count.
  sessionIndex: number;
  sessionsCompleted: number;
  nextId: number;
}

// The game state: minimal in chunk 01.
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
}

export interface GameState {
  records: Records;
  game: Game;
}

export interface AdvanceResult {
  goalsCompleted: number;
  // The numeric-fault refusal (issue #486): set when the update was
  // refused whole; names the figure that refused.
  fault?: string | undefined;
}
