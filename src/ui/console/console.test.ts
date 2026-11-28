// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { begin, giveHabit } from "../../engine/fixtures";
import { D } from "../../engine/num";
import { createInitialState } from "../../engine/state";
import type { GameState } from "../../engine/types";
import { memorySaveStorage, type SaveStorage } from "../shared-save";
import { App } from "../shell/App";
import { Shell } from "../shell/shell";

// The console (spec chunk 06, issue #58): a strip of channel faders below
// the board, from the first time any fader is affordable. Each is a
// vertical throw with a `name · level · next cost` readout; in upgrade
// mode a click buys a level and a shift-click as many as ν affords. In
// flow it is drawn muted and buys nothing.

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

function withNous(nous: number): GameState {
  const s = createInitialState();
  s.game.nous = D(nous);
  return s;
}

const strip = () => host.querySelector<HTMLElement>("[data-console]");
const fader = (type: string) => host.querySelector<HTMLButtonElement>(`[data-console] [data-fader="${type}"]`)!;
const readouts = () => [...host.querySelectorAll<HTMLElement>("[data-console] .fader-readout")].map((r) => r.textContent);
const click = (el: HTMLElement, shiftKey = false) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey })));

describe("the console", () => {
  it("is absent on a fresh start", () => {
    mount();
    expect(strip()).toBeNull();
  });

  it("appears at 10 ν with the Sine, Triangle and Flywheel channel faders", () => {
    mount(withNous(10));
    expect(strip()).not.toBeNull();
    expect(readouts()).toEqual(["Sine · 0 · 10", "Triangle · 0 · 15", "Flywheel · 0 · 25"]);
    // Below the board.
    const board = host.querySelector("svg.board")!;
    expect(board.compareDocumentPosition(strip()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws an affordable fader with a clear outline and an unaffordable one muted, in its category's hue", () => {
    mount(withNous(10));
    expect(fader("sine").hasAttribute("data-muted")).toBe(false);
    expect(fader("triangle").hasAttribute("data-muted")).toBe(true);
    expect(fader("sine").getAttribute("data-category")).toBe("oscillator");
    expect(fader("flywheel").getAttribute("data-category")).toBe("modulator");
  });

  it("buys a level on a click, and stays after ν drops to 0 and after a reload", () => {
    const storage = memorySaveStorage();
    const shell = mount(withNous(10), storage);
    click(fader("sine"));
    expect(shell.state.value.game.nous.toNumber()).toBe(0);
    expect(readouts()[0]).toBe("Sine · 1 · 16");
    expect(host.querySelector(".nous-readout")!.textContent).toBe("ν 0");
    render(null, host);
    host.remove();
    mount(undefined, storage);
    expect(readouts()).toEqual(["Sine · 1 · 16", "Triangle · 0 · 15", "Flywheel · 0 · 25"]);
  });

  it("buys as many levels as ν affords on a shift-click: 3 with ν for 3.4", () => {
    const shell = mount(withNous(51.6 + 0.4 * 40.96));
    click(fader("sine"), true);
    expect(shell.state.value.game.console.channels.sine).toBe(3);
    // 10 × 1.6³ = 40.96, shown rounded up.
    expect(readouts()[0]).toBe("Sine · 3 · 41");
  });

  it("shows the throw's fill relative to the highest level on the strip", () => {
    const s = withNous(0);
    s.game.console = { channels: { sine: 4, triangle: 2 }, shown: { console: true } };
    mount(s);
    const fill = (type: string) => fader(type).querySelector<HTMLElement>(".fader-fill")!.style.height;
    expect([fill("sine"), fill("triangle"), fill("flywheel")]).toEqual(["100%", "50%", "0%"]);
  });

  it("holds each readout's width from 0 · 10 to 40 · 1.2e9 (ADR-0031)", () => {
    const low = withNous(0);
    low.game.console.shown.console = true;
    mount(low);
    const width = () => host.querySelector<HTMLElement>('[data-fader="sine"] .fader-readout')!.style.minWidth;
    const before = width();
    render(null, host);
    host.remove();
    const high = withNous(0);
    high.game.console = { channels: { sine: 40 }, shown: { console: true } };
    mount(high);
    expect(readouts()[0]).toBe("Sine · 40 · 1.46e9");
    expect(width()).toBe(before);
    expect(parseFloat(before)).toBeGreaterThanOrEqual("Sine · 40 · 1.46e9".length);
  });

  it("is drawn muted in flow and buys nothing there", () => {
    const s = withNous(1000);
    s.game.console.shown.console = true;
    giveHabit(s, "Piano", "engineer");
    begin(s, 1500, 5_000_000_000_000);
    const shell = mount(s);
    expect(host.querySelector(".flow-screen")).not.toBeNull();
    expect(strip()).not.toBeNull();
    for (const type of ["sine", "triangle", "flywheel"]) {
      expect(fader(type).hasAttribute("data-muted")).toBe(true);
      expect(fader(type).disabled).toBe(true);
    }
    const before = shell.state.value;
    click(fader("sine"));
    click(fader("sine"), true);
    expect(shell.state.value.game.console).toEqual(before.game.console);
    expect(shell.state.value.game.nous.toNumber()).toBe(1000);
  });
});
