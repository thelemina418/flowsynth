# Save fixtures

## `v15-migration.json`

The v15 save the one-time v15 → v16 migration test reads (issue #19,
`src/engine/save-v15-migration.test.ts`).

**Provenance.** No exported v15 save existed on the maintainer's machine, so
this one was written by the retired build's own engine and save code at
commit `424a224` (`SAVE_VERSION` 15), not hand-made. The script below ran in
a `git worktree` of that commit (`npx vite-node tools/make-v15-fixture.ts
<out.json>`); its output is committed byte for byte and frozen.

**Text.** Every name and text field is a placeholder ("Habit A",
"Placeholder note …", "Placeholder reflection."), so there was nothing
personal to scrub. Numbers, timestamps and structure are the engine's own.

**What it holds.** Three habits (one archived, two recoloured), eight
practice-log entries (live and manual), seven session records (planned,
open-ended and unstructured; three with honesty events, three with
reflections, some followed by breathers), nine Notes (in flow and between
sessions), three Intentions (daily, weekly, once), and a collection of four
modules: one placed, three unplaced.

```ts
import { writeFileSync } from "node:fs";
import { createInitialState } from "../src/engine/state";
import { createHabit, archiveHabit, selectHabit, addPracticeLog, setHabitColor } from "../src/engine/habits";
import { createGoal } from "../src/engine/goals";
import { writeNote } from "../src/engine/notes";
import { startSession, endSession, recordSummaryReflection, dismissSummary, buyShelfModule, returnModule, upgradeModule, startBreather, endBreather } from "../src/engine/actions";
import { applyGap, resolveHonestyReport } from "../src/engine/trust";
import { advanceBreather } from "../src/engine/advance";
import { serialize } from "../src/engine/save";

let seed = 7;
const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const must = (r: { ok: boolean; reason?: string }, what: string) => { if (!r.ok) throw new Error(`${what}: ${r.reason}`); };

const s = createInitialState();
const DAY = 86_400_000;
let now = Date.UTC(2026, 9, 5, 15, 0, 0); // 2026-10-05

const a = createHabit(s, "Habit A").habit!;
const b = createHabit(s, "Habit B").habit!;
const c = createHabit(s, "Habit C").habit!;
must(setHabitColor(s, b.id, "cyan"), "color");
must(setHabitColor(s, c.id, "amber"), "color");
must(createGoal(s, { habitId: a.id, minutes: 30, schedule: "daily", now }), "goal a");
must(createGoal(s, { habitId: b.id, minutes: 120, schedule: "weekly", now }), "goal b");
must(createGoal(s, { habitId: c.id, minutes: 45, schedule: "once", now }), "goal c");
must(writeNote(s, "Placeholder note between sessions.", now), "note");

function session(habit: string | null, target: number | null, minutes: number, away?: { at: number; seconds: number; outcome: "missed" | "planned" | "full" }, reflect?: string) {
  must(selectHabit(s, habit), "select");
  const start = now;
  must(startSession(s, target, now), "start");
  let elapsed = 0;
  const total = minutes * 60;
  while (elapsed < total) {
    const step = Math.min(60, total - elapsed);
    if (away && elapsed === away.at) {
      applyGap(s, away.seconds, "away", 0, rng);
      applyGap(s, 1, "visible", 0, rng);
      now += (away.seconds + 1) * 1000;
      if (s.session!.accounting.poolSeconds > 0) must(resolveHonestyReport(s, away.outcome, rng), "honesty");
    }
    applyGap(s, step, "visible", 0, rng);
    elapsed += step;
    now += step * 1000;
    if (elapsed === 600) must(writeNote(s, `Placeholder in-flow note ${s.notes.length + 1}.`, now), "flow note");
  }
  must(endSession(s, now), "end");
  if (reflect) must(recordSummaryReflection(s, { text: reflect, slider: 4 }), "reflect");
  if (s.summary && s.summary.breatherAllowance > 0 && rng() < 0.5) {
    must(startBreather(s, now), "breather");
    advanceBreather(s, Math.min(120, s.breather!.allowanceSeconds), rng);
    now += 120_000;
    must(endBreather(s), "end breather");
  } else if (s.summary && !s.summary.seen) must(dismissSummary(s), "dismiss");
  void start;
}

session(a.id, 25 * 60, 25, undefined, "Placeholder reflection.");
now += DAY;
session(a.id, 25 * 60, 40, { at: 1200, seconds: 900, outcome: "full" });
must(addPracticeLog(s, b.id, 45, now + 3_600_000), "manual log");
now += DAY;
session(b.id, null, 30, { at: 900, seconds: 600, outcome: "missed" }, "Placeholder reflection.");
now += DAY;
session(null, 20 * 60, 20);
now += DAY;
session(c.id, 50 * 60, 50, { at: 2400, seconds: 1200, outcome: "planned" });
must(addPracticeLog(s, a.id, 20, now + 7_200_000), "manual log 2");
now += 2 * DAY;
session(b.id, 30 * 60, 35, undefined, "Placeholder reflection.");
must(writeNote(s, "Placeholder note after a session.", now), "note");

// The board: buy what the earnings allow, level a module, unplace one.
for (const type of ["generator", "infusor", "forge"] as const) buyShelfModule(s, type);
for (let i = 0; i < 5; i++) upgradeModule(s, s.modules[0]!.id);
const placed = s.modules.filter((m) => m.pos !== null);
if (placed.length > 1) must(returnModule(s, placed[placed.length - 1]!.id), "return");

must(archiveHabit(s, c.id), "archive");
now += DAY;
session(a.id, 25 * 60, 25);

const text = serialize(s, now);
writeFileSync(process.argv[2]!, text + "\n");
console.log("modules", s.modules.length, s.modules.map((m) => `${m.type}:${m.pos ? "placed" : "unplaced"}`).join(" "));
console.log("habits", s.habits.length, "log", s.practiceLog.length, "records", s.sessionRecords.length, "notes", s.notes.length, "goals", s.goals.length, "nous", s.nous, "bytes", text.length);
```
