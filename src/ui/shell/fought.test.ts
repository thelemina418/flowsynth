// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { applyIn, begin, fresh, giveHabit, giveProducer } from "../../engine/fixtures";
import type { Cell } from "../../engine/hex";
import { serialize, STORAGE_KEY } from "../../engine/save";
import type { GameState, ModuleType } from "../../engine/types";
import { memorySaveStorage, type SaveStorage } from "../shared-save";
import { App } from "./App";
import { Shell } from "./shell";

// The fought wall on the flow screen (spec chunk 05, issue #50): the HP
// row `<Wall> ▕bar▏ <hp> / <full> HP` left of `Ready · N`, for the wall
// being fought. Among walls losing HP, the one that falls soonest; if none
// is losing, the one taking the most damage; ties in authored order.
const T0 = 5_000_000_000_000;
let t = T0;
let host: HTMLElement;
let mounted: HTMLElement[] = [];

afterEach(() => {
  for (const el of mounted) {
    render(null, el);
    el.remove();
  }
  mounted = [];
  t = T0;
});

const O = { q: 0, r: 0 };
const E = { q: 1, r: 0 };
const SE = { q: 0, r: 1 };
const NE = { q: 1, r: -1 };
const SHALE = { q: -1, r: 1 };
const BASALT = { q: 0, r: -1 };
// Plain Flints (regen 10/s, so no Flywheel wins), in authored order:
// (−1,−1), then (2,0), then (0,2).
const FLINT_NW = { q: -1, r: -1 };
const FLINT_E = { q: 2, r: 0 };
const FLINT_S = { q: 0, r: 2 };

function must(s: GameState, action: Parameters<typeof applyIn>[1]): void {
  const done = applyIn(s, action);
  if (!done.ok) throw new Error(`fixture ${action.type} failed: ${done.reason}`);
}

function place(s: GameState, module: ModuleType, cell: Cell): void {
  must(s, { type: "placeModule", module, cell });
}

function patch(s: GameState, source: Cell, target: Cell): void {
  must(s, { type: "patchCable", cable: "patch", source, target });
}

// Flywheels at the given cells (Producer Lv 2: 1.15 charge/s each), each
// patched into its wall, and an Engineer session running from T0.
function fighting(pairs: [Cell, Cell][]): GameState {
  const s = fresh();
  if (pairs.length > 0) giveProducer(s, { modulators: pairs.length, cables: pairs.length });
  for (const [source, target] of pairs) {
    place(s, "flywheel", source);
    patch(s, source, target);
  }
  giveHabit(s, "Piano", "engineer");
  begin(s, null, T0);
  return s;
}

function mount(state: GameState): Shell {
  const storage: SaveStorage = memorySaveStorage();
  storage.setItem(STORAGE_KEY, serialize(state, T0));
  const shell = new Shell(storage, () => t);
  shell.boot();
  host = document.createElement("main");
  document.body.append(host);
  mounted.push(host);
  act(() => render(h(App, { shell }), host));
  expect(shell.screen.value.kind).toBe("flow");
  return shell;
}

function tick(shell: Shell, seconds: number): void {
  t += seconds * 1000;
  act(() => shell.boundary("visible"));
}

// fmt groups thousands with a thin space; read it as a space.
function hpRow(): string | null {
  const row = host.querySelector("[data-hp-row]");
  return row === null ? null : (row.textContent ?? "").replace(/\s/g, " ");
}

// The fought wall's cell, which the row carries: two Flints read alike.
function foughtCell(): Cell | null {
  const wall = host.querySelector("[data-hp-row]")?.getAttribute("data-cell");
  if (!wall) return null;
  const [q, r] = wall.split(",").map(Number);
  return { q: q!, r: r! };
}

describe("the flow screen's HP row", () => {
  it("shows the wall that falls soonest, matching the sketch, left of Ready · N", () => {
    // Equal damage on Shale and Basalt: Shale falls first (600 HP), though
    // Basalt comes first in authored order.
    mount(fighting([[SE, SHALE], [O, BASALT]]));
    expect(hpRow()).toBe("Shale ▕██████████▏ 600 / 600 HP");
    const row = host.querySelector("[data-hp-row]")!;
    const ready = host.querySelector("[data-ready]")!;
    expect(row.parentElement).toBe(ready.parentElement);
    expect(row.nextElementSibling).toBe(ready);
  });

  it("with no wall losing HP, shows the wall taking the most damage, though it comes later in authored order", () => {
    mount(fighting([[E, FLINT_E], [NE, FLINT_E], [O, FLINT_NW]]));
    expect(hpRow()).toBe("Flint ▕██████████▏ 60 000 / 60 000 HP");
    expect(foughtCell()).toEqual(FLINT_E);
  });

  it("breaks a tie in authored order", () => {
    mount(fighting([[SE, FLINT_S], [E, FLINT_E]]));
    expect(foughtCell()).toEqual(FLINT_E);
  });

  it("is absent with no wall taking damage, leaving Ready · N alone", () => {
    mount(fighting([]));
    expect(hpRow()).toBeNull();
    expect(host.querySelector("[data-ready]")!.textContent).toMatch(/^Ready · \d+$/);
  });

  it("updates at each boundary, and moves to the next wall when the fought one falls, with no prompt", () => {
    const shell = mount(fighting([[SE, SHALE], [O, BASALT]]));
    const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent);
    const before = buttons();
    tick(shell, 300);
    // 600 − 1.05 × 300.
    expect(hpRow()).toBe("Shale ▕█████░░░░░▏ 285 / 600 HP");
    tick(shell, 300);
    // Shale fell at 571 s; Basalt has lost 0.15 × 600.
    expect(hpRow()).toBe("Basalt ▕██████████▏ 5 910 / 6 000 HP");
    expect(shell.screen.value.kind).toBe("flow");
    expect(buttons()).toEqual(before);
  });
});

// fmt groups thousands with a thin space; read it as a space.
function summaryLine(): string {
  return (host.querySelector("[data-summary-line]")?.textContent ?? "").replace(/\s/g, " ");
}

function end(): void {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent === "End")!;
  act(() => found.click());
}

describe("the summary line's walls", () => {
  it("reads `· Shale −<n> HP` for a damaged Shale still standing", () => {
    const shell = mount(fighting([[SE, SHALE], [O, BASALT]]));
    tick(shell, 300);
    end();
    // Shale lost 1.05 × 300; Basalt lost HP too, but wasn't the fought wall.
    expect(summaryLine()).toMatch(/^\+.+ ν · Engineer \+5 min · Shale −315 HP$/);
  });

  it("reads `· Shale conquered` for a conquered Shale, then the next fought wall's loss", () => {
    const shell = mount(fighting([[SE, SHALE], [O, BASALT]]));
    tick(shell, 600);
    end();
    expect(summaryLine()).toMatch(/^\+.+ ν · Engineer \+10 min · Shale conquered · Basalt −90 HP$/);
  });

  it("adds nothing for a session that fought no wall", () => {
    const shell = mount(fighting([]));
    tick(shell, 300);
    end();
    expect(summaryLine()).toMatch(/^\+.+ ν · Engineer \+5 min$/);
  });
});
