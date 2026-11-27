import type { ModuleCategory, ModuleType } from "./types";

// The module catalogue (GLOSSARY: Module, Category): each type's category,
// its nameplate, and for an oscillator its base rate and resonance pattern
// (mechanics-sketch.md, Oscillators). Chunk 03 adds the modulators here.
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

interface ModuleSpec {
  category: ModuleCategory;
  name: string;
  // ν/s in flow before any factor.
  base: number;
  pattern: Pattern | null;
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
  // No pattern, and nothing in flow; its breather output is chunk 04's.
  release: { category: "oscillator", name: "Release", base: 0, pattern: null },
};

export const MODULE_TYPES = Object.keys(MODULES) as readonly ModuleType[];

export function isModuleType(value: unknown): value is ModuleType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MODULES, value);
}

export function categoryOf(module: ModuleType): ModuleCategory {
  return MODULES[module].category;
}

export function moduleName(module: ModuleType): string {
  return MODULES[module].name;
}

export function baseRate(module: ModuleType): number {
  return MODULES[module].base;
}

export function patternOf(module: ModuleType): Pattern | null {
  return MODULES[module].pattern;
}

const CATEGORY_NAMES: Record<ModuleCategory, string> = { oscillator: "Oscillator" };

export function categoryName(category: ModuleCategory): string {
  return CATEGORY_NAMES[category];
}
