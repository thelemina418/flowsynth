import { useState } from "preact/hooks";
import { dayStrip } from "../../engine/almanac";
import type { Action, ApplyResult } from "../../engine/apply";
import { className } from "../../engine/habits";
import { classLevel } from "../../engine/levels";
import type { GameState, Habit, HabitClass } from "../../engine/types";
import { hours } from "./readouts";

// The Almanac's habits surface (issue #43), from the old console's habit
// face (`8ecaeac^` focus.ts): each habit reads `Piano · Engineer Lv 2 ·
// 14.2h` (its credited time, live and manual, with its class's level),
// then its last 7 and 30 local days as bar strips. Create, rename,
// archive, re-attune and log practice, between sessions only. No habit
// colours are drawn: hue means category.

type Act = (action: Action | ((now: number) => Action)) => ApplyResult;

// One open form per row at a time.
type Form = "rename" | "reattune" | "log" | null;

function Strip({ seconds, days }: { seconds: number[]; days: 7 | 30 }) {
  const most = Math.max(...seconds);
  return (
    <div class="day-strip" data-strip={String(days)} aria-label={`Last ${days} days`} role="img">
      {seconds.map((value, index) => (
        <span key={index} class="day-bar" data-day="" data-seconds={String(value)} data-empty={value > 0 ? undefined : ""}>
          <i style={{ height: most > 0 ? `${(value / most) * 100}%` : "0" }} />
        </span>
      ))}
    </div>
  );
}

function HabitRow({ state, habit, now, onAct }: { state: GameState; habit: Habit; now: number; onAct: Act }) {
  const [form, setForm] = useState<Form>(null);
  const [name, setName] = useState(habit.name);
  const [minutes, setMinutes] = useState("");
  const habitClass = habit.habitClass!;
  const done = (result: ApplyResult) => {
    if (result.ok) setForm(null);
  };
  const toggle = (next: Form) => {
    setForm(form === next ? null : next);
    setName(habit.name);
    setMinutes("");
  };
  const others = state.game.openClasses.filter((c) => c !== habitClass);
  return (
    <div class="habit-row" data-habit-row="">
      <span class="habit-line mono" data-habit-line="">
        {`${habit.name} · ${className(habitClass)} Lv ${classLevel(state, habitClass).level} · ${hours(habit.seconds)}`}
      </span>
      <div class="habit-strips">
        <span class="eyebrow">7d</span>
        <Strip seconds={dayStrip(state, habit.id, 7, now)} days={7} />
        <span class="eyebrow">30d</span>
        <Strip seconds={dayStrip(state, habit.id, 30, now)} days={30} />
      </div>
      <div class="habit-actions">
        <button type="button" class="quiet small" aria-pressed={form === "log"} onClick={() => toggle("log")}>
          Log practice
        </button>
        <button type="button" class="quiet small" aria-pressed={form === "rename"} onClick={() => toggle("rename")}>
          Rename
        </button>
        {others.length > 0 && (
          <button type="button" class="quiet small" aria-pressed={form === "reattune"} onClick={() => toggle("reattune")}>
            Re-attune
          </button>
        )}
        <button type="button" class="quiet small" onClick={() => onAct({ type: "archiveHabit", id: habit.id })}>
          Archive
        </button>
      </div>
      {form === "log" && (
        <div class="habit-form">
          <input
            name="log-minutes"
            class="mono"
            aria-label="Minutes"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="min"
            value={minutes}
            onInput={(event) => setMinutes((event.currentTarget as HTMLInputElement).value)}
          />
          <button type="button" class="small" onClick={() => done(onAct((now) => ({ type: "logPractice", habitId: habit.id, minutes: Number(minutes), now })))}>
            Log
          </button>
        </div>
      )}
      {form === "rename" && (
        <div class="habit-form">
          <input name="rename" aria-label="Habit name" maxLength={40} value={name} onInput={(event) => setName((event.currentTarget as HTMLInputElement).value)} />
          <button type="button" class="small" onClick={() => done(onAct({ type: "renameHabit", id: habit.id, name }))}>
            Save
          </button>
        </div>
      )}
      {form === "reattune" && (
        <div class="habit-form" data-reattune="" role="group" aria-label="Class">
          {others.map((other) => (
            <button type="button" key={other} class="small" onClick={() => done(onAct({ type: "reattuneHabit", habitId: habit.id, habitClass: other }))}>
              {className(other)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AlmanacHabits({ state, now, onAct }: { state: GameState; now: number; onAct: Act }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  // A habit awaiting its class is asked on the shell's class screen first.
  const habits = state.records.habits.filter((h) => !h.archived && h.habitClass !== null);
  const create = (habitClass: HabitClass) => {
    if (!onAct({ type: "createHabit", name, habitClass }).ok) return;
    setAdding(false);
    setName("");
  };
  return (
    <div class="almanac-surface">
      {habits.map((habit) => (
        <HabitRow key={habit.id} state={state} habit={habit} now={now} onAct={onAct} />
      ))}
      {adding ? (
        <div class="habit-form" data-new-habit="">
          <input
            name="new-habit-name"
            aria-label="Habit name"
            placeholder="Name a practice"
            maxLength={40}
            value={name}
            onInput={(event) => setName((event.currentTarget as HTMLInputElement).value)}
          />
          {state.game.openClasses.map((habitClass) => (
            <button type="button" key={habitClass} class="small" onClick={() => create(habitClass)}>
              {className(habitClass)}
            </button>
          ))}
        </div>
      ) : (
        <div class="habit-actions">
          <button type="button" class="quiet" onClick={() => setAdding(true)}>
            + New habit
          </button>
        </div>
      )}
    </div>
  );
}
