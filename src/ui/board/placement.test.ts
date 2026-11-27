// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../../engine/save";
import { memorySaveStorage } from "../shared-save";
import { App } from "../shell/App";
import { Shell } from "../shell/shell";

// Placing oscillators on screen (issue #25): the tray of arrived types
// beside the board, click-to-pick and click-to-place, drag, and the state
// grammar (firm inset = picked, clear outline = valid target, muted
// outline = invalid). Every route ends in the shell's one `apply` path.

let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
  vi.restoreAllMocks();
});

function mount(storage = memorySaveStorage()): { shell: Shell; storage: ReturnType<typeof memorySaveStorage> } {
  const shell = new Shell(storage, () => 5_000_000_000_000);
  shell.boot();
  host = document.createElement("main");
  document.body.append(host);
  act(() => render(h(App, { shell }), host));
  return { shell, storage };
}

const tray = () => [...host.querySelectorAll<HTMLButtonElement>(".tray button[data-module]")];
const entry = (name: string) => tray().find((b) => b.textContent === name)!;
const cell = (key: string) => host.querySelector<SVGGElement>(`[data-cell="${key}"]`)!;
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const key = (k: string) => act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });
const placed = (shell: Shell) => shell.state.value.game.board.placements.map((p) => `${p.module}@${p.cell.q},${p.cell.r}`).sort();

describe("the tray", () => {
  it("shows one entry per type the player has: Sine, Triangle and the Flywheel", () => {
    mount();
    expect(tray().map((b) => b.textContent)).toEqual(["Sine", "Triangle", "Flywheel"]);
    for (const button of tray()) {
      expect(button.disabled).toBe(false);
      expect(button.querySelector("svg[data-glyph]")).not.toBeNull();
    }
  });
});

describe("click-to-pick, click-to-place", () => {
  it("places the picked module on the clicked open cell, and saves it", () => {
    const { shell, storage } = mount();
    click(entry("Sine"));
    click(cell("0,0"));
    expect(placed(shell)).toEqual(["sine@0,0"]);
    expect(cell("0,0").querySelector('[data-module="sine"]')).not.toBeNull();
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).state.game.board.placements).toEqual([{ cell: { q: 0, r: 0 }, module: "sine" }]);
    expect(host.querySelector("[data-picked]")).toBeNull();
  });

  it("marks the pick with a firm inset, open cells as valid and walls and dark cells as invalid targets", () => {
    mount();
    click(entry("Triangle"));
    expect(entry("Triangle").getAttribute("aria-pressed")).toBe("true");
    expect(entry("Triangle").hasAttribute("data-picked")).toBe(true);
    expect(entry("Sine").getAttribute("aria-pressed")).toBe("false");
    for (const k of ["0,0", "1,0", "0,1", "1,-1"]) expect(cell(k).getAttribute("data-target")).toBe("valid");
    expect(cell("-1,1").getAttribute("data-target")).toBe("invalid");
    expect(cell("3,0").getAttribute("data-target")).toBe("invalid");
    expect(host.querySelector('.outlines .cell-target[data-for="3,0"]')).not.toBeNull();
  });

  it("keeps the board as it was when a wall is clicked", () => {
    const { shell } = mount();
    click(entry("Sine"));
    click(cell("-1,1"));
    expect(placed(shell)).toEqual([]);
  });

  it("Escape clears a pick", () => {
    mount();
    click(entry("Sine"));
    key("Escape");
    expect(host.querySelector("[data-picked]")).toBeNull();
    expect(host.querySelector("[data-target]")).toBeNull();
  });

  it("a tap away clears a pick", () => {
    mount();
    click(entry("Sine"));
    click(document.body);
    expect(host.querySelector("[data-picked]")).toBeNull();
  });

  it("moves a placed module, swaps onto an occupied cell, and returns one to the tray", () => {
    const { shell } = mount();
    click(entry("Sine"));
    click(cell("0,0"));
    click(entry("Triangle"));
    click(cell("1,0"));
    expect(placed(shell)).toEqual(["sine@0,0", "triangle@1,0"]);

    click(cell("0,0"));
    expect(cell("0,0").hasAttribute("data-picked")).toBe(true);
    click(cell("1,-1"));
    expect(placed(shell)).toEqual(["sine@1,-1", "triangle@1,0"]);

    click(cell("1,-1"));
    click(cell("1,0"));
    expect(placed(shell)).toEqual(["sine@1,0", "triangle@1,-1"]);

    click(cell("1,0"));
    click(entry("Sine"));
    expect(placed(shell)).toEqual(["triangle@1,-1"]);
  });

  it("mutes the oscillator entries once oscillator allowance is full", () => {
    mount();
    click(entry("Sine"));
    click(cell("0,0"));
    click(entry("Sine"));
    click(cell("1,0"));
    expect(entry("Sine").disabled).toBe(true);
    expect(entry("Triangle").disabled).toBe(true);
    // Allowance is counted per category (issue #31).
    expect(entry("Flywheel").disabled).toBe(false);
  });

  it("places from the keyboard: an open cell is a focusable target", () => {
    const { shell } = mount();
    click(entry("Sine"));
    const target = cell("0,1");
    expect(target.getAttribute("tabindex")).toMatch(/^(0|-1)$/);
    act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(placed(shell)).toEqual(["sine@0,1"]);
  });
});

describe("drag", () => {
  it("drags a tray entry onto an open cell through the same path", async () => {
    const { shell } = mount();
    const target = cell("1,0");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
    const source = entry("Triangle");
    act(() => {
      source.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10, button: 0 }));
      window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 60, clientY: 60 }));
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 60, clientY: 60 }));
    });
    expect(placed(shell)).toEqual(["triangle@1,0"]);
    // The click a browser fires after the release is swallowed, once, for
    // the rest of that task: let it pass so it can't leak into later tests.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("the layout is locked outside upgrade mode", () => {
  it("in flow, the tray is muted and a click neither picks nor places", () => {
    const { shell } = mount();
    click(entry("Sine"));
    click(cell("0,0"));
    act(() => { shell.state.value = { ...shell.state.value, game: { ...shell.state.value.game, mode: "flow" } }; });
    expect(tray().every((b) => b.disabled)).toBe(true);
    click(cell("0,0"));
    expect(host.querySelector("[data-picked]")).toBeNull();
    click(entry("Triangle"));
    click(cell("1,0"));
    expect(placed(shell)).toEqual(["sine@0,0"]);
    // The cell stays focusable for the Hex detail (issue #27), but is no
    // target for anything.
    expect(cell("1,0").hasAttribute("data-target")).toBe(false);
  });
});
