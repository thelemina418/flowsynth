import { createInitialState } from "./state";
import { normalizeIntentions } from "./intentions";
import { normalizeHabitColor } from "./habits";
import { SAVE_VERSION } from "./constants";
import { D, fromSave, isNum, NumFault, toSave, type Num } from "./num";
import { ARCS, openingBoard } from "./board";
import { cellKey, isFacing, LIFETIME_RADIUS, ring, type Cell } from "./hex";
import { hasFacing, isModuleType } from "./modules";
import { isCableType, newCableRefusal } from "./cables";
import { computeBoardRates } from "./rates";
import type { Arc, Board, Cable, CableType, Game, GameState, Habit, HabitClass, ModuleCategory, ModuleType, Placement, SessionAccounting, SessionRecord, SessionState, SessionSummary } from "./types";

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
// The board's rates are derived from the layout (issue #26): the save
// holds the layout, never the rates, and the reader recomputes them.
export function serialize(state: GameState, savedAt: number): string {
  const { rates: _derived, ...game } = state.game;
  const saved = { records: state.records, game };
  const file: SaveFile = { app: "flowsynth", version: SAVE_VERSION, savedAt, state: encode(saved, "save.state") };
  assertSerializable(file, "save");
  return JSON.stringify(file, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// The v15 figures that survive the migration (ADR-0082): a running
// session's practice accounting and its provisional bucket nous. Every
// other v15 monetary figure stays behind with the retired game, so its loss
// costs the player nothing and never asks for the recovery. A pre-integrity
// build could write a nonfinite figure as null: a surviving figure that is
// present but unreadable is lost money, and loading refuses until the
// player chooses the recovery.
function lostV15Figures(session: Record<string, unknown>): string[] {
  // A session without its accounting lost its practice facts too: it
  // never loads as zeros.
  if (!isRecord(session.accounting)) return ["session.accounting"];
  const bucket = session.accounting.bucketNous;
  if (bucket === undefined || (typeof bucket === "number" && Number.isFinite(bucket))) return [];
  return ["session.accounting.bucketNous"];
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

// A saved Decimal: v16 writes num's save string; v15 wrote a plain number. Anything else reads as the fallback.
function readNum(value: unknown, fallback: Num): Num {
  if (typeof value === "string") return fromSave(value);
  if (typeof value === "number" && Number.isFinite(value)) return D(value);
  return fallback;
}

// A v15 habit carries a retired `classId`: every v15 habit awaits its
// class (story 9). A v16 habit carries `habitClass`.
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

// A v15 session holds its provisional nous as `bucketNous`.
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
  normalizeIntentions(intentions);
  const board = readBoard(game.board);
  const cableAllowance = Number.isInteger(game.cableAllowance) && (game.cableAllowance as number) >= 0 ? (game.cableAllowance as number) : fresh.game.cableAllowance;
  const arrivedCables = readArrivedCables(game.arrivedCables, fresh.game.arrivedCables);
  board.cables = readCables(isRecord(game.board) ? game.board.cables : undefined, { board, cableAllowance, arrivedCables });
  const classCredit = readClassCredit(records.classCredit);
  const state: GameState = {
    records: {
      habits: (records.habits as Habit[]).map(readHabit),
      activeHabitId: typeof records.activeHabitId === "string" ? records.activeHabitId : null,
      practiceLog: records.practiceLog as GameState["records"]["practiceLog"],
      sessionRecords: (records.sessionRecords as SessionRecord[]).map(readRecord),
      notes: records.notes as GameState["records"]["notes"],
      intentions,
      classCredit,
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
      board,
      allowance: readAllowance(game.allowance, fresh.game.allowance),
      arrived: readArrived(game.arrived, fresh.game.arrived),
      cableAllowance,
      arrivedCables,
      // Recomputed once from the layout; a saved rate is never read.
      rates: computeBoardRates(board, classCredit.producer),
    },
  };
  const recovered = recovery && lost.length > 0 ? { fromVersion: version, lost } : undefined;
  return { state, ...(recovered && { recovered }) };
}

function readCell(value: unknown): Cell | null {
  if (!isRecord(value) || !Number.isInteger(value.q) || !Number.isInteger(value.r)) return null;
  const cell = { q: value.q as number, r: value.r as number };
  return ring(cell) <= LIFETIME_RADIUS ? cell : null;
}

// The board (issue #24) is an additive v16 field: a save written before it
// has none and loads the opening board. Cells the lifetime board can't hold
// are dropped; a board with no readable cell is the opening board, never an
// invented one.
function readBoard(raw: unknown): Board {
  const opening = openingBoard();
  if (!isRecord(raw) || !Array.isArray(raw.open)) return opening;
  const seen = new Set<string>();
  const open: Cell[] = [];
  for (const item of raw.open) {
    const cell = readCell(item);
    if (cell === null || seen.has(cellKey(cell))) continue;
    seen.add(cellKey(cell));
    open.push(cell);
  }
  if (open.length === 0) return opening;
  const arc = typeof raw.arc === "string" && (ARCS as readonly string[]).includes(raw.arc) ? (raw.arc as Arc) : opening.arc;
  return { open, arc, placements: readPlacements(raw.placements, seen), cables: [] };
}

// Placements (issue #25): a placement whose type is unknown, or whose cell
// isn't an owned open cell (or already holds a module), returns to
// unplaced rather than failing the load. Allowance is a count, so nothing
// is lost. A module with a facing (issue #31) reads it, NE when it is
// missing or invalid; a module without one never carries one.
function readPlacements(raw: unknown, owned: Set<string>): Placement[] {
  if (!Array.isArray(raw)) return [];
  const taken = new Set<string>();
  const placements: Placement[] = [];
  for (const item of raw) {
    if (!isRecord(item) || !isModuleType(item.module)) continue;
    const cell = readCell(item.cell);
    if (cell === null || !owned.has(cellKey(cell)) || taken.has(cellKey(cell))) continue;
    taken.add(cellKey(cell));
    const facing = isFacing(item.facing) ? item.facing : 0;
    placements.push({ cell, module: item.module, ...(hasFacing(item.module) && { facing }) });
  }
  return placements;
}

// Cables (issue #33), read in saved order onto the placed board: a cable
// whose type is unknown, whose source isn't a placed modulator or already
// carries an earlier cable, whose target is dark or its own source, that is
// longer than 3, crosses a cable read before it, or is over the allowance,
// is unplugged back to the allowance rather than failing the load: the
// rules a new cable is patched by. A wall in the current arc is a target
// like an open cell (issue #34). Returns the cables kept; `game` is read,
// never changed.
function readCables(raw: unknown, game: Pick<Game, "board" | "cableAllowance" | "arrivedCables">): Cable[] {
  if (!Array.isArray(raw)) return [];
  const cables: Cable[] = [];
  const reading = { ...game, board: { ...game.board, cables } };
  for (const item of raw) {
    if (!isRecord(item) || !isCableType(item.type)) continue;
    const source = readCell(item.source);
    const target = readCell(item.target);
    if (source === null || target === null) continue;
    const cable: Cable = { type: item.type, source, target };
    if (newCableRefusal(reading, cable) === null) cables.push(cable);
  }
  return cables;
}

// The saved cable types, then any the opening holds that the save lacks.
function readArrivedCables(raw: unknown, opening: CableType[]): CableType[] {
  const saved = Array.isArray(raw) ? raw.filter(isCableType) : [];
  return [...saved, ...opening].filter((type, index, all) => all.indexOf(type) === index);
}

function readAllowance(raw: unknown, opening: Record<ModuleCategory, number>): Record<ModuleCategory, number> {
  const allowance = { ...opening };
  if (!isRecord(raw)) return allowance;
  for (const category of Object.keys(allowance) as ModuleCategory[]) {
    const count = raw[category];
    if (Number.isInteger(count) && (count as number) >= 0) allowance[category] = count as number;
  }
  return allowance;
}

// The saved arrival order, then any type the opening holds that the save
// lacks: a type that arrives at the start is never missing, so a chunk-02
// save gains the Flywheel (issue #31).
function readArrived(raw: unknown, opening: ModuleType[]): ModuleType[] {
  const saved = Array.isArray(raw) ? raw.filter(isModuleType) : [];
  return [...saved, ...opening].filter((module, index, all) => all.indexOf(module) === index);
}

function needsRecovery(lost: string[]): LoadResult {
  return {
    error: `This save needs explicit recovery: unreadable monetary state (${lost.join(", ")}). The original save is unchanged; loading repairs nothing — recovery is its own explained choice.`,
    recoveryRequired: true,
    lost,
  };
}

// The one-time v15 → v16 migration (issue #19): the retired build's save.
// The real-life records come across; every habit awaits its class; the
// game starts fresh apart from a running session's trust ledger and its
// provisional nous. The collection becomes the Almanac's legacy line.
function readV15(raw: Record<string, unknown>, recovery: boolean): LoadResult {
  if (typeof raw.mode !== "string" || !["upgrade", "flow", "paused", "breather"].includes(raw.mode)) {
    return { error: "The save data has an unknown session mode." };
  }
  for (const field of ["notes", "habits", "practiceLog", "sessionRecords", "goals"]) {
    if (!Array.isArray(raw[field])) return { error: "The save data is incomplete." };
  }
  // A legacy breather has nothing to resume in this build: it lands
  // between sessions, where a finished breather sits.
  const flowing = (raw.mode === "flow" || raw.mode === "paused") && isRecord(raw.session);
  const lost = flowing ? lostV15Figures(raw.session as Record<string, unknown>) : [];
  // A missing accounting object also lost practice-time facts; recovery
  // must not invent the minutes needed to rebuild it.
  if (recovery && lost.includes("session.accounting")) {
    return { error: "The session's practice accounting is incomplete; recovery cannot reconstruct it. The original save is unchanged." };
  }
  if (lost.length && !recovery) return needsRecovery(lost);
  const fresh = createInitialState();
  const intentions = raw.goals as GameState["records"]["intentions"];
  normalizeIntentions(intentions);
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
      // The migration starts from the opening board, and its rates.
      rates: computeBoardRates(fresh.game.board, fresh.records.classCredit.producer),
      legacyLine: legacyLineOf(raw.modules),
      mode: flowing ? (raw.mode as GameState["game"]["mode"]) : "upgrade",
      session: flowing ? readSession(raw.session as Partial<SessionState>) : null,
      // Only a summary the player has yet to see carries its practice
      // facts across; a dismissed one is the retired game's leftover.
      summary: isRecord(raw.summary) && raw.summary.seen !== true ? readSummary(raw.summary as Partial<SessionSummary>) : null,
    },
  };
  const recovered = recovery && lost.length > 0 ? { fromVersion: LEGACY_VERSION, lost } : undefined;
  return { state, ...(recovered && { recovered }) };
}

// The Almanac's one line from the retired game (issue #19): the v15
// collection's size, placed and unplaced alike. A retired Mutator Forge is
// not a collection module (the v15 build itself dropped it at load).
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
