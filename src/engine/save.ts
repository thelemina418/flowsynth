import { createInitialState } from "./state";
import { normalizeGoals } from "./goals";
import { normalizeHabitColor } from "./habits";
import { SAVE_VERSION } from "./constants";
import { D, fromSave, isNum, NumFault, toSave, type Num } from "./num";
import type { GameState, Habit, HabitClass, SessionAccounting, SessionRecord, SessionState, SessionSummary } from "./types";

// The save boundary. Save v16 (issue #18) writes the nested GameState
// (`records`, `game`) with every Decimal as num's save string, and reads it
// back exactly. The stale-tab guard (ADR-0032, shared-save.ts) and the
// explicit lost-money recovery (ADR-0082) stand: a v16 file whose Decimal
// figures are unreadable refuses an ordinary load and recovers by choice.
//
// A v15 save reads through `readV15`, the one-time v15 → v16 migration
// (issue #19): the real-life records come across, every habit awaits its
// class, and the game starts fresh apart from the Almanac's legacy line.
// SharedSave keeps the original v15 text under PRE_V16_ORIGINAL_SAVE_KEY.
// Saves older than v15 are refused (ADR-0017's pattern).

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
  // A save from a newer build: refused, and its bytes are never replaced.
  newerVersion?: boolean;
  // A save older than v15 (ADR-0017's pattern, issue #19): refused, kept
  // under the pre-v16 key, and the game starts fresh.
  olderVersion?: number;
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

// `savedAt` is the caller's wall clock: the engine never reads one.
export function serialize(state: GameState, savedAt: number): string {
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
    provisionalNous: readLostable(raw.provisionalNous ?? raw.bucketNous),
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
  if (parsed.version > SAVE_VERSION) {
    return {
      error: `Save version ${parsed.version} is newer than this build supports (${SAVE_VERSION}). The save is left untouched.`,
      newerVersion: true,
    };
  }
  if (parsed.version < LEGACY_VERSION) {
    return {
      error: `This save is from an older version of Flowsynth (v${parsed.version}) and can't be read here. It's kept as it was, and the game starts fresh.`,
      olderVersion: parsed.version,
    };
  }
  if (!isRecord(parsed.state)) return { error: "The save data is incomplete." };
  try {
    if (parsed.version === LEGACY_VERSION) return readV15(parsed.state, recovery);
    if (!isRecord(parsed.state.records) || !isRecord(parsed.state.game)) return { error: "The save data is incomplete." };
    return readNested(parsed.state.records, parsed.state.game, parsed.version, recovery);
  } catch (error) {
    if (!(error instanceof NumFault)) throw error;
    return { error: `The save data has an unreadable figure: ${error.detail}.` };
  }
}

// The one earlier version this build reads (issue #19 migrates it).
const LEGACY_VERSION = 15;

// The one-time v15 → v16 migration (issue #19). A flat v15 save — the
// retired build's — migrates; the nested shape issue #17's interim wrote
// under v15 reads as v16 does.
function readV15(raw: Record<string, unknown>, recovery: boolean): LoadResult {
  if (isRecord(raw.records) && isRecord(raw.game)) return readNested(raw.records, raw.game, LEGACY_VERSION, recovery);
  return readFlat(raw, LEGACY_VERSION, recovery);
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

// A saved Decimal the v16 shape can read: num's save string or a finite
// number. Absent reads as the fallback; anything else is lost.
function readableNum(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  try {
    fromSave(value);
    return true;
  } catch (error) {
    if (error instanceof NumFault) return false;
    throw error;
  }
}

// The v16 lost-money walk (ADR-0082): the game's Decimal figures, read raw
// before any default can hide a loss. Detection and repair are one walk:
// a lost figure reads as zero under recovery, and the report names exactly
// these paths.
function lostNestedFigures(game: Record<string, unknown>): string[] {
  const lost: string[] = [];
  if (!readableNum(game.nous)) lost.push("game.nous");
  if (game.mode !== "upgrade" && isRecord(game.session)) {
    // A session without its accounting lost its practice facts too.
    if (!isRecord(game.session.accounting)) lost.push("game.session.accounting");
    else if (!readableNum(game.session.accounting.provisionalNous)) lost.push("game.session.accounting.provisionalNous");
  }
  return lost;
}

// Under recovery a lost figure starts at zero; otherwise it was refused
// before this read.
function readLostable(value: unknown): Num {
  return readableNum(value) ? readNum(value, D(0)) : D(0);
}

// The nested GameState: save v16's shape.
function readNested(records: Record<string, unknown>, game: Record<string, unknown>, version: number, recovery: boolean): LoadResult {
  if (typeof game.mode !== "string" || !MODES.includes(game.mode)) {
    return { error: "The save data has an unknown session mode." };
  }
  for (const field of ["notes", "habits", "practiceLog", "sessionRecords", "intentions"]) {
    if (!Array.isArray(records[field])) return { error: "The save data is incomplete." };
  }
  const lost = lostNestedFigures(game);
  if (recovery && lost.includes("game.session.accounting")) {
    return { error: "The session's practice accounting is incomplete; recovery cannot reconstruct it. The original save is unchanged." };
  }
  if (lost.length && !recovery) return needsRecovery(lost);
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
      nous: readLostable(game.nous),
      mode: flowing ? (game.mode as GameState["game"]["mode"]) : "upgrade",
      session: flowing ? readSession(game.session as Partial<SessionState>) : null,
      summary: isRecord(game.summary) ? readSummary(game.summary as Partial<SessionSummary>) : null,
      openClasses: Array.isArray(game.openClasses)
        ? game.openClasses.map(readClass).filter((c): c is HabitClass => c !== null)
        : fresh.game.openClasses,
      legacyLine: typeof game.legacyLine === "string" ? game.legacyLine : null,
    },
  };
  const recovered = recovery && lost.length > 0 ? { fromVersion: version, lost } : undefined;
  return { state, ...(recovered && { recovered }) };
}

