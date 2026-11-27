import { createInitialState } from "./state";
import { normalizeGoals } from "./goals";
import { normalizeHabitColor } from "./habits";
import { SAVE_VERSION } from "./constants";
import { D, fromSave, isNum, NumFault, toSave, type Num } from "./num";
import type { GameState, Habit, HabitClass, SessionAccounting, SessionRecord, SessionState, SessionSummary } from "./types";

// The interim save boundary (issue #15). It reads the real-life records —
// habits, Notes, the practice log, Intentions and their calendar, session
// history, a running session's trust ledger — out of a v15 save and writes
// them back in the interim shape. Everything else in a v15 save (the board,
// the economy, the World) is left behind. The stale-tab guard (ADR-0032,
// shared-save.ts) and the explicit recovery (ADR-0082) stand. Dev-only:
// save v16 and the one-time v15 migration replace this (issues #18, #19).
//
// Interim (issue #17): it writes the nested GameState (`records`, `game`)
// with every Decimal as num's save string, still under version 15, and
// reads either that shape or a flat v15 save (the retired build's, or
// issue #15's interim) into the GameState.

export interface SaveFile {
  app: "flowsynth";
  version: number;
  savedAt: number;
  // The GameState with every Decimal written as num's save string.
  state: unknown;
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

// Decimals become their save strings; a NaN refuses the write.
function encode(value: unknown, path: string): unknown {
  if (isNum(value)) {
    try {
      return toSave(value);
    } catch (error) {
      if (!(error instanceof NumFault)) throw error;
      throw new SaveRefusedError(`The save refuses to write "${path}" — its figure is NaN.`);
    }
  }
  if (Array.isArray(value)) return value.map((item, index) => encode(item, `${path}[${index}]`));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = encode(item, `${path}.${key}`);
    return out;
  }
  return value;
}

