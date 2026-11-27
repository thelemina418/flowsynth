import { createInitialState } from "./state";
import { normalizeGoals } from "./goals";
import { normalizeHabitColor } from "./habits";
import { SAVE_VERSION } from "./constants";
import type { GameState, Habit, SessionAccounting, SessionRecord, SessionState, SessionSummary } from "./types";

// The interim save boundary (issue #15). It reads the real-life records —
// habits, Notes, the practice log, Intentions and their calendar, session
// history, a running session's trust ledger — out of a v15 save and writes
// them back in the interim shape. Everything else in a v15 save (the board,
// the economy, the World) is left behind. The stale-tab guard (ADR-0032,
// shared-save.ts) and the explicit recovery (ADR-0082) stand. Dev-only:
// save v16 and the one-time v15 migration replace this (issue #18).

export interface SaveFile {
  app: "flowsynth";
  version: number;
  savedAt: number;
  state: GameState;
}

export interface LoadResult {
  state?: GameState;
  error?: string;
  // Lost money is not a rejected-version fresh start. Persistence must
  // leave the source in place until the explicit recovery choice (#494).
  recoveryRequired?: boolean;
  // The paths the refusal names: the recovery offer presents the same
  // list, so the explanation can never disagree with the detection.
  lost?: string[];
  // Present exactly when this load performed the player's chosen recovery.
  recovered?: RecoveryReport;
}

// What the recovery could not read, stated as paths (ADR-0082). No figure
// is reconstructed: the recovered state carries the records alone.
export interface RecoveryReport {
  fromVersion: number;
  lost: string[];
}

// The serialization refusal (issue #486): JSON.stringify silently writes
// null for a nonfinite number. A save whose figures cannot land on disk
// refuses instead, naming the first figure that refused.
export class SaveRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveRefusedError";
  }
}

function assertSerializable(value: unknown, path: string): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SaveRefusedError(`The save refuses to write "${path}" — its figure is not a finite number.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSerializable(item, `${path}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) assertSerializable(item, `${path}.${key}`);
  }
}

