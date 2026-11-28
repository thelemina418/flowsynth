// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { apply } from "../../engine/apply";
import { openRoadie } from "../../engine/fixtures";
import { createInitialState } from "../../engine/state";
import type { GameState } from "../../engine/types";
import { memorySaveStorage } from "../shared-save";
import { App } from "../shell/App";
import { Shell } from "../shell/shell";

// Arms on screen (issue #53): once Roadie opens, the tray's `Arms <n>`
// group follows the cables entry; a Blade wears the Arm category with its
// glyph and a facing pointer, turns like a Flywheel, and its Hex detail
// reads its facing, the charge it receives and the damage it deals.

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

const groups = () => [...host.querySelectorAll<HTMLElement>(".tray [data-group]")].map((g) => g.getAttribute("data-group"));
const chip = (category: string) => host.querySelector<HTMLElement>(`.tray [data-chip="${category}"]`);
const entry = (name: string) => [...host.querySelectorAll<HTMLButtonElement>(".tray button[data-module]")].find((b) => b.textContent === name)!;
const cell = (key: string) => host.querySelector<SVGGElement>(`[data-cell="${key}"]`)!;
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const press = (k: string, shiftKey = false) => act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true })); });
const lines = () => [...host.querySelectorAll(".hex-detail-line")].map((l) => l.textContent);
const facing = (key: string) => cell(key).querySelector("[data-facing]")?.getAttribute("data-facing");

// A completed session behind the player, and Roadie open.
function roadie(): GameState {
  const s = createInitialState();
  s.records.sessionsCompleted = 1;
  openRoadie(s);
  return s;
}

// A Blade at the centre turned to NW (Basalt (−1,0)), fed by a Flywheel on
// (0,1) at 1.4 charge/s (4 credited Producer hours) through a Patch.
function fedBlade(turns = 4): GameState {
  let s = roadie();
  s.records.classCredit.producer = 4 * 3600;
  s = apply(s, { type: "placeModule", module: "blade", cell: { q: 0, r: 0 } }).state;
  for (let i = 0; i < turns; i++) s = apply(s, { type: "rotateModule", cell: { q: 0, r: 0 }, turn: "clockwise" }).state;
  s = apply(s, { type: "placeModule", module: "flywheel", cell: { q: 0, r: 1 } }).state;
  return apply(s, { type: "patchCable", cable: "patch", source: { q: 0, r: 1 }, target: { q: 0, r: 0 } }).state;
}

describe("the Arms tray group", () => {
  it("is absent before Roadie opens", () => {
    const s = createInitialState();
    s.records.sessionsCompleted = 1;
    mount(s);
    expect(groups()).toEqual(["oscillator", "modulator", "cable"]);
    expect(chip("arm")).toBeNull();
  });

  it("reads Arms 1 after the cables entry once Roadie opens, with the Blade", () => {
    mount(roadie());
    expect(groups()).toEqual(["oscillator", "modulator", "cable", "arm"]);
    expect(chip("arm")!.textContent).toBe("Arms 1");
    expect(entry("Blade").querySelector('svg[data-glyph="blade"]')).not.toBeNull();
  });
});

describe("the Blade's face", () => {
  it("wears the Arm category, its glyph and nameplate, and a pointer toward NE, with no jack", () => {
    mount(roadie());
    click(entry("Blade"));
    click(cell("0,0"));
    const face = cell("0,0").querySelector('[data-module="blade"]')!;
    expect(face.getAttribute("data-category")).toBe("arm");
    expect(face.querySelector('[data-glyph="blade"]')).not.toBeNull();
    expect(face.textContent).toBe("Blade");
    expect(facing("0,0")).toBe("NE");
    expect(face.querySelector("[data-jack]")).toBeNull();
    expect(chip("arm")!.textContent).toBe("Arms 0");
  });

  it("turns on a click on the picked Blade, and with R and Shift+R", () => {
    mount(roadie());
    click(entry("Blade"));
    click(cell("0,0"));
    click(cell("0,0"));
    click(cell("0,0"));
    expect(facing("0,0")).toBe("SE");
    press("r");
    expect(facing("0,0")).toBe("S");
    press("R", true);
    press("R", true);
    press("R", true);
    expect(facing("0,0")).toBe("N");
  });
});

describe("the Blade's Hex detail", () => {
  it("names its facing, the charge it receives, and the damage it deals to the wall it faces", () => {
    mount(fedBlade());
    click(cell("0,0"));
    expect(lines()).toEqual(["Blade · Arm · facing NW", "1.4 charge/s received", "14.0/s to Basalt"]);
  });

  it("facing an open cell, reads No wall in reach", () => {
    mount(fedBlade(0));
    click(cell("0,0"));
    expect(lines()).toEqual(["Blade · Arm · facing NE", "1.4 charge/s received", "No wall in reach"]);
  });
});
