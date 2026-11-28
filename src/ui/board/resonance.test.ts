// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { advance } from "../../engine/advance";
import { apply } from "../../engine/apply";
import { giveHabit, giveOscillators, started } from "../../engine/fixtures";
import { createInitialState } from "../../engine/state";
import type { GameState } from "../../engine/types";
import { memorySaveStorage } from "../shared-save";
import { App } from "../shell/App";
import { Shell } from "../shell/shell";

// Resonance on the board (issue #26): each satisfied resonance's member
// cells share one thin engraved outline in the oscillator hue, updated the
// moment the layout changes, pulsing only in flow. No number is drawn.

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

// The acceptance layout, built through `apply` with a third oscillator's
// allowance and a habit to practise.
function acceptanceLayout(): GameState {
  let s = createInitialState();
  giveOscillators(s, { allowance: 3 });
  giveHabit(s, "Piano", "engineer");
  for (const [module, q, r] of [["sine", 0, 0], ["triangle", 1, 0], ["triangle", 0, 1]] as const) {
    s = apply(s, { type: "placeModule", module, cell: { q, r } }).state;
  }
  return s;
}

const outlines = () => [...host.querySelectorAll<SVGPathElement>(".resonance")];

describe("resonance outlines", () => {
  it("draw nothing on a board with no resonance", () => {
    mount();
    expect(outlines()).toHaveLength(0);
  });

  it("draw one outline over the resonance's member cells, static in upgrade, with no number", () => {
    const shell = mount();
    act(() => {
      shell.state.value = acceptanceLayout();
    });
    expect(outlines()).toHaveLength(1);
    const outline = outlines()[0]!;
    expect(outline.getAttribute("data-members")).toBe("0,0 0,1 1,0");
    expect(outline.getAttribute("data-category")).toBe("oscillator");
    expect(outline.getAttribute("d")).toMatch(/^M [\d.-]+,[\d.-]+( L [\d.-]+,[\d.-]+)+ Z$/);
    expect(outline.hasAttribute("data-pulse")).toBe(false);
    expect(host.querySelector(".resonances")!.textContent).toBe("");
  });

  it("carry a pulse marker only in flow", () => {
    const shell = mount();
    const laid = acceptanceLayout();
    act(() => {
      shell.state.value = started(laid, 5_000_000_000_000);
    });
    expect(outlines()).toHaveLength(1);
    expect(outlines()[0]!.hasAttribute("data-pulse")).toBe(true);
    act(() => {
      shell.state.value = apply(shell.state.peek(), { type: "pauseSession" }).state;
    });
    expect(outlines()[0]!.hasAttribute("data-pulse")).toBe(false);
  });

  it("leave the ν readout rising with flow time", () => {
    const shell = mount();
    let s = started(acceptanceLayout(), 5_000_000_000_000);
    act(() => {
      shell.state.value = s;
    });
    expect(host.querySelector(".nous-readout")!.textContent).toBe("ν 0");
    s = advance(s, 60, "flow").state;
    act(() => {
      shell.state.value = s;
    });
    // 2.9325 ν/s under the opening's pressure (issue #52) for a minute.
    expect(host.querySelector(".nous-readout")!.textContent).toBe("ν 175");
  });

  it("update the moment the layout changes", () => {
    const shell = mount();
    act(() => {
      shell.state.value = acceptanceLayout();
    });
    act(() => {
      shell.act({ type: "moveModule", from: { q: 0, r: 1 }, to: { q: 1, r: -1 } });
    });
    // Sine (0,0), Triangles (1,0) and (1,-1): still one triangle, moved.
    expect(outlines().map((o) => o.getAttribute("data-members"))).toEqual(["0,0 1,-1 1,0"]);
    act(() => {
      shell.act({ type: "removeModule", cell: { q: 1, r: -1 } });
    });
    expect(outlines()).toHaveLength(0);
  });
});
