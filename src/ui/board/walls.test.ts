// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { apply, type Action } from "../../engine/apply";
import { createInitialState } from "../../engine/state";
import type { GameState } from "../../engine/types";
import { memorySaveStorage } from "../shared-save";
import { App } from "../shell/App";
import { Shell } from "../shell/shell";

// Patching into walls on screen (spec chunk 03, issue #34): walls in range
// carry the clear target outline during a patch, the cord runs to the
// wall, and the Hex detail reads the wall's damage and regen.

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

const cableEntry = () => host.querySelector<HTMLButtonElement>('.tray button[data-cable="patch"]')!;
const cell = (key: string) => host.querySelector<SVGGElement>(`[data-cell="${key}"]`)!;
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const cords = () => [...host.querySelectorAll(".cord:not([data-would-be])")];
const lines = () => [...host.querySelectorAll(".hex-detail-line")].map((l) => l.textContent);

const FLYWHEEL: Action = { type: "placeModule", module: "flywheel", cell: { q: 0, r: 0 } };

describe("patching into a wall", () => {
  it("outlines walls in range clear, draws a cord to Shale, and reads the wall's damage and regen", () => {
    const shell = mount();
    show(shell, laid([FLYWHEEL]));
    click(cableEntry());
    click(cell("0,0"));
    // Walls within 3 are targets; dark cells stay refused.
    expect(cell("-1,1").getAttribute("data-target")).toBe("valid");
    expect(cell("2,-1").getAttribute("data-target")).toBe("valid");
    expect(cell("0,-3").getAttribute("data-target")).toBe("invalid");
    expect(host.querySelector('.cell-target[data-for="-1,1"]')!.getAttribute("data-target")).toBe("valid");
    click(cell("-1,1"));
    expect(shell.state.value.game.board.cables).toEqual([{ type: "patch", source: { q: 0, r: 0 }, target: { q: -1, r: 1 } }]);
    expect(cords()).toHaveLength(1);
    click(cell("-1,1"));
    expect(lines()).toEqual(["Shale · Wall", "Taking 1.0/s · regen 0.1/s"]);
    click(cell("0,0"));
    expect(lines()).toEqual(["Flywheel · Modulator · facing NE", "1.0 charge/s · patched → Shale"]);
  });

  it("a patched placeholder wall reads its damage alone", () => {
    const shell = mount();
    show(shell, laid([FLYWHEEL, { type: "patchCable", cable: "patch", source: { q: 0, r: 0 }, target: { q: 0, r: -1 } }]));
    click(cell("0,-1"));
    expect(lines()).toEqual(["Wall", "Taking 1.0/s"]);
    click(cell("0,0"));
    expect(lines()).toEqual(["Flywheel · Modulator · facing NE", "1.0 charge/s · patched → Wall"]);
  });

  it("a patched Flint keeps its opens line, then reads its damage and regen", () => {
    const shell = mount();
    show(shell, laid([FLYWHEEL, { type: "patchCable", cable: "patch", source: { q: 0, r: 0 }, target: { q: 2, r: -1 } }]));
    click(cell("2,-1"));
    expect(lines()).toEqual(["Flint · Wall · opens Roadie", "Taking 1.0/s · regen 10.0/s"]);
  });
});
