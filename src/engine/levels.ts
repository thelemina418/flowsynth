import type { CableType, GameState, HabitClass, ModuleCategory, ModuleType } from "./types";

// Class levels and their grants (spec chunk 04, issue #38). A class's
// level is how many thresholds its credited flow seconds
// (`records.classCredit`) have passed. Each class has a grant ladder: what
// each level grants, +1 allowance of its craft or one new type. Allowance
// and the arrived types are one pure derivation of class credit and the
// open classes, never stored: class credit never decreases, so allowance
// never shrinks below what's placed.

const HOUR = 3600;

// The first thresholds, in hours on the class. Past the last, each step
// is 1 h longer than the one before (38, 47, 57, 68…).
const THRESHOLD_HOURS = [0.5, 1.5, 3, 5, 8, 12, 17, 23, 30] as const;

// The threshold for Lv `level` (≥ 1), in seconds.
function thresholdHours(level: number): number {
  if (level <= THRESHOLD_HOURS.length) return THRESHOLD_HOURS[level - 1]!;
  const last = THRESHOLD_HOURS.length;
  let hours: number = THRESHOLD_HOURS[last - 1]!;
  let step: number = THRESHOLD_HOURS[last - 1]! - THRESHOLD_HOURS[last - 2]!;
  for (let l = last + 1; l <= level; l++) {
    step += 1;
    hours += step;
  }
  return hours;
}

export interface ClassLevel {
  level: number;
  // The credited seconds at which this level was reached (0 at Lv 0), and
  // at which the next one is.
  current: number;
  next: number;
}

export function classLevelOf(seconds: number): ClassLevel {
  let level = 0;
  while (seconds >= thresholdHours(level + 1) * HOUR) level++;
  return { level, current: level === 0 ? 0 : thresholdHours(level) * HOUR, next: thresholdHours(level + 1) * HOUR };
}

export function classLevel(state: GameState, habitClass: HabitClass): ClassLevel {
  return classLevelOf(state.records.classCredit[habitClass]);
}

// What one level grants.
type Grant =
  | { kind: "allowance"; category: ModuleCategory }
  | { kind: "cable" }
  | { kind: "type"; module: ModuleType }
  | { kind: "cableType"; cable: CableType };

const OSCILLATOR: Grant = { kind: "allowance", category: "oscillator" };
const MODULATOR: Grant = { kind: "allowance", category: "modulator" };
const CABLE: Grant = { kind: "cable" };
const ARM: Grant = { kind: "allowance", category: "arm" };

// A ladder: what the class brings the moment it opens (Lv 0), the
// authored levels from Lv 1, then what every later level grants.
interface Ladder {
  start?: readonly Grant[];
  levels: readonly (Grant | null)[];
  after: (level: number) => Grant | null;
}

// The grant ladders, as data (mechanics-sketch.md, Classes).
const LADDERS: Record<HabitClass, Ladder> = {
  // Lv 1 +1, Lv 2 Square, Lv 3 +1, Lv 4 Saw, Lv 5 +1, Lv 6 Release, then
  // +1 Oscillator each.
  engineer: {
    levels: [OSCILLATOR, { kind: "type", module: "square" }, OSCILLATOR, { kind: "type", module: "saw" }, OSCILLATOR, { kind: "type", module: "release" }],
    after: () => OSCILLATOR,
  },
  // The non-milestone levels alternate +1 Modulator and +1 cable, starting
  // with a Modulator; the milestone (Lv 3, the Pulsewell) is skipped in
  // the alternation. Agreed with the maintainer.
  producer: {
    levels: [MODULATOR, CABLE, { kind: "type", module: "pulsewell" }, MODULATOR, CABLE],
    // Lv 6 is the 5th non-milestone level (index 4): even indices are
    // Modulators.
    after: (level) => ((level - 2) % 2 === 0 ? MODULATOR : CABLE),
  },
  // Lv 0 the Blade and 1 Arm, Lv 1 +1 Arm, Lv 2 the Guard Plate (issue
  // #54), then +1 Arm each (issue #53).
  roadie: { start: [{ kind: "type", module: "blade" }, ARM], levels: [ARM, { kind: "type", module: "guardPlate" }], after: () => ARM },
  // Declared for Demo (Mixer): its types don't exist yet, and a closed
  // class grants nothing, so the ladder is empty until that chunk fills it.
  mixer: { levels: [], after: () => null },
};

function grantAt(habitClass: HabitClass, level: number): Grant | null {
  const ladder = LADDERS[habitClass];
  return level <= ladder.levels.length ? ladder.levels[level - 1]! : ladder.after(level);
}

export interface Grants {
  // How many modules of each category may be placed at once (GLOSSARY:
  // Allowance), and how many cables.
  allowance: Record<ModuleCategory, number>;
  cableAllowance: number;
  // The start types first, then in arrival order.
  arrived: ModuleType[];
  arrivedCables: CableType[];
}

// The class order a tie between two arrivals at one threshold falls to.
const CLASS_ORDER: readonly HabitClass[] = ["engineer", "producer", "mixer", "roadie"];

// The opening grants: what a fresh start has before any level.
function opening(): Grants {
  return {
    allowance: { oscillator: 2, modulator: 1, arm: 0 },
    cableAllowance: 1,
    arrived: ["sine", "triangle", "flywheel"],
    arrivedCables: ["patch"],
  };
}

// The derivation: every open class's ladder up to its level. A type
// arrives in the order of the threshold that brought it (the credit
// history isn't kept, and a threshold never moves).
export function grantsOf(state: GameState): Grants {
  const grants = opening();
  const arrivals: { at: number; order: number; grant: Grant }[] = [];
  for (const habitClass of CLASS_ORDER) {
    if (!state.game.openClasses.includes(habitClass)) continue;
    const { level } = classLevel(state, habitClass);
    for (const grant of LADDERS[habitClass].start ?? []) arrivals.push({ at: 0, order: CLASS_ORDER.indexOf(habitClass), grant });
    for (let l = 1; l <= level; l++) {
      const grant = grantAt(habitClass, l);
      if (grant) arrivals.push({ at: thresholdHours(l), order: CLASS_ORDER.indexOf(habitClass), grant });
    }
  }
  arrivals.sort((a, b) => a.at - b.at || a.order - b.order);
  for (const { grant } of arrivals) {
    switch (grant.kind) {
      case "allowance":
        grants.allowance[grant.category] += 1;
        break;
      case "cable":
        grants.cableAllowance += 1;
        break;
      case "type":
        if (!grants.arrived.includes(grant.module)) grants.arrived.push(grant.module);
        break;
      case "cableType":
        if (!grants.arrivedCables.includes(grant.cable)) grants.arrivedCables.push(grant.cable);
        break;
    }
  }
  return grants;
}