function needsRecovery(lost: string[]): LoadResult {
  return {
    error: `This save needs explicit recovery: unreadable monetary state (${lost.join(", ")}). The original save is unchanged; loading repairs nothing — recovery is its own explained choice.`,
    recoveryRequired: true,
    lost,
  };
}

// A flat v15 save: the retired build's, or issue #15's interim. The
// real-life records come across; every habit awaits its class; the game
// starts fresh apart from a running session's trust ledger and its
// provisional nous. The collection becomes the Almanac's legacy line.
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
  if (lost.length && !recovery) return needsRecovery(lost);
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
      legacyLine: legacyLineOf(raw.modules),
      mode: flowing ? (raw.mode as GameState["game"]["mode"]) : "upgrade",
      session: flowing ? readSession(raw.session as Partial<SessionState>) : null,
      // Only a summary the player has yet to see carries its practice
      // facts across; a dismissed one is the retired game's leftover.
      summary: isRecord(raw.summary) && raw.summary.seen !== true ? readSummary(raw.summary as Partial<SessionSummary>) : null,
    },
  };
  const recovered = recovery && lost.length > 0 ? { fromVersion: version, lost } : undefined;
  return { state, ...(recovered && { recovered }) };
}

// The Almanac's one line from the retired game (issue #19): the v15
// collection's size, placed and unplaced alike. A retired Mutator Forge is
// not a collection module (the v15 build itself dropped it at load). A
// flat save with no collection at all is issue #15's interim shape, never
// a played v15 game: it gets no line.
function legacyLineOf(modules: unknown): string | null {
  if (!Array.isArray(modules)) return null;
  const n = modules.filter((module) => !(isRecord(module) && module.type === "mutatorForge")).length;
  return `Legacy era · ${n} ${n === 1 ? "module" : "modules"} · archived`;
}

export const STORAGE_KEY = "flowsynth.save.v1";

// The original save's slot (issue #486): the exact stored or imported
// bytes, retained before anything can replace them.
export const ORIGINAL_SAVE_KEY = "flowsynth.save.original.v1";
// An earlier lineage's original, archived when a recovery or import
// displaces it. The key keeps its historical spelling so existing backups
// stay where they are.
export const ARCHIVED_ORIGINAL_SAVE_KEY = "flowsynth.save.original.pre-v13";
// The one-time v15 → v16 migration's original (issue #19): the exact text
// of a save older than v16 — a migrated v15 save, or a refused older one —
// kept before the first v16 write can replace it. The retired build's
// pre-v13/v14/v15 keys set the spelling.
export const PRE_V16_ORIGINAL_SAVE_KEY = "flowsynth.save.original.pre-v16";

// Whether these bytes are a Flowsynth save older than v16: the text the
// pre-v16 key keeps.
export function isPreV16Save(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) && parsed.app === "flowsynth" && typeof parsed.version === "number" && parsed.version < SAVE_VERSION;
  } catch {
    return false;
  }
}