export function serialize(state: GameState, savedAt: number = Date.now()): string {
  const file: SaveFile = { app: "flowsynth", version: SAVE_VERSION, savedAt, state };
  assertSerializable(file, "save");
  return JSON.stringify(file, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// The legacy economy's monetary figures (ADR-0082): a v15 save written by a
// pre-integrity build can carry them as null. A figure that is present but
// unreadable is lost money, and loading refuses until the player chooses the
// recovery. Absent figures are not loss: the interim shape never writes them.
function lostMonetaryFigures(raw: Record<string, unknown>): string[] {
  const lost: string[] = [];
  const check = (value: unknown, path: string): void => {
    if (value === undefined) return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    lost.push(path);
  };
  for (const field of ["nous", "totalEarned", "eraEarned", "arete", "scrap", "capacityBought"]) {
    check(raw[field], field);
  }
  if (Array.isArray(raw.modules)) {
    raw.modules.forEach((module, index) => {
      if (!isRecord(module) || module.type === "mutatorForge") return;
      check(module.invested, `modules[${index}].invested`);
      check(module.reserve, `modules[${index}].reserve`);
    });
  }
  if (isRecord(raw.world)) {
    check(raw.world.frontier, "world.frontier");
    if (Array.isArray(raw.world.weapons)) {
      raw.world.weapons.forEach((weapon, index) => {
        if (isRecord(weapon)) check(weapon.store, `world.weapons[${index}].store`);
      });
    }
  }
  if (isRecord(raw.session)) {
    // A session without its accounting lost its practice facts too: it
    // never loads as zeros.
    if (!isRecord(raw.session.accounting)) lost.push("session.accounting");
    else check(raw.session.accounting.bucketNous, "session.accounting.bucketNous");
  }
  if (isRecord(raw.forge)) check(raw.forge.progress, "forge.progress");
  return lost;
}

export function deserialize(text: string): LoadResult {
  return readSave(text, false);
}

// The lost-money recovery's one door (ADR-0082): the same boundary read,
// with the explicit choice applied. The records load; the unreadable
// figures are named in the report, never invented.
export function recoverLostSave(text: string): LoadResult {
  return readSave(text, true);
}

function readHabit(raw: Habit): Habit {
  return {
    id: raw.id,
    name: raw.name,
    seconds: finiteOr(raw.seconds, 0),
    archived: raw.archived === true,
    color: normalizeHabitColor(raw.color),
  };
}

function readAccounting(raw: Partial<SessionAccounting>): SessionAccounting {
  return {
    creditedSeconds: finiteOr(raw.creditedSeconds, 0),
    poolSeconds: finiteOr(raw.poolSeconds, 0),
    pendingAwaySeconds: finiteOr(raw.pendingAwaySeconds, 0),
    events: Array.isArray(raw.events) ? raw.events : [],
  };
}

function readSession(raw: Partial<SessionState>): SessionState {
  return {
    target: typeof raw.target === "number" && Number.isFinite(raw.target) ? raw.target : null,
    elapsed: finiteOr(raw.elapsed, 0),
    accounting: readAccounting(isRecord(raw.accounting) ? raw.accounting : {}),
    targetSignaled: raw.targetSignaled === true,
    startedAt: finiteOr(raw.startedAt, 0),
    goalSeconds: isRecord(raw.goalSeconds) ? raw.goalSeconds : {},
  };
}

function readSummary(raw: Partial<SessionSummary>): SessionSummary {
  return {
    sessionNumber: finiteOr(raw.sessionNumber, 0),
    seconds: finiteOr(raw.seconds, 0),
    plannedTarget: typeof raw.plannedTarget === "number" ? raw.plannedTarget : null,
    honestyEvents: Array.isArray(raw.honestyEvents) ? raw.honestyEvents : [],
    reflection: raw.reflection ?? null,
    seen: raw.seen === true,
  };
}

function readRecord(raw: SessionRecord): SessionRecord {
  return {
    sessionNumber: raw.sessionNumber,
    startedAt: raw.startedAt,
    endedAt: raw.endedAt,
    habitId: raw.habitId ?? null,
    mode: raw.mode,
    plannedTarget: raw.plannedTarget ?? null,
    creditedSeconds: raw.creditedSeconds,
    honestyEvents: Array.isArray(raw.honestyEvents) ? raw.honestyEvents : [],
    reflection: raw.reflection ?? null,
    goalsAdvanced: Array.isArray(raw.goalsAdvanced) ? raw.goalsAdvanced : [],
  };
}

function readSave(text: string, recovery: boolean): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "The save data is not valid JSON." };
  }
  if (!isRecord(parsed) || parsed.app !== "flowsynth" || typeof parsed.version !== "number") {
    return { error: "This file is not a FlowSynth save." };
  }
  if (parsed.version < SAVE_VERSION) {
    return {
      error: `Incompatible older version (save v${parsed.version}, this build is v${SAVE_VERSION}) — starting fresh.`,
    };
  }
  if (parsed.version > SAVE_VERSION) {
    return { error: `Save version ${parsed.version} is newer than this build supports (${SAVE_VERSION}).` };
  }
  if (!isRecord(parsed.state)) return { error: "The save data is incomplete." };
  const raw = parsed.state;
  if (typeof raw.mode !== "string" || !["upgrade", "flow", "paused", "breather"].includes(raw.mode)) {
    return { error: "The save data has an unknown session mode." };
  }
  for (const field of ["notes", "habits", "practiceLog", "sessionRecords", "goals"]) {
    if (!Array.isArray(raw[field])) return { error: "The save data is incomplete." };
  }
  // A missing accounting object also lost practice-time facts; recovery
  // must not invent the minutes needed to rebuild it.
  if (recovery && isRecord(raw.session) && !isRecord(raw.session.accounting)) {
    return { error: "The session's practice accounting is incomplete; recovery cannot reconstruct it. The original save is unchanged." };
  }
  const lost = lostMonetaryFigures(raw);
  if (lost.length && !recovery) {
    return {
      error: `This save needs explicit recovery: unreadable monetary state (${lost.join(", ")}). The original save is unchanged; loading repairs nothing — recovery is its own explained choice.`,
      recoveryRequired: true,
      lost,
    };
  }
  const fresh = createInitialState();
  // A legacy breather has nothing to resume in the interim build: it lands
  // between sessions, where a finished breather sits.
  const flowing = (raw.mode === "flow" || raw.mode === "paused") && isRecord(raw.session);
  const goals = raw.goals as GameState["goals"];
  normalizeGoals(goals);
  const state: GameState = {
    mode: flowing ? (raw.mode as GameState["mode"]) : "upgrade",
    sessionIndex: finiteOr(raw.sessionIndex, fresh.sessionIndex),
    sessionsCompleted: finiteOr(raw.sessionsCompleted, fresh.sessionsCompleted),
    muted: raw.muted === true,
    notificationAsked: raw.notificationAsked === true,
    notes: raw.notes as GameState["notes"],
    habits: (raw.habits as Habit[]).map(readHabit),
    activeHabitId: typeof raw.activeHabitId === "string" ? raw.activeHabitId : null,
    practiceLog: raw.practiceLog as GameState["practiceLog"],
    sessionRecords: (raw.sessionRecords as SessionRecord[]).map(readRecord),
    goals,
    session: flowing ? readSession(raw.session as Partial<SessionState>) : null,
    summary: isRecord(raw.summary) ? readSummary(raw.summary as Partial<SessionSummary>) : null,
    nextId: finiteOr(raw.nextId, fresh.nextId),
  };
  const recovered = recovery && lost.length > 0 ? { fromVersion: parsed.version, lost } : undefined;
  return { state, ...(recovered && { recovered }) };
}

export const STORAGE_KEY = "flowsynth.save.v1";

// The original save's slot (issue #486): the exact stored or imported
// bytes, retained before anything can replace them.
export const ORIGINAL_SAVE_KEY = "flowsynth.save.original.v1";
// An earlier lineage's original, archived when a recovery or import
// displaces it. The key keeps its historical spelling so existing backups
// stay where they are.
export const ARCHIVED_ORIGINAL_SAVE_KEY = "flowsynth.save.original.pre-v13";
