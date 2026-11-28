import { useState } from "preact/hooks";
import { className } from "../../engine/habits";
import type { GameState, Habit, HabitClass } from "../../engine/types";

// The Begin flow panel (issue #39):
//
//   Begin flow
//   Habit   [ Piano · Engineer ▾ ]   + New habit
//   Length  [25] [50] [90] [custom]
//                                        [Begin]
//
// It preselects the last-practised habit. `+ New habit` opens an inline
// name field and a picker of the open classes. A refusal is one quiet line.

const PRESETS = [25, 50, 90] as const;

function startable(habit: Habit): boolean {
  return !habit.archived && habit.habitClass !== null;
}

// The habit last practised (live or logged), else the active one, else the
// first that can start.
function lastPractised(state: GameState): string | null {
  const habits = state.records.habits.filter(startable);
  let best: { id: string; at: number } | null = null;
  for (const entry of state.records.practiceLog) {
    if (!habits.some((h) => h.id === entry.habitId)) continue;
    if (best === null || entry.at >= best.at) best = { id: entry.habitId, at: entry.at };
  }
  return best?.id ?? habits.find((h) => h.id === state.records.activeHabitId)?.id ?? habits[0]?.id ?? null;
}

interface Props {
  state: GameState;
  error: string | null;
  onCreate: (name: string, habitClass: HabitClass) => string | null;
  onBegin: (habitId: string | null, minutes: number) => void;
  onClose: () => void;
}

export function BeginFlow({ state, error, onCreate, onBegin, onClose }: Props) {
  const habits = state.records.habits.filter(startable);
  const [habitId, setHabitId] = useState<string | null>(() => lastPractised(state));
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [length, setLength] = useState<number | "custom">(25);
  const [custom, setCustom] = useState("");
  const chosen = habits.some((h) => h.id === habitId) ? habitId : (habits[0]?.id ?? null);

  const create = (habitClass: HabitClass) => {
    const id = onCreate(name, habitClass);
    if (id === null) return;
    setHabitId(id);
    setAdding(false);
    setName("");
  };

  const minutes = length === "custom" ? Number(custom.trim() === "" ? Number.NaN : custom) : length;

  return (
    <section class="shell-panel begin-flow" aria-labelledby="begin-flow-title">
      <h2 id="begin-flow-title" class="shell-title">
        Begin flow
      </h2>
      <div class="begin-row">
        <span class="eyebrow begin-key">Habit</span>
        <div class="begin-fields">
          {habits.length > 0 && (
            <select name="habit" aria-label="Habit" value={chosen ?? ""} onChange={(event) => setHabitId((event.currentTarget as HTMLSelectElement).value)}>
              {habits.map((habit) => (
                <option key={habit.id} value={habit.id}>
                  {`${habit.name} · ${className(habit.habitClass!)}`}
                </option>
              ))}
            </select>
          )}
          {!adding && (
            <button type="button" class="quiet" onClick={() => setAdding(true)}>
              + New habit
            </button>
          )}
        </div>
      </div>
      {adding && (
        <div class="begin-row">
          <span class="eyebrow begin-key">New</span>
          <div class="begin-fields">
            <input
              name="habit-name"
              aria-label="Habit name"
              placeholder="Name a practice"
              maxLength={40}
              value={name}
              onInput={(event) => setName((event.currentTarget as HTMLInputElement).value)}
            />
            <div class="begin-choices" data-class-pick="" role="group" aria-label="Class">
              {state.game.openClasses.map((habitClass) => (
                <button type="button" key={habitClass} onClick={() => create(habitClass)}>
                  {className(habitClass)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <div class="begin-row">
        <span class="eyebrow begin-key">Length</span>
        <div class="begin-fields begin-choices" role="group" aria-label="Length">
          {PRESETS.map((preset) => (
            <button type="button" key={preset} class="mono" aria-pressed={length === preset} onClick={() => setLength(preset)}>
              {String(preset)}
            </button>
          ))}
          <button type="button" aria-pressed={length === "custom"} onClick={() => setLength("custom")}>
            custom
          </button>
          {length === "custom" && (
            <input
              name="minutes"
              class="mono begin-minutes"
              aria-label="Minutes"
              type="number"
              inputMode="numeric"
              min={10}
              max={180}
              placeholder="10–180"
              value={custom}
              onInput={(event) => setCustom((event.currentTarget as HTMLInputElement).value)}
            />
          )}
        </div>
      </div>
      {error !== null && (
        <p class="shell-refusal" data-refusal="" role="status">
          {error}
        </p>
      )}
      <div class="begin-actions">
        <button type="button" class="quiet" onClick={onClose}>
          Back
        </button>
        <button type="button" class="main-switch" onClick={() => onBegin(chosen, minutes)}>
          Begin
        </button>
      </div>
    </section>
  );
}
