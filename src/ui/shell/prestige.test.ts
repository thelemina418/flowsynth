// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { applyIn, begin, fresh, giveOscillators, openRoadie, ownCells } from "../../engine/fixtures";
import { BASALT_CELLS, FLINT_CELL, SCHIST_CELL, SHALE_CELL } from "../../engine/map";
import { D } from "../../engine/num";
import { cloneState } from "../../engine/state";
import type { GameState } from "../../engine/types";
import { memorySaveStorage, type SaveStorage } from "../shared-save";
import { App } from "./App";
import { Shell } from "./shell";

// Prestige (spec chunk 06, issue #62): the Goal line reading `Prestige`
// opens a small confirmation (Resets, Keeps, the Arete to gain, Cancel
// and Prestige; Esc cancels). Confirming ends the era; from then on an
// `Arete N` readout sits beside ν and never hides.

let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
});

function mount(state?: GameState, storage: SaveStorage = memorySaveStorage()): Shell {
  const shell = new Shell(storage, () => 5_000_000_000_000);
  shell.boot();
  host = document.createElement("main");
  document.body.append(host);
  act(() => render(h(App, { shell }), host));
  if (state) act(() => void (shell.state.value = state));
  return shell;
}

// Every Sketch entry before Prestige done, three Sines placed, a Sine
// channel level bought, and the era's ν at 9.5e6 (3 Arete).
function readyToPrestige(): GameState {
  const s = fresh();
  openRoadie(s);
  ownCells(s, [SHALE_CELL, BASALT_CELLS[0]!, FLINT_CELL, SCHIST_CELL]);
  giveOscillators(s, { allowance: 3 });
  for (const cell of [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }]) applyIn(s, { type: "placeModule", module: "sine", cell });
  s.game.nous = D(100);
  s.game.eraNous = D(9.5e6);
  applyIn(s, { type: "buyFader", fader: { kind: "channel", type: "sine" } });
  return s;
}

const goal = () => host.querySelector<HTMLElement>("[data-goal]");
const dialog = () => host.querySelector<HTMLElement>("[data-prestige-confirm]");
const arete = () => host.querySelector<HTMLElement>("[data-arete]");
const button = (label: string) => [...dialog()!.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (el: HTMLElement) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const key = (k: string) => act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
const board = () => host.querySelector("svg.board")!.outerHTML;

describe("the Prestige Goal", () => {
  it("is a button that opens the confirmation; another Goal is plain text", () => {
    mount(fresh());
    expect(goal()!.textContent).toBe("Conquer Shale");
    expect(goal()!.tagName).toBe("P");
    render(null, host);
    host.remove();
    mount(readyToPrestige());
    expect(goal()!.tagName).toBe("BUTTON");
    expect(goal()!.textContent).toBe("Prestige");
    expect(dialog()).toBeNull();
    click(goal()!);
    expect(dialog()).not.toBeNull();
  });
});

describe("the confirmation", () => {
  it("lists Resets and Keeps in the spec's words, the Arete to gain, Cancel and Prestige", () => {
    mount(readyToPrestige());
    click(goal()!);
    // A visible title, as the spec's block has it.
    const title = dialog()!.querySelector("h2")!;
    expect(title.textContent).toBe("Prestige");
    expect(title.classList.contains("sr-only")).toBe(false);
    expect(dialog()!.getAttribute("aria-labelledby")).toBe(title.id);
    // Each list is its label, then the list itself, with no `·` between.
    const lists = [...dialog()!.querySelectorAll("[data-list]")].map((l) => [...l.children].map((c) => c.textContent));
    expect(lists).toEqual([
      ["Resets", "ν · fader levels"],
      ["Keeps", "board · cables · classes · allowance · Arete · walls conquered"],
    ]);
    expect(dialog()!.querySelector("[data-gain]")!.textContent).toBe("Arete +3");
    expect([...dialog()!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Cancel", "Prestige"]);
  });

  it("closes on Cancel or Esc with the state untouched", () => {
    const shell = mount(readyToPrestige());
    const before = cloneState(shell.state.value);
    click(goal()!);
    click(button("Cancel"));
    expect(dialog()).toBeNull();
    expect(shell.state.value).toEqual(before);
    click(goal()!);
    key("Escape");
    expect(dialog()).toBeNull();
    expect(shell.state.value).toEqual(before);
  });

  it("shows and banks the Arete the state is worth when it confirms, not when it opened", () => {
    const shell = mount(readyToPrestige());
    click(goal()!);
    act(() => {
      const next = cloneState(shell.state.value);
      next.game.eraNous = D(16e6);
      shell.state.value = next;
    });
    expect(dialog()!.textContent).toContain("Arete +4");
    click(button("Prestige"));
    expect(shell.state.value.game.arete.toNumber()).toBe(4);
  });
});

describe("confirming a prestige", () => {
  it("ends the era: the board identical, ν 0, every fader at 0, the Goal no longer Prestige, Arete beside ν", () => {
    const shell = mount(readyToPrestige());
    expect(arete()).toBeNull();
    const drawn = board();
    click(goal()!);
    click(button("Prestige"));
    expect(dialog()).toBeNull();
    expect(shell.state.value.game.prestiges).toBe(1);
    expect(board()).toBe(drawn);
    expect(host.querySelector(".nous-readout")!.textContent).toBe("ν 0");
    expect(arete()!.textContent).toBe("Arete 3");
    expect(goal()).toBeNull();
    const readouts = [...host.querySelectorAll("[data-console] .fader-readout")].map((r) => r.textContent);
    expect(readouts.length).toBeGreaterThan(0);
    for (const readout of readouts) expect(readout).toMatch(/ · 0 · /);
  });

  it("leaves the Arete readout after a reload, at 0 Arete balance too, and on the flow screen", () => {
    const storage = memorySaveStorage();
    mount(readyToPrestige(), storage);
    click(goal()!);
    click(button("Prestige"));
    render(null, host);
    host.remove();
    const shell = mount(undefined, storage);
    expect(arete()!.textContent).toBe("Arete 3");
    act(() => {
      const next = cloneState(shell.state.value);
      next.game.arete = D(0);
      shell.state.value = next;
    });
    expect(arete()!.textContent).toBe("Arete 0");
    act(() => {
      const next = cloneState(shell.state.value);
      begin(next, 1_500, 0);
      shell.state.value = next;
    });
    expect(host.querySelector(".flow-screen")).not.toBeNull();
    expect(arete()!.textContent).toBe("Arete 0");
  });
});
