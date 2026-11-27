import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ORIGINAL_SAVE_KEY, serialize, STORAGE_KEY } from "../../engine/save";
import { fresh, giveHabit } from "../../engine/fixtures";
import { memorySaveStorage } from "../shared-save";
import { Shell } from "./shell";

// The shell's seam (issue #21): a storage slot in, the screen owed on first
// load out. Load, migrate and save ride the ported save layer and the
// stale-tab guard; the class choice and the recovery choice are the only
// questions the shell asks.
const V15 = readFileSync(new URL("../../engine/fixtures/saves/v15-migration.json", import.meta.url), "utf8");

function withSave(text: string | null) {
  const storage = memorySaveStorage();
  if (text !== null) storage.setItem(STORAGE_KEY, text);
  return storage;
}

function stored(storage: ReturnType<typeof memorySaveStorage>) {
  return JSON.parse(storage.getItem(STORAGE_KEY)!) as { version: number; state: { records: { habits: { name: string; habitClass: string | null }[]; classCredit: Record<string, number> } } };
}

describe("the shell on first load", () => {
  it("migrates a v15 save, saves it as v16 and asks the first habit for its class", () => {
    const storage = withSave(V15);
    const shell = new Shell(storage, () => 5_000_000_000_000);
    shell.boot();
    expect(stored(storage).version).toBe(16);
    const screen = shell.screen.value;
    expect(screen.kind).toBe("class");
    if (screen.kind !== "class") return;
    expect(screen.habit.name).toBe("Habit A");
    expect(screen.open).toEqual(["engineer", "producer"]);
  });

  it("asks each habit once, credits its live flow time, and a reload doesn't ask again", () => {
    const storage = withSave(V15);
    const shell = new Shell(storage, () => 5_000_000_000_000);
    shell.boot();
    const asked: string[] = [];
    const credited: number[] = [];
    for (let screen = shell.screen.value; screen.kind === "class"; screen = shell.screen.value) {
      asked.push(screen.habit.name);
      credited.push(screen.liveSeconds);
      shell.chooseClass(screen.habit.id, "engineer");
    }
    expect(asked).toEqual(["Habit A", "Habit B", "Habit C"]);
    const saved = stored(storage).state.records;
    expect(saved.habits.map((h) => h.habitClass)).toEqual(["engineer", "engineer", "engineer"]);
    // Live time only: the fixture's habits carry manual logs on top
    // (Habit A 6 301 s live + 1 200 s manual, B 3 901 + 2 700, C 3 601 + 0).
    expect(credited).toEqual([6_301, 3_901, 3_601]);
    expect(saved.classCredit.engineer).toBe(13_803);

    const reloaded = new Shell(storage, () => 5_000_000_100_000);
    reloaded.boot();
    expect(reloaded.screen.value.kind).toBe("ready");
  });

  it("refuses a class that isn't open and keeps asking", () => {
    const shell = new Shell(withSave(V15), () => 5_000_000_000_000);
    shell.boot();
    const screen = shell.screen.value;
    if (screen.kind !== "class") throw new Error("expected the class choice");
    shell.chooseClass(screen.habit.id, "roadie");
    const after = shell.screen.value;
    expect(after.kind === "class" && after.habit.id).toBe(screen.habit.id);
    expect(after.kind === "class" && after.error).toBeTruthy();
  });

  it("a fresh slot asks nothing and saves nothing until there is something to save", () => {
    const storage = withSave(null);
    const shell = new Shell(storage);
    shell.boot();
    expect(shell.screen.value.kind).toBe("ready");
    expect(shell.notice.value).toBeNull();
  });
});

// A v16 save whose nous no longer reads (ADR-0082's lost-money class).
function lostNous(): string {
  const s = fresh();
  giveHabit(s, "Habit A", "producer");
  const file = JSON.parse(serialize(s, 4_000_000_000_000)) as { state: { game: { nous: unknown } } };
  file.state.game.nous = "banana";
  return JSON.stringify(file);
}

describe("the recovery choice (ADR-0082)", () => {
  it("is offered for a save that requires it, naming the unreadable figures, and nothing is replaced", () => {
    const text = lostNous();
    const storage = withSave(text);
    const shell = new Shell(storage, () => 5_000_000_000_000);
    shell.boot();
    expect(shell.screen.value).toEqual({ kind: "recovery", raw: text, lost: ["game.nous"], error: null });
    expect(storage.getItem(STORAGE_KEY)).toBe(text);
  });

  it("declining keeps the save as it was, and the next load offers the same choice", () => {
    const text = lostNous();
    const storage = withSave(text);
    const shell = new Shell(storage, () => 5_000_000_000_000);
    shell.boot();
    shell.declineRecovery();
    expect(shell.screen.value.kind).toBe("ready");
    expect(storage.getItem(STORAGE_KEY)).toBe(text);
    const again = new Shell(storage, () => 5_000_000_100_000);
    again.boot();
    expect(again.screen.value.kind).toBe("recovery");
  });

  it("recovering keeps the original, saves the recovered game and reports what started at zero", () => {
    const text = lostNous();
    const storage = withSave(text);
    const shell = new Shell(storage, () => 5_000_000_000_000);
    shell.boot();
    shell.recover();
    expect(shell.screen.value.kind).toBe("ready");
    expect(storage.getItem(ORIGINAL_SAVE_KEY)).toBe(text);
    expect(shell.state.value.records.habits.map((h) => h.name)).toEqual(["Habit A"]);
    expect(shell.notice.value).toMatch(/game\.nous/);
    const again = new Shell(storage, () => 5_000_000_100_000);
    again.boot();
    expect(again.screen.value.kind).toBe("ready");
  });
});
