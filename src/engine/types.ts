// The interim game state (spec chunk 01, issue #15): only what the kept
// modules read — trust and session accounting, the honesty report, habits,
// Notes, the practice log, the goal and occurrence calendar, and the
// session history. Every economy and board field retired with its system.
// Issue #17 replaces this shape with the rebuild's single GameState.

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

export interface Habit {
  id: string;
  name: string;
  seconds: number;
  archived: boolean;
  color: HabitColor;
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

// The console's fixed-function instruments (ADR-0012).
export type FocusApp = "habit" | "time" | "notes";

export interface GameState {
  mode: Mode;
  sessionIndex: number;
  sessionsCompleted: number;
  muted: boolean;
  notificationAsked: boolean;
  notes: NoteEntry[];
  habits: Habit[];
  activeHabitId: string | null;
  practiceLog: PracticeEntry[];
  sessionRecords: SessionRecord[];
  goals: Goal[];
  session: SessionState | null;
  summary: SessionSummary | null;
  nextId: number;
}

export interface AdvanceResult {
  goalsCompleted: number;
  // The numeric-fault refusal (issue #486): set when the update was
  // restored whole; names the figure that refused.
  fault?: string | undefined;
}
