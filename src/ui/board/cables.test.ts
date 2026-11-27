// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { apply, type Action } from "../../engine/apply";
import { ownCells } from "../../engine/fixtures";
import { cellsWithin } from "../../engine/hex";
import { createInitialState } from "../../engine/state";
import type { GameState } from "../../engine/types";
import { memorySaveStorage } from "../shared-save";
import { App } from "../shell/App";
import { Shell } from "../shell/shell";

// Patch cables on screen (spec chunk 03, issue #33): the tray's cable
// entry, the three-click patch, the would-be cord and its muted state, a
// placed cord's plug, beads in flow, and Escape. Every route ends in the
// shell's one `apply` path.

let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
});

function mount(): Shell {
  const shell = new Shell(memorySaveStorage(), () => 5_000_000_000_000);
  shell.boot();
  host = document.createElement("main");
  document.body.append(host);
  act(() => render(h(App, { shell }), host));
  return shell;
}

function show(shell: Shell, s: GameState) {
  act(() => { shell.state.value = s; });
}

function laid(actions: Action[], setup: (s: GameState) => void = () => {}): GameState {
  let s = createInitialState();
  setup(s);
  for (const action of actions) {
    const done = apply(s, action);
    if (!done.ok) throw new Error(`fixture ${action.type} failed: ${done.reason}`);
    s = done.state;
  }
  return s;
}

const tray = () => [...host.querySelectorAll<HTMLButtonElement>(".tray button")];
const cableEntry = () => host.querySelector<HTMLButtonElement>('.tray button[data-cable="patch"]')!;
const cell = (key: string) => host.querySelector<SVGGElement>(`[data-cell="${key}"]`)!;
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const hover = (el: Element) => act(() => { el.dispatchEvent(new PointerEvent("pointermove", { bubbles: true })); });
const press = (k: string) => act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });
const cords = () => [...host.querySelectorAll(".cord:not([data-would-be])")];
const wouldBe = () => host.querySelector(".cord[data-would-be]");
const note = () => host.querySelector(".board-note")?.textContent ?? null;

// A Flywheel on the centre and a Triangle south of it.
const PAIR: Action[] = [
  { type: "placeModule", module: "flywheel", cell: { q: 0, r: 0 } },
  { type: "placeModule", module: "triangle", cell: { q: 0, r: 1 } },
];

describe("the cable entry", () => {
  it("reads the unused cable allowance, and mutes once it is spent", () => {
    const shell = mount();
    expect(tray().map((b) => b.textContent)).toEqual(["Sine", "Triangle", "Flywheel", "1 Patch cable"]);
    show(shell, laid([...PAIR, { type: "patchCable", cable: "patch", source: { q: 0, r: 0 }, target: { q: 0, r: 1 } }]));
    expect(cableEntry().textContent).toBe("0 Patch cables");
    expect(cableEntry().disabled).toBe(true);
  });
});

describe("patching in three clicks", () => {
  it("picks the cable, plugs the Flywheel's jack and patches the target, drawing a cord", () => {
    const shell = mount();
    show(shell, laid(PAIR));
    click(cableEntry());
    expect(cableEntry().getAttribute("aria-pressed")).toBe("true");
    // Only a modulator's jack takes the cable.
    expect(cell("0,0").getAttribute("data-target")).toBe("valid");
    expect(cell("0,1").getAttribute("data-target")).toBe("invalid");
    click(cell("0,0"));
    expect(cell("0,0").hasAttribute("data-picked")).toBe(true);
    expect(cell("0,1").getAttribute("data-target")).toBe("valid");
    expect(cell("0,0").getAttribute("data-target")).toBe("invalid");
    // The would-be cord runs to the pointer's cell, clear over a valid target.
    hover(cell("0,1"));
    expect(wouldBe()).not.toBeNull();
    expect(wouldBe()!.hasAttribute("data-muted")).toBe(false);
    click(cell("0,1"));
    expect(shell.state.value.game.board.cables).toEqual([{ type: "patch", source: { q: 0, r: 0 }, target: { q: 0, r: 1 } }]);
    expect(wouldBe()).toBeNull();
    expect(cords()).toHaveLength(1);
    expect(cords()[0]!.getAttribute("data-category")).toBe("modulator");
    expect(host.querySelector('[data-plug="0,0"]')).not.toBeNull();
    expect(host.querySelector("[data-target]")).toBeNull();
    // The Hex detail names the Patch.
    click(cell("0,0"));
    expect([...host.querySelectorAll(".hex-detail-line")].map((l) => l.textContent)).toEqual([
      "Flywheel · Modulator · facing NE",
      "1.0 charge/s · patched → Triangle",
    ]);
  });

  it("draws the would-be cord muted over a crossing target, and refuses it with one quiet line", () => {
    const shell = mount();
    show(shell, laid(
      [
        { type: "placeModule", module: "flywheel", cell: { q: -1, r: 0 } },
        { type: "placeModule", module: "flywheel", cell: { q: 1, r: -1 } },
        { type: "patchCable", cable: "patch", source: { q: -1, r: 0 }, target: { q: 1, r: 0 } },
      ],
      (s) => {
        ownCells(s, cellsWithin(2));
        s.game.allowance.modulator = 2;
        s.game.cableAllowance = 2;
      },
    ));
    click(cableEntry());
    click(cell("1,-1"));
    expect(cell("-1,1").getAttribute("data-target")).toBe("invalid");
    hover(cell("-1,1"));
    expect(wouldBe()!.hasAttribute("data-muted")).toBe(true);
    hover(cell("2,-1"));
    expect(wouldBe()!.hasAttribute("data-muted")).toBe(false);
    click(cell("-1,1"));
    expect(note()).toBe("That cable would cross another.");
    expect(shell.state.value.game.board.cables).toHaveLength(1);
  });

  it("Escape cancels at any click, and leaves the board as it was", () => {
    const shell = mount();
    show(shell, laid(PAIR));
    click(cableEntry());
    press("Escape");
    expect(cableEntry().getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelector("[data-target]")).toBeNull();
    click(cableEntry());
    click(cell("0,0"));
    hover(cell("0,1"));
    press("Escape");
    expect(wouldBe()).toBeNull();
    expect(host.querySelector("[data-target]")).toBeNull();
    expect(shell.state.value.game.board.cables).toEqual([]);
  });
});

