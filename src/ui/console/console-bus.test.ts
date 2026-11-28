// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { openRoadie } from "../../engine/fixtures";
import { D } from "../../engine/num";
import { createInitialState } from "../../engine/state";
import type { GameState } from "../../engine/types";
import { memorySaveStorage } from "../shared-save";
import { App } from "../shell/App";
import { Shell } from "../shell/shell";

// The console's bus section (spec chunk 06, issue #60): one bus fader per
// category the player has, apart from the channels behind a rule, from the
// first time a bus fader is affordable (5 000 ν). Each reads like a
// channel (`Oscillators · 2 · 12 800`) and buys the same way.

let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
});

function mount(state: GameState): Shell {
  const shell = new Shell(memorySaveStorage(), () => 5_000_000_000_000);
  shell.boot();
  host = document.createElement("main");
  document.body.append(host);
  act(() => render(h(App, { shell }), host));
  act(() => void (shell.state.value = state));
  return shell;
}

function withNous(nous: number): GameState {
  const s = createInitialState();
  s.game.nous = D(nous);
  return s;
}

const buses = () => host.querySelector<HTMLElement>('[data-console] [data-section="buses"]');
const bus = (category: string) => buses()!.querySelector<HTMLButtonElement>(`[data-fader="bus-${category}"]`)!;
const busReadouts = () => [...(buses()?.querySelectorAll<HTMLElement>(".fader-readout") ?? [])].map((r) => r.textContent);
const click = (el: HTMLElement, shiftKey = false) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey })));

describe("the console's bus section", () => {
  it("is absent below 5 000 ν, with the channels shown", () => {
    mount(withNous(4999));
    expect(host.querySelector("[data-console]")).not.toBeNull();
    expect(buses()).toBeNull();
  });

  it("shows the Oscillators and Modulators buses at 5 000 ν, after the channels behind a rule", () => {
    mount(withNous(5000));
    expect(busReadouts()).toEqual(["Oscillators · 0 · 5\u2009000", "Modulators · 0 · 5\u2009000"]);
    const channels = host.querySelector('[data-console] [data-section="channels"]')!;
    expect(channels.compareDocumentPosition(buses()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(buses()!.classList.contains("console-section-ruled")).toBe(true);
    expect(bus("oscillator").getAttribute("data-category")).toBe("oscillator");
    expect(bus("modulator").getAttribute("data-category")).toBe("modulator");
  });

  it("buys a level on a click and stays after ν falls; a shift-click buys the most", () => {
    const shell = mount(withNous(5000 + 5000 + 8000));
    click(bus("oscillator"));
    expect(busReadouts()[0]).toBe("Oscillators · 1 · 8\u2009000");
    click(bus("modulator"));
    expect(shell.state.value.game.nous.toNumber()).toBeCloseTo(8000, 6);
    click(bus("oscillator"), true);
    expect(shell.state.value.game.nous.toNumber()).toBeCloseTo(0, 6);
    expect(busReadouts()).toEqual(["Oscillators · 2 · 12\u2009800", "Modulators · 1 · 8\u2009000"]);
    expect(bus("oscillator").hasAttribute("data-muted")).toBe(true);
  });

  it("adds the Arms bus once Roadie has opened", () => {
    const s = withNous(5000);
    openRoadie(s);
    mount(s);
    expect(busReadouts()).toEqual(["Oscillators · 0 · 5\u2009000", "Modulators · 0 · 5\u2009000", "Arms · 0 · 5\u2009000"]);
    expect(bus("arm").getAttribute("data-category")).toBe("arm");
  });
});
