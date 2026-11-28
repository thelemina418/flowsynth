import type { ArmType, ModulatorType, ModuleCategory, ModuleType, OscillatorType, ReachHolds } from "./types";

// The module catalogue (GLOSSARY: Module, Category): each type's category,
// its nameplate, and for an oscillator its base rate and resonance pattern
// (mechanics-sketch.md, Oscillators), and for a modulator whether it has a
// facing (issue #31), its output and its reach (issue #32).
// New oscillator types are added as data: the matcher (engine/resonance.ts)
// reads the pattern, never the type.

// Which module may stand as a pattern's partner. Walls and empty cells
// hold no module, so they are never partners.
export type PartnerRule = { kind: "type"; module: ModuleType } | { kind: "category"; category: ModuleCategory } | { kind: "any" };

// A pattern, relative to the oscillator: each partner cell is a path of
// steps through hex.ts's DIRECTIONS (index 0 = upper-right, clockwise). The
// matcher tries all 6 rotations and, unless `mirrored` is false, their
// mirror images. An orientation is satisfied when at least `atLeast` of its
// cells (all of them by default) hold a partner; the partners it found
// are the instance.
export interface Pattern {
  paths: readonly (readonly number[])[];
  partner: PartnerRule;
  atLeast?: number;
  mirrored?: boolean;
  // R: the first instance adds R to the factor, each further one half the
  // one before.
  strength: number;
}

// A modulator's reach (issue #32; GLOSSARY: Reach): the cells its charge
// goes to while it isn't patched, as paths of steps through hex.ts's
// DIRECTIONS relative to the modulator. A faced reach is drawn for facing
// 0 (NE) and turned with the modulator's facing; a facing-free one is
// fixed. A wall doesn't block it: every cell gets the full output.
export interface Reach {
  paths: readonly (readonly number[])[];
  faced: boolean;
}

// A modulator's output, charge/s to each target in its reach: `base`,
// plus `perProducerHour` for each credited Producer hour, up to `max`.
export interface Output {
  base: number;
  perProducerHour?: number;
  max?: number;
}

interface ModuleSpec {
  category: ModuleCategory;
  name: string;
  // ν/s in flow before any factor.
  base: number;
  // ν/s in a breather before any factor, where it differs from `base`
  // (issue #41): Release wakes.
  breatherBase?: number;
  pattern: Pattern | null;
  // A facing the player turns in upgrade mode (issue #31).
  faces?: true;
  // A modulator's output and reach (issue #32).
  output?: Output;
  reach?: Reach;
  // An Arm's damage to the wall it faces per charge/s received (issue
  // #53).
  damagePerCharge?: number;
}

const OSCILLATOR: PartnerRule = { kind: "category", category: "oscillator" };

const MODULES: Record<ModuleType, ModuleSpec> = {
  // Both cells of one opposite pair of neighbours hold Triangles.
  sine: { category: "oscillator", name: "Sine", base: 1, pattern: { paths: [[0], [3]], partner: { kind: "type", module: "triangle" }, strength: 1 } },
  // Two neighbours that are neighbours of each other hold oscillators.
  triangle: { category: "oscillator", name: "Triangle", base: 1, pattern: { paths: [[0], [1]], partner: OSCILLATOR, strength: 0.75 } },
  // 4 or more of the 6 neighbours hold any module: a threshold, so one
  // instance at most.
  square: {
    category: "oscillator",
    name: "Square",
    base: 1.5,
    pattern: { paths: [[0], [1], [2], [3], [4], [5]], partner: { kind: "any" }, atLeast: 4, strength: 1.5 },
  },
  // The next two cells in one direction hold oscillators: the Saw ends a
  // straight line of three.
  saw: { category: "oscillator", name: "Saw", base: 2, pattern: { paths: [[0], [0, 0]], partner: OSCILLATOR, strength: 2 } },
  // No pattern, and nothing in flow; 6 ν/s in a breather (issue #41).
  release: { category: "oscillator", name: "Release", base: 0, breatherBase: 6, pattern: null },
  // Modulators make charge, not ν: no base and no pattern.
  // 1 charge/s, +0.1 per credited Producer hour up to 3, to the 2 cells in
  // a straight line in its facing.
  flywheel: {
    category: "modulator",
    name: "Flywheel",
    base: 0,
    pattern: null,
    faces: true,
    output: { base: 1, perProducerHour: 0.1, max: 3 },
    reach: { paths: [[0], [0, 0]], faced: true },
  },
  // 0.5 charge/s to each of its 6 neighbours, facing-free. Declared only:
  // chunk 04 makes it arrive.
  pulsewell: {
    category: "modulator",
    name: "Pulsewell",
    base: 0,
    pattern: null,
    output: { base: 0.5 },
    reach: { paths: [[0], [1], [2], [3], [4], [5]], faced: false },
  },
  // Arms (issue #53) make neither ν nor charge. The Blade turns the charge
  // it receives into 10× damage on the wall it faces.
  blade: { category: "arm", name: "Blade", base: 0, pattern: null, faces: true, damagePerCharge: 10 },
};

export const MODULE_TYPES = Object.keys(MODULES) as readonly ModuleType[];

export function isModuleType(value: unknown): value is ModuleType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MODULES, value);
}

export function categoryOf(module: ModuleType): ModuleCategory {
  return MODULES[module].category;
}

export function isOscillator(module: ModuleType): module is OscillatorType {
  return categoryOf(module) === "oscillator";
}

export function isModulator(module: ModuleType): module is ModulatorType {
  return categoryOf(module) === "modulator";
}

export function isArm(module: ModuleType): module is ArmType {
  return categoryOf(module) === "arm";
}

// Whether a delivery onto a cell holding this charges it: an oscillator
// (its charge factor) and the Blade (its damage, issue #53).
export function takesCharge(holds: ReachHolds): holds is OscillatorType | "blade" {
  return holds !== "empty" && holds !== "wall" && holds !== "dark" && (isOscillator(holds) || MODULES[holds].damagePerCharge !== undefined);
}

// An Arm's damage per charge/s received, 0 for every other type.
export function damagePerCharge(module: ModuleType): number {
  return MODULES[module].damagePerCharge ?? 0;
}

export function moduleName(module: ModuleType): string {
  return MODULES[module].name;
}

export function baseRate(module: ModuleType): number {
  return MODULES[module].base;
}

export function breatherBaseRate(module: ModuleType): number {
  return MODULES[module].breatherBase ?? MODULES[module].base;
}

export function hasFacing(module: ModuleType): boolean {
  return MODULES[module].faces === true;
}

export function patternOf(module: ModuleType): Pattern | null {
  return MODULES[module].pattern;
}

const NO_OUTPUT: Output = { base: 0 };
const NO_REACH: Reach = { paths: [], faced: false };

export function outputOf(module: ModuleType): Output {
  return MODULES[module].output ?? NO_OUTPUT;
}

export function reachOf(module: ModuleType): Reach {
  return MODULES[module].reach ?? NO_REACH;
}

const CATEGORY_NAMES: Record<ModuleCategory, string> = { oscillator: "Oscillator", modulator: "Modulator", arm: "Arm" };

export function categoryName(category: ModuleCategory): string {
  return CATEGORY_NAMES[category];
}
