// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { memorySaveStorage } from "../shared-save";
import { App } from "../shell/App";
import { Shell } from "../shell/shell";

// The board on a fresh start (issue #24): what a new player sees once
// nothing is owed on first load. Placements, the unplaced oscillators and
// the Goal line arrive in later tickets; this ticket's first screen is the
// board and `ν 0`.

let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
});

function mountFresh(): Shell {
  const shell = new Shell(memorySaveStorage(), () => 5_000_000_000_000);
  shell.boot();
  host = document.createElement("main");
  document.body.append(host);
  act(() => render(h(App, { shell }), host));
  return shell;
}

const cells = (kind: string) => [...host.querySelectorAll(`[data-kind="${kind}"]`)];

describe("the board on a fresh start", () => {
  it("draws four open cells, fifteen walls and the dark outer rings", () => {
    mountFresh();
    expect(host.querySelector("svg.board")).not.toBeNull();
    expect(cells("open").map((c) => c.getAttribute("data-cell")).sort()).toEqual(["0,0", "0,1", "1,-1", "1,0"]);
    expect(cells("wall")).toHaveLength(15);
    expect(cells("dark")).toHaveLength(72);
    expect(cells("dark").every((c) => Number(c.getAttribute("data-ring")) >= 3)).toBe(true);
  });

  it("shows every wall's initial, Flint's Roadie mark and the Schist's Mixer mark (issue #48)", () => {
    mountFresh();
    const shale = host.querySelector('[data-cell="-1,1"]')!;
    expect(shale.getAttribute("data-kind")).toBe("wall");
    expect(shale.textContent).toBe("S");
    expect(host.querySelector('[data-cell="-1,0"]')!.textContent).toBe("B");
    expect(host.querySelector('[data-cell="0,-1"]')!.textContent).toBe("B");
    const flint = host.querySelector('[data-cell="0,-2"]')!;
    expect(flint.textContent).toBe("F");
    expect(flint.querySelector('[data-mark="roadie"]')).not.toBeNull();
    const schist = host.querySelector('[data-cell="-2,1"]')!;
    expect(schist.textContent).toBe("S");
    expect(schist.querySelector('[data-mark="mixer"]')).not.toBeNull();
    expect(host.querySelectorAll("[data-mark]")).toHaveLength(2);
    expect(cells("wall").map((c) => c.textContent).sort().join("")).toBe("BBFFFFFFSSSSSSS");
  });

  it("engraves a modifier glyph on the two modified walls, in the stone's own tone", () => {
    mountFresh();
    const modified = [...host.querySelectorAll("[data-modifier]")].map((g) => [g.closest("[data-cell]")!.getAttribute("data-cell"), g.getAttribute("data-modifier")]);
    expect(modified.sort()).toEqual([
      ["-1,0", "pressureDouble"],
      ["0,-2", "armOnly"],
    ]);
    // Never a hue: the modified wall's slab is drawn exactly as a plain one.
    const face = (key: string) => host.querySelector(`[data-cell="${key}"] .cell-face`)!;
    expect(face("-1,0").getAttribute("class")).toBe(face("0,-1").getAttribute("class"));
    expect(host.querySelector('[data-cell="-1,0"]')!.getAttribute("class")).toBe(host.querySelector('[data-cell="0,-1"]')!.getAttribute("class"));
    for (const glyph of host.querySelectorAll("[data-modifier]")) {
      expect(glyph.getAttribute("class")).toBe("modifier-glyph");
      expect(glyph.querySelector("[fill], [stroke]")).toBeNull();
    }
  });

  it("leaves open and dark cells without detail", () => {
    mountFresh();
    for (const cell of [...cells("dark"), ...cells("open")]) expect(cell.textContent).toBe("");
    for (const cell of cells("dark")) expect(cell.children).toHaveLength(1);
    for (const cell of cells("dark")) expect(cell.getAttribute("aria-label")).toBe("Dark cell");
  });

  it("tells open, wall and dark apart by shape, not only colour", () => {
    mountFresh();
    // Open: a machined plate with an engraved inner ring. Wall: one solid
    // slab. Dark: a broken outline.
    for (const cell of cells("open")) expect(cell.querySelectorAll("polygon")).toHaveLength(2);
    for (const cell of cells("wall")) expect(cell.querySelectorAll("polygon")).toHaveLength(1);
    for (const cell of cells("dark")) expect(cell.querySelector("polygon")!.getAttribute("stroke-dasharray")).not.toBeNull();
    for (const cell of [...cells("open"), ...cells("wall")]) expect(cell.querySelector("polygon")!.getAttribute("stroke-dasharray")).toBeNull();
  });

  it("shows exactly philosophy.md's nine first-screen things, and nothing else", () => {
    mountFresh();
    const readout = host.querySelector(".nous-readout")!;
    expect(readout.textContent).toBe("ν 0");
    // The tray (issues #25, #31, #33): Sine, Triangle and the Flywheel,
    // unplaced, and the one Patch cable.
    // `Begin flow` (issue #39) closes the screen.
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Sine", "Triangle", "Flywheel", "1 Patch cable", "Begin flow"]);
    const visible = [...host.querySelectorAll("p, span, text, h2, h3, button")].filter((el) => !el.closest(".sr-only") && !el.querySelector("p, span, text"));
    // The nine (issue #42): the board and its walls (their initials, marks
    // and modifier glyphs are item 2, issue #48), Sine, Triangle,
    // Flywheel, the Patch cable, ν 0, the Goal and Begin flow. No cord is
    // drawn.
    const initials = visible.filter((el) => el.classList.contains("wall-initial"));
    expect(initials).toHaveLength(15);
    expect(initials.every((el) => el.closest('[data-kind="wall"]'))).toBe(true);
    const rest = visible.filter((el) => !el.classList.contains("wall-initial")).map((el) => el.textContent);
    expect(rest.sort()).toEqual(["Sine", "Triangle", "Flywheel", "1 Patch cable", "ν 0", "Conquer Shale", "Begin flow"].sort());
    expect(host.querySelector("[data-goal]")!.textContent).toBe("Conquer Shale");
    // Nothing else before the first completed session or affordable fader.
    // No chips, doors, class line, breather control or console (issue #58).
    expect(host.querySelectorAll("[data-chip], [data-doors], [data-class-line], [data-breather], [data-console]")).toHaveLength(0);
    expect(host.querySelectorAll(".cord, [data-plug], .bead")).toHaveLength(0);
    // The Hex detail is empty.
    expect(host.querySelector("[data-hex-detail]")!.textContent).toBe("");
  });

  it("carries no tooltips", () => {
    mountFresh();
    expect(host.querySelectorAll("title, [title]")).toHaveLength(0);
  });
});
