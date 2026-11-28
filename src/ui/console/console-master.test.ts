// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { D } from "../../engine/num";
import { createInitialState } from "../../engine/state";
import type { GameState } from "../../engine/types";
import { memorySaveStorage } from "../shared-save";
import { App } from "../shell/App";
import { Shell } from "../shell/shell";

// The console's master section (spec chunk 06, issue #63): after the first
// prestige, three Arete faders behind a rule, each reading
// `name · level · cost` with its one effect line beneath, and `max` in
// place of the cost once capped.

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

function prestiged(arete: number): GameState {
  const s = createInitialState();
  s.game.console.shown.console = true;
  s.game.prestiges = 1;
  s.game.arete = D(arete);
  return s;
}

const master = () => host.querySelector<HTMLElement>('[data-console] [data-section="master"]');
const fader = (id: string) => master()!.querySelector<HTMLButtonElement>(`[data-fader="master-${id}"]`)!;
const readouts = () => [...(master()?.querySelectorAll<HTMLElement>(".fader-readout") ?? [])].map((r) => r.textContent);
const effects = () => [...(master()?.querySelectorAll<HTMLElement>(".fader-effect") ?? [])].map((r) => r.textContent);
const click = (el: HTMLElement, shiftKey = false) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey })));

describe("the console's master section", () => {
  it("is absent before the first prestige", () => {
    const s = createInitialState();
    s.game.console.shown.console = true;
    s.game.arete = D(5);
    mount(s);
    expect(host.querySelector("[data-console]")).not.toBeNull();
    expect(master()).toBeNull();
  });

  it("after it, shows the three faders with costs in Arete and one effect line each", () => {
    mount(prestiged(0));
    expect(readouts()).toEqual(["Channel Taper · 0 · 1 Arete", "Bus Taper · 0 · 1 Arete", "Drive · 0 · 1 Arete"]);
    expect(effects()).toEqual(["channel growth −0.03", "bus growth −0.03", "oscillator ν ×1.5"]);
    expect(fader("drive").disabled).toBe(true);
  });

  it("a click spends Arete, and shift-click buys as many as it pays for", () => {
    const shell = mount(prestiged(4));
    click(fader("drive"));
    expect(shell.state.value.game.console.master.drive).toBe(1);
    expect(readouts()[2]).toBe("Drive · 1 · 2 Arete");
    click(fader("channelTaper"), true);
    expect(shell.state.value.game.console.master.channelTaper).toBe(2);
    expect(shell.state.value.game.arete.toNumber()).toBe(0);
  });

  it("a capped taper reads max and refuses purchases", () => {
    const s = prestiged(50);
    s.game.console.master.busTaper = 10;
    const shell = mount(s);
    expect(readouts()[1]).toBe("Bus Taper · 10 · max");
    expect(fader("busTaper").disabled).toBe(true);
    click(fader("busTaper"));
    expect(shell.state.value.game.arete.toNumber()).toBe(50);
  });

  it("reserves room for an uncapped Drive far past two digits (ADR-0031)", () => {
    const s = prestiged(0);
    s.game.console.master = { drive: 12_345 };
    mount(s);
    const readout = fader("drive").querySelector<HTMLElement>(".fader-readout")!;
    // `Drive · 12 345 · 12 346 Arete`: the level and cost in fmt's figures.
    expect(readout.textContent!.replace(/\s/g, " ")).toBe("Drive · 12 345 · 12 346 Arete");
    expect(parseFloat(readout.style.minWidth)).toBeGreaterThanOrEqual(readout.textContent!.length);
  });
});
