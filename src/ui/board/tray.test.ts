// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { apply } from "../../engine/apply";
import { giveOscillators } from "../../engine/fixtures";
import { createInitialState } from "../../engine/state";
import type { GameState } from "../../engine/types";
import { memorySaveStorage } from "../shared-save";
import { App } from "../shell/App";
import { Shell } from "../shell/shell";

// The tray's allowance chips (spec chunk 04, issue #38): each category
// group is headed by its unplaced allowance, muted at 0, once a session
// has completed. The cable entry's count is the cables' chip. Arrived
// types appear as entries.

let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
});

function mount(state?: GameState): Shell {
  const shell = new Shell(memorySaveStorage(), () => 5_000_000_000_000);
  shell.boot();
  host = document.createElement("main");
  document.body.append(host);
  act(() => render(h(App, { shell }), host));
  if (state) act(() => { shell.state.value = state; });
  return shell;
}

// A completed session behind the player, and Engineer credit for `grant`.
function practised(grant: Parameters<typeof giveOscillators>[1] = {}): GameState {
  const s = createInitialState();
  s.records.sessionsCompleted = 1;
  giveOscillators(s, grant);
  return s;
}

const chips = () => [...host.querySelectorAll<HTMLElement>(".tray [data-chip]")];
const chip = (category: string) => host.querySelector<HTMLElement>(`.tray [data-chip="${category}"]`);
const entries = () => [...host.querySelectorAll<HTMLButtonElement>(".tray button[data-module]")].map((b) => b.textContent);

describe("the allowance chips", () => {
  it("show nowhere on a fresh start", () => {
    mount();
    expect(chips()).toEqual([]);
    expect(entries()).toEqual(["Sine", "Triangle", "Flywheel"]);
  });

  it("head each group with its unplaced allowance once a session has completed: Engineer Lv 1 with 2 placed reads Oscillators 1", () => {
    let s = practised({ allowance: 3 });
    s = apply(s, { type: "placeModule", module: "sine", cell: { q: 0, r: 0 } }).state;
    s = apply(s, { type: "placeModule", module: "triangle", cell: { q: 1, r: 0 } }).state;
    mount(s);
    expect(chips().map((c) => c.textContent)).toEqual(["Oscillators 1", "Modulators 1"]);
    expect(chip("oscillator")!.hasAttribute("data-muted")).toBe(false);
  });

  it("render muted at 0, never removed", () => {
    let s = practised();
    s = apply(s, { type: "placeModule", module: "flywheel", cell: { q: 0, r: 0 } }).state;
    mount(s);
    expect(chip("modulator")!.textContent).toBe("Modulators 0");
    expect(chip("modulator")!.hasAttribute("data-muted")).toBe(true);
  });

  it("group each category's entries under its chip, and the cable entry's count is its chip", () => {
    mount(practised());
    const groups = [...host.querySelectorAll<HTMLElement>(".tray [data-group]")];
    expect(groups.map((g) => g.getAttribute("data-group"))).toEqual(["oscillator", "modulator", "cable"]);
    expect([...groups[0]!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Sine", "Triangle"]);
    expect([...groups[1]!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Flywheel"]);
    expect([...groups[2]!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["1 Patch cable"]);
  });
});

describe("arrived types in the tray", () => {
  it("Square appears at Engineer Lv 2", () => {
    const shell = mount(practised({ allowance: 3 }));
    expect(entries()).not.toContain("Square");
    act(() => { shell.state.value = practised({ arrive: ["square"] }); });
    expect(entries()).toEqual(["Sine", "Triangle", "Square", "Flywheel"]);
  });
});
