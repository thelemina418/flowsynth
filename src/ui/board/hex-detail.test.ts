// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { advance } from "../../engine/advance";
import { apply } from "../../engine/apply";
import { giveHabit, giveOscillators } from "../../engine/fixtures";
import { createInitialState } from "../../engine/state";
import type { GameState } from "../../engine/types";
import { memorySaveStorage } from "../shared-save";
import { App } from "../shell/App";
import { Shell } from "../shell/shell";

// The Hex detail on screen (issue #27): a fixed panel, empty until the
// first click, filled by clicking, keyboard or touch on a cell, dismissed
// by Escape or a tap away. In flow a click only inspects.

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

function acceptanceLayout(): GameState {
  let s = createInitialState();
  giveOscillators(s, { allowance: 3 });
  giveHabit(s, "Piano", "engineer");
  for (const [module, q, r] of [["sine", 0, 0], ["triangle", 1, 0], ["triangle", 0, 1]] as const) {
    s = apply(s, { type: "placeModule", module, cell: { q, r } }).state;
  }
  return s;
}

const panel = () => host.querySelector<HTMLElement>("[data-hex-detail]")!;
const lines = () => [...panel().querySelectorAll(".hex-detail-line")].map((l) => l.textContent);
const cell = (key: string) => host.querySelector<SVGGElement>(`[data-cell="${key}"]`)!;
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const press = (el: Element | Document, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });
const placed = (shell: Shell) => shell.state.value.game.board.placements.map((p) => `${p.module}@${p.cell.q},${p.cell.r}`).sort();

describe("the Hex detail panel", () => {
  it("is present but empty on a fresh start", () => {
    mount();
    expect(panel()).not.toBeNull();
    expect(panel().textContent).toBe("");
  });

  it("fills on a click, and moves to the next clicked cell", () => {
    mount();
    click(cell("-1,1"));
    expect(lines()).toEqual(["Shale · Wall"]);
    click(cell("3,0"));
    expect(lines()).toEqual(["Dark cell · beyond this arc"]);
    expect(cell("3,0").hasAttribute("data-inspected")).toBe(true);
    expect(cell("-1,1").hasAttribute("data-inspected")).toBe(false);
  });

  it("opens from the keyboard on a focused cell and closes on Escape", () => {
    mount();
    expect(cell("2,-1").getAttribute("tabindex")).toBe("0");
    press(cell("2,-1"), "Enter");
    expect(lines()).toEqual(["Flint · Wall · opens Roadie"]);
    press(document, "Escape");
    expect(panel().textContent).toBe("");
  });

  it("closes on a tap away, but not on a tap inside it", () => {
    mount();
    click(cell("0,0"));
    expect(lines()).toEqual(["Open cell"]);
    click(panel());
    expect(lines()).toEqual(["Open cell"]);
    click(document.body);
    expect(panel().textContent).toBe("");
  });

  it("reads a placed module while still picking it up in upgrade mode", () => {
    const shell = mount();
    act(() => {
      shell.state.value = acceptanceLayout();
    });
    click(cell("1,0"));
    expect(lines()).toEqual(["Triangle · Oscillator", "Resonating ×1 · closes Sine–Triangle", "1.0 ν/s base · ×1.75 resonance", "1.75 ν/s"]);
    expect(cell("1,0").hasAttribute("data-picked")).toBe(true);
    // Placing it reads the cell it lands on.
    click(cell("1,-1"));
    expect(placed(shell)).toEqual(["sine@0,0", "triangle@0,1", "triangle@1,-1"]);
    expect(lines()[0]).toBe("Triangle · Oscillator");
    expect(cell("1,-1").hasAttribute("data-inspected")).toBe(true);
  });

  it("in flow, only inspects: a click and a key move nothing", () => {
    const shell = mount();
    act(() => {
      shell.state.value = apply(acceptanceLayout(), { type: "startSession", target: null, now: 5_000_000_000_000 }).state;
    });
    click(cell("1,0"));
    expect(lines()[3]).toBe("1.75 ν/s");
    click(cell("1,-1"));
    press(cell("0,0"), "Enter");
    expect(lines()[0]).toBe("Sine · Oscillator");
    expect(host.querySelector("[data-picked]")).toBeNull();
    expect(placed(shell)).toEqual(["sine@0,0", "triangle@0,1", "triangle@1,0"]);
  });

  it("follows the state as it changes in flow", () => {
    const shell = mount();
    let s = apply(acceptanceLayout(), { type: "startSession", target: null, now: 5_000_000_000_000 }).state;
    act(() => {
      shell.state.value = s;
    });
    click(cell("1,0"));
    expect(lines()[3]).toBe("1.75 ν/s");
    s = advance(s, 60, "flow").state;
    act(() => {
      shell.state.value = s;
    });
    expect(lines()[3]).toBe("1.75 ν/s");
    // The state changes under the open panel (here a new layout between
    // sessions; later chunks' charge and pressure arrive the same way):
    // the readout follows the new rates without another click.
    s = apply(s, { type: "endSession", now: 5_000_000_060_000 }).state;
    s = apply(s, { type: "removeModule", cell: { q: 0, r: 1 } }).state;
    s = apply(s, { type: "startSession", target: null, now: 5_000_000_100_000 }).state;
    act(() => {
      shell.state.value = s;
    });
    expect(s.game.mode).toBe("flow");
    expect(lines()).toEqual(["Triangle · Oscillator", "Not resonating · needs two touching oscillators beside it", "1.0 ν/s"]);
  });
});
