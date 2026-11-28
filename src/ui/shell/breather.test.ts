// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { apply } from "../../engine/apply";
import { advance } from "../../engine/advance";
import { giveHabit, giveOscillators } from "../../engine/fixtures";
import { serialize, STORAGE_KEY } from "../../engine/save";
import { createInitialState } from "../../engine/state";
import type { GameState } from "../../engine/types";
import { memorySaveStorage, type SaveStorage } from "../shared-save";
import { App } from "./App";
import { Shell } from "./shell";

// The breather's screens (issue #41): `Take breather · N min` in upgrade
// mode while one is banked, the calm screen counting down with a quiet
// `End early`, and `Breather complete · +… ν` on the next upgrade-mode
// view until dismissed. The clock boundary runs on a fake wall clock.
const T0 = 5_000_000_000_000;
let t = T0;
let host: HTMLElement;
let mounted: HTMLElement[] = [];

afterEach(() => {
  for (const el of mounted) {
    render(null, el);
    el.remove();
  }
  mounted = [];
  t = T0;
});

function mount(storage: SaveStorage): Shell {
  const shell = new Shell(storage, () => t);
  shell.boot();
  host = document.createElement("main");
  document.body.append(host);
  mounted.push(host);
  act(() => render(h(App, { shell }), host));
  return shell;
}

function saved(state: GameState): SaveStorage {
  const storage = memorySaveStorage();
  storage.setItem(STORAGE_KEY, serialize(state, T0));
  return storage;
}

function buttons(): string[] {
  return [...host.querySelectorAll("button")].map((b) => b.textContent ?? "");
}

function click(name: string): void {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent === name || b.textContent?.startsWith(name));
  if (!found) throw new Error(`no button ${name}: ${buttons().join(", ")}`);
  act(() => found.click());
}

