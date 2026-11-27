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

  it("marks Shale with its initial, and Flint with its initial and Roadie's mark", () => {
    mountFresh();
    const shale = host.querySelector('[data-cell="-1,1"]')!;
    expect(shale.getAttribute("data-kind")).toBe("wall");
    expect(shale.textContent).toBe("S");
    const flint = host.querySelector('[data-cell="2,-1"]')!;
    expect(flint.textContent).toBe("F");
    expect(flint.querySelector('[data-mark="roadie"]')).not.toBeNull();
    expect(host.querySelectorAll("[data-mark]")).toHaveLength(1);
  });

  it("leaves placeholder walls and dark cells without detail", () => {
    mountFresh();
    const placeholders = cells("wall").filter((c) => !["-1,1", "2,-1"].includes(c.getAttribute("data-cell")!));
    expect(placeholders).toHaveLength(13);
    for (const cell of [...placeholders, ...cells("dark"), ...cells("open")]) expect(cell.textContent).toBe("");
    for (const cell of cells("dark")) expect(cell.children).toHaveLength(1);
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

  it("reads ν 0, and shows nothing beyond the board, the tray and the readout", () => {
    mountFresh();
    const readout = host.querySelector(".nous-readout")!;
    expect(readout.textContent).toBe("ν 0");
    // The tray (issues #25, #31, #33): Sine, Triangle and the Flywheel,
    // unplaced, and the one Patch cable.
    // `Begin flow` (issue #39) closes the screen.
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Sine", "Triangle", "Flywheel", "1 Patch cable", "Begin flow"]);
    const visible = [...host.querySelectorAll("p, span, text, h2, h3, button")].filter((el) => !el.closest(".sr-only") && !el.querySelector("p, span, text")).map((el) => el.textContent);
    // Eight of philosophy.md's nine things: the board, the walls with Shale
    // marked (its initial; F is Flint's), Sine, Triangle, Flywheel, the
    // Patch cable, ν 0 and Begin flow (the Goal is chunk 04's issue #42).
    // No cord is drawn.
    expect(visible.sort()).toEqual(["F", "S", "Sine", "Triangle", "Flywheel", "1 Patch cable", "ν 0", "Begin flow"].sort());
    expect(host.querySelectorAll(".cord, [data-plug], .bead")).toHaveLength(0);
    // The Hex detail is empty.
    expect(host.querySelector("[data-hex-detail]")!.textContent).toBe("");
  });

  it("carries no tooltips", () => {
    mountFresh();
    expect(host.querySelectorAll("title, [title]")).toHaveLength(0);
  });
});
