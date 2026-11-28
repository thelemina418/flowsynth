// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { advance } from "../../engine/advance";
import { apply, type Action } from "../../engine/apply";
import { giveHabit, started } from "../../engine/fixtures";
import { D } from "../../engine/num";
import { createInitialState } from "../../engine/state";
import type { GameState } from "../../engine/types";
import { memorySaveStorage } from "../shared-save";
import { App } from "../shell/App";
import { Shell } from "../shell/shell";

// Patching into walls on screen (spec chunk 03, issue #34): walls in range
// carry the clear target outline during a patch, the cord runs to the
// wall, and the Hex detail reads the damage the wall takes. An `Only Arm
// damage` wall refuses a Patch (issue #48).

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
    // An `Only Arm damage` wall refuses a Patch (issue #48).
    expect(cell("0,-2").getAttribute("data-target")).toBe("invalid");
    expect(cell("0,-3").getAttribute("data-target")).toBe("invalid");
    expect(host.querySelector('.cell-target[data-for="-1,1"]')!.getAttribute("data-target")).toBe("valid");
    click(cell("-1,1"));
    expect(shell.state.value.game.board.cables).toEqual([{ type: "patch", source: { q: 0, r: 0 }, target: { q: -1, r: 1 } }]);
    expect(cords()).toHaveLength(1);
    click(cell("-1,1"));
    expect(lines()).toEqual(["Shale · Wall · ring 1", "600 / 600 HP · regen 0.1/s", "Pressure 5%", "Taking 1.0/s"]);
    click(cell("0,0"));
    expect(lines()).toEqual(["Flywheel · Modulator · facing NE", "1.0 charge/s · patched → Shale"]);
  });

  it("a patched Basalt names itself as the Patch's target", () => {
    const shell = mount();
    show(shell, laid([FLYWHEEL, { type: "patchCable", cable: "patch", source: { q: 0, r: 0 }, target: { q: 0, r: -1 } }]));
    click(cell("0,-1"));
    expect(lines()).toEqual(["Basalt · Wall · ring 1", "6\u2009000 / 6\u2009000 HP · regen 1.0/s", "Pressure 8%", "Taking 1.0/s"]);
    click(cell("0,0"));
    expect(lines()).toEqual(["Flywheel · Modulator · facing NE", "1.0 charge/s · patched → Basalt"]);
  });

  it("a Patch into Flint is refused on screen with `Only Arm damage.`", () => {
    const shell = mount();
    show(shell, laid([FLYWHEEL]));
    click(cableEntry());
    click(cell("0,0"));
    click(cell("0,-2"));
    expect(shell.state.value.game.board.cables).toEqual([]);
    expect(host.textContent).toContain("Only Arm damage.");
});
});

describe("a wall's HP on screen (issue #49)", () => {
  it("the Hex detail reads a fought wall's live HP and the damage it takes, and an open cell once it falls", () => {
    const shell = mount();
    let s = laid([FLYWHEEL, { type: "patchCable", cable: "patch", source: { q: 0, r: 0 }, target: { q: -1, r: 1 } }]);
    giveHabit(s, "Piano", "engineer");
    s = started(s, 0, null);
    show(shell, s);
    click(cell("-1,1"));
    expect(lines()).toEqual(["Shale · Wall · ring 1", "600 / 600 HP · regen 0.1/s", "Pressure 5%", "Taking 1.0/s"]);
    s = advance(s, 100, "flow").state;
    show(shell, s);
    expect(lines()).toEqual(["Shale · Wall · ring 1", "510 / 600 HP · regen 0.1/s", "Pressure 5%", "Taking 1.0/s"]);
    s = advance(s, 600, "flow").state;
    show(shell, s);
    click(cell("-1,1"));
    expect(lines()).toEqual(["Open cell"]);
  });

  it("a damaged wall nothing fights reads its HP and no Taking line", () => {
    const shell = mount();
    const s = laid([]);
    s.game.board.walls = [{ cell: { q: -1, r: 1 }, hp: D(412.7) }];
    show(shell, s);
    click(cell("-1,1"));
    // HP rounds up, as the HP bar does: 412.7 reads 413.
    expect(lines()).toEqual(["Shale · Wall · ring 1", "413 / 600 HP · regen 0.1/s", "Pressure 5%"]);
  });
});

