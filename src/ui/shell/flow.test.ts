// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { apply } from "../../engine/apply";
import { giveHabit, giveOscillators } from "../../engine/fixtures";
import { serialize, STORAGE_KEY } from "../../engine/save";
import { createInitialState } from "../../engine/state";
import type { GameState } from "../../engine/types";
import { memorySaveStorage, type SaveStorage } from "../shared-save";
import { App } from "./App";
import { Shell } from "./shell";

// Begin flow and the flow screen (issue #39): the player starts a session
// from the page and watches the board run. The clock boundary is driven
// directly with a fake wall clock and no drift.
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

// Sine, Triangle, Triangle in a triangle: 4.5 ν/s (chunk 02's layout), on
// a habit Piano · Engineer.
function laidOut(): GameState {
  let s = createInitialState();
  giveOscillators(s, { allowance: 3 });
  giveHabit(s, "Piano", "engineer");
  for (const [module, q, r] of [["sine", 0, 0], ["triangle", 1, 0], ["triangle", 0, 1]] as const) {
    s = apply(s, { type: "placeModule", module, cell: { q, r } }).state;
  }
  return s;
}

function saved(state: GameState): SaveStorage {
  const storage = memorySaveStorage();
  storage.setItem(STORAGE_KEY, serialize(state, T0));
  return storage;
}

function button(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent === name || b.getAttribute("aria-label") === name);
  if (!found) throw new Error(`no button ${name}: ${[...host.querySelectorAll("button")].map((b) => b.textContent).join(", ")}`);
  return found;
}