function type(input: HTMLInputElement, value: string): void {
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// fmt groups thousands with a thin space; the tests read it as a space.
function read(selector: string): string {
  return (host.querySelector(selector)?.textContent ?? "").replace(/\s/g, " ");
}

function tick(shell: Shell, seconds: number, presence: "visible" | "away" = "visible"): void {
  t += seconds * 1000;
  act(() => shell.boundary(presence));
}

// Sine, Triangle, Triangle (2.9325 ν/s under the opening's pressure,
// issue #52) on Piano · Engineer, with a
// 10-minute breather banked by a 50-minute session.
function banked(): GameState {
  let s = createInitialState();
  giveOscillators(s, { allowance: 3 });
  giveHabit(s, "Piano", "engineer");
  for (const [module, q, r] of [["sine", 0, 0], ["triangle", 1, 0], ["triangle", 0, 1]] as const) {
    s = apply(s, { type: "placeModule", module, cell: { q, r } }).state;
  }
  s = apply(s, { type: "startSession", habitId: s.records.habits[0]!.id, target: 3000, now: 0 }).state;
  s = advance(s, 3000, "flow").state;
  s = apply(s, { type: "endSession", now: 0 }).state;
  return apply(s, { type: "dismissSummary" }).state;
}

describe("the breather in upgrade mode", () => {
  it("shows Take breather · 10 min while one is banked, and nothing before", () => {
    const fresh = mount(memorySaveStorage());
    expect(buttons().some((b) => b.startsWith("Take breather"))).toBe(false);
    expect(fresh.screen.value.kind).toBe("ready");
    mount(saved(banked()));
    expect(buttons()).toContain("Take breather · 10 min");
  });

  it("shows only the calm screen, counting down, with a quiet End early", () => {
    const shell = mount(saved(banked()));
    click("Take breather · 10 min");
    expect(shell.screen.value.kind).toBe("breather");
    expect(read("[data-breather]")).toBe("Step away. The board is running. 10:00End early");
    tick(shell, 19);
    expect(read("[data-breather-clock]")).toBe("9:41");
    expect(buttons()).toEqual(["End early"]);
    expect(host.querySelector(".stage, [data-cell], .shell-transport")).toBeNull();
  });

  it("End early pays nothing and shows Take breather again", () => {
    const shell = mount(saved(banked()));
    const nous = shell.state.value.game.nous;
    click("Take breather · 10 min");
    tick(shell, 120);
    click("End early");
    expect(shell.screen.value.kind).toBe("ready");
    expect(shell.state.value.game.nous.eq(nous)).toBe(true);
    expect(buttons()).toContain("Take breather · 10 min");
  });

  it("a reload mid-breather lands on the calm screen with the right time left", () => {
    const storage = saved(banked());
    const shell = mount(storage);
    click("Take breather · 10 min");
    tick(shell, 60);
    t += 120_000;
    const reopened = mount(storage);
    expect(reopened.screen.value.kind).toBe("breather");
    expect(read("[data-breather-clock]")).toBe("7:00");
  });

  it("completes at its deadline: the result shows until dismissed", () => {
    const shell = mount(saved(banked()));
    const nous = shell.state.value.game.nous;
    click("Take breather · 10 min");
    tick(shell, 1_000);
    expect(shell.screen.value.kind).toBe("breather-result");
    // 2 × 2.9325 ν/s × 600 s.
    expect(shell.state.value.game.nous.sub(nous).toNumber()).toBeCloseTo(3519, 9);
    expect(read("[data-breather-result]")).toBe("Breather complete · +3 519 ν");
    click("Continue");
    expect(shell.screen.value.kind).toBe("ready");
    expect(buttons()).toContain("Begin flow");
    expect(buttons().some((b) => b.startsWith("Take breather"))).toBe(false);
  });
});

describe("the full loop (spec chunk 04, Acceptance)", () => {
  it("begins, practises, reports, reads the summary, takes the breather, reopens to the result and begins again", () => {
    const storage = memorySaveStorage();
    const shell = mount(storage);
    // 1. Fresh start, Begin flow, + New habit Piano · Engineer, 25, Begin.
    click("Begin flow");
    click("+ New habit");
    type(host.querySelector<HTMLInputElement>("input[name=habit-name]")!, "Piano");
    click("Engineer");
    click("25");
    click("Begin");
    expect(shell.screen.value.kind).toBe("flow");
    // 2. 20 present minutes, then a 10-minute away gap.
    tick(shell, 1200);
    tick(shell, 600, "away");
    // 3. End, then the honesty report, answered Practiced the whole time.
    click("End");
    expect(shell.screen.value.kind).toBe("honesty");
    click("Practiced the whole time");
    // 4. The summary and its breather line, dismissed.
    expect(read("[data-summary-line]")).toMatch(/^\+.+ ν · Engineer \+30 min → Lv 1$/);
    expect(read("[data-summary-breather]")).toBe("Breather banked · 6 min");
    click("Continue");
    // Engineer Lv 1 granted a third oscillator: place the triangle, so
    // the breather has a board to run.
    for (const [module, q, r] of [["sine", 0, 0], ["triangle", 1, 0], ["triangle", 0, 1]] as const) {
      expect(shell.act({ type: "placeModule", module, cell: { q, r } }).ok).toBe(true);
    }
    const total = shell.state.value.game.rates.breatherTotal;
    expect(total.toNumber()).toBeCloseTo(5.865, 12);
    const before = shell.state.value.game.nous;
    // 5. Take breather · 6 min, and the calm screen shows.
    click("Take breather · 6 min");
    expect(shell.screen.value.kind).toBe("breather");
    expect(read("[data-breather-clock]")).toBe("6:00");
    // 6. Past 6 minutes, a second Shell boots on the same storage.
    t += 7 * 60_000;
    const reopened = mount(storage);
    // 7. Breather complete, with ν equal to breatherTotal × 360.
    expect(reopened.screen.value.kind).toBe("breather-result");
    expect(reopened.state.value.game.nous.sub(before).toNumber()).toBe(total.mul(360).toNumber());
    expect(read("[data-breather-result]")).toBe("Breather complete · +2 111 ν");
    // 8. Dismissed, and Begin flow is shown.
    click("Continue");
    expect(buttons()).toContain("Begin flow");
  });
});