describe("a placed cable's plug", () => {
  const PATCHED: Action[] = [...PAIR, { type: "patchCable", cable: "patch", source: { q: 0, r: 0 }, target: { q: 0, r: 1 } }];

  it("re-aims the cable at a new target", () => {
    const shell = mount();
    show(shell, laid(PATCHED));
    click(host.querySelector('[data-plug="0,0"]')!);
    expect(cell("1,0").getAttribute("data-target")).toBe("valid");
    click(cell("1,0"));
    expect(shell.state.value.game.board.cables).toEqual([{ type: "patch", source: { q: 0, r: 0 }, target: { q: 1, r: 0 } }]);
  });

  it("unplugs the cable on a click on the tray", () => {
    const shell = mount();
    show(shell, laid(PATCHED));
    click(host.querySelector('[data-plug="0,0"]')!);
    expect(cableEntry().disabled).toBe(false);
    click(cableEntry());
    expect(shell.state.value.game.board.cables).toEqual([]);
    expect(cableEntry().textContent).toBe("1 Patch cable");
    expect(cords()).toHaveLength(0);
  });

  it("has a hit target at least 44px across on the desktop board, live only in upgrade mode", () => {
    const shell = mount();
    const s = laid(PATCHED);
    show(shell, s);
    // Beside the tray the desktop board is about 460px wide for a 518-unit
    // viewBox: 50 units make 44px.
    const hit = host.querySelector('[data-plug="0,0"] .plug-hit')!;
    expect(Number(hit.getAttribute("r")) * 2).toBeGreaterThanOrEqual(50);
    expect(host.querySelector("[data-plug]")!.hasAttribute("data-live")).toBe(true);
    show(shell, { ...s, game: { ...s.game, mode: "flow" } });
    expect(host.querySelector("[data-plug]")!.hasAttribute("data-live")).toBe(false);
  });

  // happy-dom draws nothing, so the hit area is read from its geometry: a
  // circle clipped by everything but a disc on the target cell's centre.
  // A browser hit-tests the clipped circle, so a click inside that disc
  // falls through to the cell.
  it("leaves the target cell's centre to the cell, so a centre click inspects and picks it", () => {
    const shell = mount();
    show(shell, laid(PATCHED));
    const hit = host.querySelector('[data-plug="0,0"] .plug-hit')!;
    const clipId = /^url\(#(.+)\)$/.exec(hit.getAttribute("clip-path") ?? "")?.[1];
    expect(clipId).toBeDefined();
    const clip = host.querySelector(`clipPath[id="${clipId}"] path`)!;
    expect(clip.getAttribute("clip-rule")).toBe("evenodd");
    // The hole: the clip's second subpath, a circle drawn as two arcs from
    // its rightmost point.
    const hole = /M\s*[-\d.]+\s+[-\d.]+\s*[^M]*Z\s*M\s*([-\d.]+)\s+([-\d.]+)\s*A\s*([-\d.]+)/.exec(clip.getAttribute("d")!)!;
    const r = Number(hole[3]);
    const centre = { x: Number(hole[1]) - r, y: Number(hole[2]) };
    // The target (0,1) is drawn at (0, 30√3) for the board's 30-unit hexes.
    const target = { x: 0, y: 30 * Math.sqrt(3) };
    expect(Math.hypot(centre.x - target.x, centre.y - target.y)).toBeLessThan(0.01);
    // A centre disc at least 20px across (23 units).
    expect(r * 2).toBeGreaterThanOrEqual(23);
    const plug = host.querySelector('[data-plug="0,0"] .plug-body')!;
    const plugAt = { x: Number(plug.getAttribute("cx")), y: Number(plug.getAttribute("cy")) };
    expect(Math.hypot(plugAt.x - target.x, plugAt.y - target.y)).toBeGreaterThan(r + 3.2);
    expect(Number(hit.getAttribute("r")) * 2).toBeGreaterThanOrEqual(50);
    // The click that reaches the target cell inspects it and picks its module.
    click(cell("0,1"));
    expect(host.querySelector('[data-cell="0,1"]')!.hasAttribute("data-inspected")).toBe(true);
    expect(cell("0,1").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("beads", () => {
  const PATCHED: Action[] = [...PAIR, { type: "patchCable", cable: "patch", source: { q: 0, r: 0 }, target: { q: 0, r: 1 } }];

  it("travel the cords only in flow", () => {
    const shell = mount();
    const s = laid(PATCHED);
    show(shell, s);
    expect(host.querySelectorAll(".bead")).toHaveLength(0);
    show(shell, { ...s, game: { ...s.game, mode: "flow" } });
    expect(host.querySelectorAll(".bead").length).toBeGreaterThan(0);
    expect(host.querySelector(".bead animateMotion")).not.toBeNull();
    show(shell, { ...s, game: { ...s.game, mode: "paused" } });
    expect(host.querySelectorAll(".bead")).toHaveLength(0);
  });
});