function click(name: string): void {
  act(() => button(name).click());
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function text(selector: string): string {
  return host.querySelector(selector)?.textContent ?? "";
}

function tick(shell: Shell, seconds: number, presence: "visible" | "away" = "visible"): void {
  t += seconds * 1000;
  act(() => shell.boundary(presence));
}

// Start on the first habit through the panel, with a preset length.
function beginOn(shell: Shell, minutes: "25" | "50" | "90" = "25"): void {
  click("Begin flow");
  click(minutes);
  click("Begin");
  expect(shell.screen.value.kind).toBe("flow");
}

describe("the Begin flow panel", () => {
  it("creates Piano · Engineer inline, starts 25 minutes, and locks the board, cables and habit", () => {
    const shell = mount(memorySaveStorage());
    click("Begin flow");
    expect(shell.screen.value.kind).toBe("begin");
    click("+ New habit");
    type(host.querySelector<HTMLInputElement>("input[name=habit-name]")!, "Piano");
    // Only the open classes are offered.
    expect([...host.querySelectorAll("[data-class-pick] button")].map((b) => b.textContent)).toEqual(["Engineer", "Producer"]);
    click("Engineer");
    expect(host.querySelector<HTMLSelectElement>("select[name=habit]")!.selectedOptions[0]!.textContent).toBe("Piano · Engineer");
    click("25");
    click("Begin");

    expect(shell.screen.value.kind).toBe("flow");
    const state = shell.state.value;
    expect(state.game.mode).toBe("flow");
    expect(state.game.session!.target).toBe(1500);
    expect(state.records.activeHabitId).toBe(state.records.habits[0]!.id);
    // The board and its cables are locked, and so is the habit.
    expect(shell.placing.locked.value).toBe(true);
    expect(shell.act({ type: "placeModule", module: "sine", cell: { q: 0, r: 0 } }).ok).toBe(false);
    expect(shell.act({ type: "patchCable", cable: "patch", source: { q: 0, r: 0 }, target: { q: 1, r: 0 } }).ok).toBe(false);
    expect(shell.act({ type: "selectHabit", id: null }).ok).toBe(false);
  });

  it("preselects the last-practised habit", () => {
    const s = laidOut();
    const guitar = giveHabit(s, "Guitar", "producer").habit;
    const piano = s.records.habits.find((h) => h.name === "Piano")!;
    // Piano practised last.
    s.records.practiceLog.push({ id: "p1", habitId: guitar.id, seconds: 600, source: "live", at: T0 - 9_000_000 });
    s.records.practiceLog.push({ id: "p2", habitId: piano.id, seconds: 600, source: "live", at: T0 - 1_000_000 });
    s.records.activeHabitId = guitar.id;
    mount(saved(s));
    click("Begin flow");
    expect(host.querySelector<HTMLSelectElement>("select[name=habit]")!.selectedOptions[0]!.textContent).toBe("Piano · Engineer");
  });

  it("shows a refusal as one quiet line", () => {
    const shell = mount(memorySaveStorage());
    click("Begin flow");
    click("25");
    click("Begin");
    expect(shell.screen.value.kind).toBe("begin");
    expect([...host.querySelectorAll("[data-refusal]")].map((p) => p.textContent)).toEqual(["Choose a habit first."]);
  });

  it("takes a custom length from 10 to 180 minutes", () => {
    const shell = mount(saved(laidOut()));
    click("Begin flow");
    click("custom");
    type(host.querySelector<HTMLInputElement>("input[name=minutes]")!, "181");
    click("Begin");
    expect(text("[data-refusal]")).toBe("Choose a length from 10 to 180 minutes.");
    type(host.querySelector<HTMLInputElement>("input[name=minutes]")!, "40");
    click("Begin");
    expect(shell.state.value.game.session!.target).toBe(2400);
  });
});

describe("the flow screen", () => {
  it("shows the board, ν, the class line, Ready, the clock and its controls, and nothing else", () => {
    const shell = mount(saved(laidOut()));
    beginOn(shell);
    expect(host.querySelector(".board")).not.toBeNull();
    expect(text(".nous-readout")).toBe("ν 0");
    // The layout's third oscillator came with Engineer Lv 1 (0.5 h).
    expect(text("[data-class-line]")).toBe("Engineer · Lv 1 ▕░░░░░░░░░▏ 0.5h / 1.5h");
    // The unplaced Modulator and the unused Patch cable.
    expect(text("[data-ready]")).toBe("Ready · 2");
    expect(text(".session-clock")).toBe("25:00");
    expect([...host.querySelectorAll("button")].map((b) => b.textContent || b.getAttribute("aria-label"))).toEqual(["Notes", "Pause", "End"]);
    // No tray, Goal or doors.
    expect(host.querySelector("[data-tray]")).toBeNull();
    expect(host.querySelector("[data-goal]")).toBeNull();
    // The resonance outline pulses in flow.
    expect(host.querySelector(".resonance")!.hasAttribute("data-pulse")).toBe(true);
  });

  it("raises ν by the board's rate at each boundary and moves the class line", () => {
    const shell = mount(saved(laidOut()));
    beginOn(shell);
    tick(shell, 60);
    // 4.5 ν/s for a minute.
    expect(text(".nous-readout")).toBe("ν 270");
    expect(text(".session-clock")).toBe("24:00");
    tick(shell, 1200);
    // 0.5 h + 21 min on Engineer is 0.85 h, truncated to 0.8h; 0.35 of the
    // way from Lv 1 to Lv 2 fills 3 of the 9 cells.
    expect(text("[data-class-line]")).toBe("Engineer · Lv 1 ▕███░░░░░░▏ 0.8h / 1.5h");
  });

  it("accounts an away gap by the trust rules on the next visible boundary", () => {
    const shell = mount(saved(laidOut()));
    beginOn(shell);
    tick(shell, 60, "away");
    // Buffered: nothing credited yet.
    expect(shell.state.value.game.session!.accounting.creditedSeconds).toBe(0);
    expect(shell.state.value.game.session!.accounting.pendingAwaySeconds).toBe(60);
    tick(shell, 0);
    // Under the reconciliation floor, the whole absence is trusted.
    expect(shell.state.value.game.session!.accounting.creditedSeconds).toBe(60);
    expect(text(".nous-readout")).toBe("ν 270");
  });

  it("raises Ready · N on the boundary where live credit crosses a level", () => {
    const s = laidOut();
    // 30 s short of Engineer Lv 3 (3 h), which grants +1 Oscillator.
    s.records.classCredit.engineer = 3 * 3600 - 30;
    const shell = mount(saved(s));
    beginOn(shell);
    expect(text("[data-ready]")).toBe("Ready · 2");
    tick(shell, 30);
    expect(text("[data-ready]")).toBe("Ready · 3");
    expect(text("[data-class-line]")).toBe("Engineer · Lv 3 ▕░░░░░░░░░▏ 3.0h / 5.0h");
  });

  it("marks the passed target once and runs on; a reload doesn't mark it again", () => {
    const storage = saved(laidOut());
    const shell = mount(storage);
    beginOn(shell);
    tick(shell, 1499);
    expect(shell.state.value.game.session!.targetSignaled).toBe(false);
    tick(shell, 2);
    expect(shell.state.value.game.session!.targetSignaled).toBe(true);
    expect(shell.screen.value.kind).toBe("flow");
    expect(text(".clock-caption")).toBe("overrun");
    expect(text(".session-clock")).toBe("00:01");
    const reopened = new Shell(storage, () => t);
    reopened.boot();
    expect(reopened.state.value.game.session!.targetSignaled).toBe(true);
    t += 1000;
    reopened.boundary("visible");
    expect(reopened.state.value.game.session!.targetSignaled).toBe(true);
    expect(reopened.screen.value.kind).toBe("flow");
  });

  it("credits nothing while paused, and the clock reads paused", () => {
    const shell = mount(saved(laidOut()));
    beginOn(shell);
    tick(shell, 60);
    click("Pause");
    tick(shell, 600);
    expect(shell.state.value.game.session!.accounting.creditedSeconds).toBe(60);
    expect(text(".clock-caption")).toBe("paused");
    expect(text(".session-clock")).toBe("24:00");
    click("Resume");
    tick(shell, 60);
    expect(shell.state.value.game.session!.accounting.creditedSeconds).toBe(120);
  });

  it("End ends the session and returns to upgrade mode", () => {
    const shell = mount(saved(laidOut()));
    beginOn(shell);
    tick(shell, 60);
    click("End");
    expect(shell.state.value.game.mode).toBe("upgrade");
    expect(shell.state.value.records.sessionsCompleted).toBe(1);
    // The summary shows first (issue #40).
    expect(shell.screen.value.kind).toBe("summary");
  });

  it("shows the Goal in upgrade mode and not in flow, and the chips and doors' place only after a completed session", () => {
    const shell = mount(saved(laidOut()));
    expect(text("[data-goal]")).toBe("Conquer Shale");
    expect(host.querySelector("[data-chip]")).toBeNull();
    expect(host.querySelector("[data-doors]")).toBeNull();
    beginOn(shell);
    expect(host.querySelector("[data-goal]")).toBeNull();
    tick(shell, 60);
    click("End");
    expect(text("[data-goal]")).toBe("Conquer Shale");
    expect(host.querySelector("[data-chip]")).not.toBeNull();
    expect(host.querySelector("[data-doors]")).not.toBeNull();
  });

  it("a rebooted Shell lands back on the flow screen with time reconciled from the wall clock", () => {
    const storage = saved(laidOut());
    const shell = mount(storage);
    beginOn(shell);
    tick(shell, 60);
    t += 90_000;
    const reopened = mount(storage);
    expect(reopened.screen.value.kind).toBe("flow");
    // 60 s before the reload and 90 s while closed (under the floor).
    expect(reopened.state.value.game.session!.accounting.creditedSeconds).toBe(150);
    expect(text(".session-clock")).toBe("22:30");
  });

  it("saves a Notes entry written in flow, tagged to the session's habit", () => {
    const storage = saved(laidOut());
    const shell = mount(storage);
    beginOn(shell);
    tick(shell, 60);
    click("Notes");
    type(host.querySelector<HTMLTextAreaElement>("textarea")!, "Left hand drifts");
    click("Capture note");
    const piano = shell.state.value.records.habits.find((hb) => hb.name === "Piano")!;
    const stored = JSON.parse(storage.getItem(STORAGE_KEY)!) as { state: { records: { notes: { text: string; habitId: string; atElapsed: number }[] } } };
    expect(stored.state.records.notes).toEqual([expect.objectContaining({ text: "Left hand drifts", habitId: piano.id, atElapsed: 60 })]);
    click("LOGGED");
    expect(text(".note-entry")).toMatch(/^[A-Z][a-z]{2} \d{1,2} · S1 · 01:00 · PianoLeft hand drifts$/);
  });
});
