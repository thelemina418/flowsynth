// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { advanceIn, applyIn, begin } from "../../engine/fixtures";
import { serialize, STORAGE_KEY } from "../../engine/save";
import { createInitialState } from "../../engine/state";
import type { GameState } from "../../engine/types";
import { memorySaveStorage, type SaveStorage } from "../shared-save";
import { App } from "./App";
import { Shell } from "./shell";

// The Encyclopedia (issue #44): a door in upgrade mode from the first
// completed session on, with one quiet unseen-dot; a list of revealed
// entries only; an entry view that marks the entry seen. Escape or a tap
// away closes it.

const NOW = 1_800_000_000_000;
let host: HTMLElement;
let mounted: HTMLElement[] = [];

afterEach(() => {
  for (const el of mounted) {
    render(null, el);
    el.remove();
  }
  mounted = [];
});

function mount(storage: SaveStorage): Shell {
  const shell = new Shell(storage, () => NOW);
  shell.boot();
  host = document.createElement("main");
  document.body.append(host);
  mounted.push(host);
  act(() => render(h(App, { shell }), host));
  return shell;
}

function saved(state: GameState): SaveStorage {
  const storage = memorySaveStorage();
  storage.setItem(STORAGE_KEY, serialize(state, NOW));
  return storage;
}

function button(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent === name);
  if (!found) throw new Error(`no button ${name}: ${[...host.querySelectorAll("button")].map((b) => b.textContent).join(", ")}`);
  return found;
}

function click(name: string): void {
  act(() => button(name).click());
}

const door = () => host.querySelector<HTMLButtonElement>('[data-door="encyclopedia"]');
const dot = () => door()?.querySelector("[data-unseen]") ?? null;
const listed = () => [...host.querySelectorAll<HTMLElement>("[data-entry]")].map((b) => b.textContent);

// One completed 25-minute session on Piano · Engineer, summary dismissed:
// Walls, Sine, Triangle, Classes and Breather are revealed.
function practised(): GameState {
  const s = createInitialState();
  const made = applyIn(s, { type: "createHabit", name: "Piano", habitClass: "engineer" });
  begin(s, 1500, NOW - 1_500_000, made.id);
  advanceIn(s, 1500, "flow");
  applyIn(s, { type: "endSession", now: NOW });
  applyIn(s, { type: "dismissSummary" });
  return s;
}

describe("the Encyclopedia door", () => {
  it("is absent on a fresh start and in flow, and shows in upgrade mode after the first session with its unseen-dot", () => {
    mount(memorySaveStorage());
    expect(door()).toBeNull();
    render(null, host);

    const shell = mount(saved(practised()));
    expect(host.querySelector("[data-doors]")!.contains(door())).toBe(true);
    expect(door()!.textContent).toBe("Encyclopedia");
    expect(dot()).not.toBeNull();
    click("Begin flow");
    click("25");
    click("Begin");
    expect(shell.screen.value.kind).toBe("flow");
    expect(door()).toBeNull();
    shell.openEncyclopedia();
    expect(shell.screen.value.kind).toBe("flow");
  });

  it("lists only revealed entries, in authored order", () => {
    mount(saved(practised()));
    act(() => door()!.click());
    expect(listed()).toEqual(["Sine", "Triangle", "Walls", "Classes", "Breather"]);
    expect(host.textContent).not.toContain("Prestige");
    expect(host.textContent).not.toContain("Pressure");
    expect(host.querySelector(".stage, [data-stage]")).toBeNull();
  });

  it("opening an entry shows its lines and marks it seen; the dot goes once every entry is read", () => {
    const storage = saved(practised());
    const shell = mount(storage);
    act(() => door()!.click());
    click("Walls");
    expect(host.querySelector("[data-entry-view] h3")!.textContent).toBe("Walls");
    expect(host.querySelector("[data-entry-view]")!.textContent).toContain("HP");
    expect(shell.state.value.game.encyclopedia.seen).toEqual(["walls"]);
    click("‹ Entries");
    for (const title of ["Sine", "Triangle", "Classes"]) {
      click(title);
      click("‹ Entries");
    }
    click("Close");
    expect(dot()).not.toBeNull();
    act(() => door()!.click());
    click("Breather");
    click("Close");
    expect(shell.screen.value.kind).toBe("ready");
    expect(dot()).toBeNull();
    // The seen set is saved.
    render(null, host);
    mount(storage);
    expect(dot()).toBeNull();
  });

  it("Escape closes it", () => {
    const shell = mount(saved(practised()));
    act(() => door()!.click());
    expect(shell.screen.value.kind).toBe("encyclopedia");
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(shell.screen.value.kind).toBe("ready");
  });

  it("a tap away closes it; a tap inside does not", () => {
    const shell = mount(saved(practised()));
    act(() => door()!.click());
    act(() => {
      host.querySelector("[data-encyclopedia]")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(shell.screen.value.kind).toBe("encyclopedia");
    act(() => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(shell.screen.value.kind).toBe("ready");
  });
});
