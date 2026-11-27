import type { ModuleCategory, ModuleType } from "./types";

// The module catalogue (GLOSSARY: Module, Category): each type's category
// and its nameplate. Chunk 03 adds the modulators here; patterns and base
// rates arrive with resonance (issue #26).

interface ModuleSpec {
  category: ModuleCategory;
  name: string;
}

const MODULES: Record<ModuleType, ModuleSpec> = {
  sine: { category: "oscillator", name: "Sine" },
  triangle: { category: "oscillator", name: "Triangle" },
  square: { category: "oscillator", name: "Square" },
  saw: { category: "oscillator", name: "Saw" },
  release: { category: "oscillator", name: "Release" },
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

const CATEGORY_NAMES: Record<ModuleCategory, string> = { oscillator: "Oscillator" };

export function categoryName(category: ModuleCategory): string {
  return CATEGORY_NAMES[category];
}
