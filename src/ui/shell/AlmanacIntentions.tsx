import { useState } from "preact/hooks";
import type { Action, ApplyResult } from "../../engine/apply";
import { activeIntentionOf, intentionRequiredSeconds, pendingIntentionsOf, intentionTargetSummary } from "../../engine/intentions";
import type { GameState, Habit, Intention, IntentionSchedule } from "../../engine/types";

// The Almanac's Intentions surface (issue #43), from the old console's
// goal rows (`8ecaeac^` focus.ts): one per habit, reading `Piano · 40 / 60
// min today` or `this week`. Create, edit and delete between sessions; a
// completed one is shown engraved. The engine's Intention rules apply
// unchanged. A migration's carried-over rows ask which one to keep.

type Act = (action: Action | ((now: number) => Action)) => ApplyResult;
type Kind = IntentionSchedule["kind"];

const PERIOD: Record<Kind, string> = { daily: " today", weekly: " this week", once: "" };

// Minutes truncated, held at the target once it's met.
function line(habit: Habit, intention: Intention): string {
  const required = intentionRequiredSeconds(intention);
  const progress = Math.floor(Math.min(intention.progressSeconds, required) / 60 + 1e-9);
  return `${habit.name} · ${progress} / ${intention.condition.minutes} min${PERIOD[intention.schedule.kind]}`;
}

function IntentionForm({ intention, onSet }: { intention: Intention | undefined; onSet: (minutes: number, schedule: Kind) => void }) {
  const [minutes, setMinutes] = useState(intention ? String(intention.condition.minutes) : "");
  const [schedule, setSchedule] = useState<Kind>(intention?.schedule.kind ?? "daily");
  return (
    <div class="habit-form">
      <input
        name="intention-minutes"
        class="mono"
        aria-label="Minutes"
        type="number"
        inputMode="numeric"
        min={1}
        max={1440}
        placeholder="min"
        value={minutes}
        onInput={(event) => setMinutes((event.currentTarget as HTMLInputElement).value)}
      />
      <select name="intention-schedule" aria-label="Period" value={schedule} onChange={(event) => setSchedule((event.currentTarget as HTMLSelectElement).value as Kind)}>
        <option value="daily">today</option>
        <option value="weekly">this week</option>
        {intention?.schedule.kind === "once" && <option value="once">once</option>}
      </select>
      <button type="button" class="small" onClick={() => onSet(Number(minutes), schedule)}>
        Set
      </button>
    </div>
  );
}

function HabitIntention({ state, habit, onAct }: { state: GameState; habit: Habit; onAct: Act }) {
  const [editing, setEditing] = useState(false);
  const pending = pendingIntentionsOf(state, habit.id);
  const intention = pending.length > 0 ? undefined : activeIntentionOf(state, habit.id);
  const landed = (result: ApplyResult) => {
    if (result.ok) setEditing(false);
  };
  if (pending.length > 0) {
    return (
      <div class="intention-row" data-intention-habit={habit.id}>
        <span class="mono muted small">{`${habit.name} · carried over · keep one`}</span>
        {pending.map((row) => (
          <div class="habit-form" key={row.id}>
            <span class="mono">{intentionTargetSummary(row)}</span>
            <button type="button" class="small" onClick={() => onAct({ type: "retainIntention", id: row.id })}>
              Keep
            </button>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div class="intention-row" data-intention-habit={habit.id}>
      {intention ? (
        <div class="intention-head">
          <span class="intention-line mono" data-intention="" data-complete={intention.completed ? "" : undefined}>
            {line(habit, intention)}
          </span>
          <button type="button" class="quiet small" aria-pressed={editing} onClick={() => setEditing(!editing)}>
            Edit
          </button>
          <button type="button" class="quiet small" onClick={() => onAct({ type: "deleteIntention", id: intention.id })}>
            Delete
          </button>
        </div>
      ) : (
        <div class="intention-head">
          <span class="mono muted">{habit.name}</span>
          <button type="button" class="quiet small" aria-pressed={editing} onClick={() => setEditing(!editing)}>
            + Intention
          </button>
        </div>
      )}
      {editing && (
        <IntentionForm
          intention={intention}
          onSet={(minutes, schedule) =>
            landed(
              onAct((now) =>
                intention
                  ? { type: "editIntention", id: intention.id, minutes, schedule, now }
                  : { type: "createIntention", habitId: habit.id, minutes, schedule, now },
              ),
            )
          }
        />
      )}
    </div>
  );
}

export function AlmanacIntentions({ state, onAct }: { state: GameState; onAct: Act }) {
  const habits = state.records.habits.filter((h) => !h.archived && h.habitClass !== null);
  return (
    <div class="almanac-surface">
      {habits.map((habit) => (
        <HabitIntention key={habit.id} state={state} habit={habit} onAct={onAct} />
      ))}
    </div>
  );
}