export function serialize(state: GameState, savedAt: number = Date.now()): string {
  const file: SaveFile = { app: "flowsynth", version: SAVE_VERSION, savedAt, state: encode(state, "save.state") };
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

const HABIT_CLASSES: readonly HabitClass[] = ["engineer", "producer", "mixer", "roadie"];

function readClass(value: unknown): HabitClass | null {
  return typeof value === "string" && (HABIT_CLASSES as readonly string[]).includes(value) ? (value as HabitClass) : null;
}

// A saved Decimal: the nested shape writes num's save string; a flat v15
// save wrote a plain number. Anything else reads as the fallback.
function readNum(value: unknown, fallback: Num): Num {
  if (typeof value === "string") return fromSave(value);
  if (typeof value === "number" && Number.isFinite(value)) return D(value);
  return fallback;
}

// A flat v15 habit carries a retired `classId`: every v15 habit awaits its
// class (story 9). The nested shape carries `habitClass`.
function readHabit(raw: Habit): Habit {
  return {
    id: raw.id,
    name: raw.name,
    seconds: finiteOr(raw.seconds, 0),
    archived: raw.archived === true,
    color: normalizeHabitColor(raw.color),
    habitClass: readClass(raw.habitClass),
  };
}

// A flat v15 session holds its provisional nous as `bucketNous`.
function readAccounting(raw: Partial<SessionAccounting> & { bucketNous?: unknown }): SessionAccounting {
  return {
    creditedSeconds: finiteOr(raw.creditedSeconds, 0),
    poolSeconds: finiteOr(raw.poolSeconds, 0),
    pendingAwaySeconds: finiteOr(raw.pendingAwaySeconds, 0),
    events: Array.isArray(raw.events) ? raw.events : [],
    provisionalNous: readNum(raw.provisionalNous ?? raw.bucketNous, D(0)),
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
  try {
    if (isRecord(parsed.state.records) && isRecord(parsed.state.game)) return readNested(parsed.state.records, parsed.state.game);
    return readFlat(parsed.state, parsed.version, recovery);
  } catch (error) {
    if (!(error instanceof NumFault)) throw error;
    return { error: `The save data has an unreadable figure: ${error.detail}.` };
  }
}

const MODES = ["upgrade", "flow", "paused"];

function readClassCredit(raw: unknown): Record<HabitClass, number> {
  const source = isRecord(raw) ? raw : {};
  return {
    engineer: finiteOr(source.engineer, 0),
    producer: finiteOr(source.producer, 0),
    mixer: finiteOr(source.mixer, 0),
    roadie: finiteOr(source.roadie, 0),
  };
}

// The nested GameState this interim build writes.
function readNested(records: Record<string, unknown>, game: Record<string, unknown>): LoadResult {
  if (typeof game.mode !== "string" || !MODES.includes(game.mode)) {
    return { error: "The save data has an unknown session mode." };
  }
  for (const field of ["notes", "habits", "practiceLog", "sessionRecords", "intentions"]) {
    if (!Array.isArray(records[field])) return { error: "The save data is incomplete." };
  }
  const fresh = createInitialState();
  const flowing = game.mode !== "upgrade" && isRecord(game.session);
  const intentions = records.intentions as GameState["records"]["intentions"];
  normalizeGoals(intentions);
  const state: GameState = {
    records: {
      habits: (records.habits as Habit[]).map(readHabit),
      activeHabitId: typeof records.activeHabitId === "string" ? records.activeHabitId : null,
      practiceLog: records.practiceLog as GameState["records"]["practiceLog"],
      sessionRecords: (records.sessionRecords as SessionRecord[]).map(readRecord),
      notes: records.notes as GameState["records"]["notes"],
      intentions,
      classCredit: readClassCredit(records.classCredit),
      sessionIndex: finiteOr(records.sessionIndex, fresh.records.sessionIndex),
      sessionsCompleted: finiteOr(records.sessionsCompleted, fresh.records.sessionsCompleted),
      nextId: finiteOr(records.nextId, fresh.records.nextId),
    },
    game: {
      nous: readNum(game.nous, D(0)),
      mode: flowing ? (game.mode as GameState["game"]["mode"]) : "upgrade",
      session: flowing ? readSession(game.session as Partial<SessionState>) : null,
      summary: isRecord(game.summary) ? readSummary(game.summary as Partial<SessionSummary>) : null,
      openClasses: Array.isArray(game.openClasses)
        ? game.openClasses.map(readClass).filter((c): c is HabitClass => c !== null)
        : fresh.game.openClasses,
      legacyLine: typeof game.legacyLine === "string" ? game.legacyLine : null,
    },
  };
  return { state };
}

// A flat v15 save: the retired build's, or issue #15's interim. The
// real-life records come across; every habit awaits its class; the game
// starts fresh apart from a running session's trust ledger and its
// provisional nous. The legacy line and the original's retention are
// issue #19's.
function readFlat(raw: Record<string, unknown>, version: number, recovery: boolean): LoadResult {
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
  // A legacy breather has nothing to resume in this build: it lands
  // between sessions, where a finished breather sits.
  const flowing = (raw.mode === "flow" || raw.mode === "paused") && isRecord(raw.session);
  const intentions = raw.goals as GameState["records"]["intentions"];
  normalizeGoals(intentions);
  const state: GameState = {
    records: {
      habits: (raw.habits as Habit[]).map((habit) => readHabit({ ...habit, habitClass: null })),
      activeHabitId: typeof raw.activeHabitId === "string" ? raw.activeHabitId : null,
      practiceLog: raw.practiceLog as GameState["records"]["practiceLog"],
      sessionRecords: (raw.sessionRecords as SessionRecord[]).map(readRecord),
      notes: raw.notes as GameState["records"]["notes"],
      intentions,
      classCredit: fresh.records.classCredit,
      sessionIndex: finiteOr(raw.sessionIndex, fresh.records.sessionIndex),
      sessionsCompleted: finiteOr(raw.sessionsCompleted, fresh.records.sessionsCompleted),
      nextId: finiteOr(raw.nextId, fresh.records.nextId),
    },
    game: {
      ...fresh.game,
      mode: flowing ? (raw.mode as GameState["game"]["mode"]) : "upgrade",
      session: flowing ? readSession(raw.session as Partial<SessionState>) : null,
      summary: isRecord(raw.summary) ? readSummary(raw.summary as Partial<SessionSummary>) : null,
    },
  };
  const recovered = recovery && lost.length > 0 ? { fromVersion: version, lost } : undefined;
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
