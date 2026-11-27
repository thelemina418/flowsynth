import { formatDuration } from "../../engine/clock";
import type { Habit, HabitClass } from "../../engine/types";

// The class choice (issue #21): one habit at a time, only open classes.
// Each class reads as name · its craft (GLOSSARY: Habit class).
const CLASSES: Record<HabitClass, { name: string; craft: string }> = {
  engineer: { name: "Engineer", craft: "Oscillators" },
  producer: { name: "Producer", craft: "Modulators and Cables" },
  mixer: { name: "Mixer", craft: "Effects" },
  roadie: { name: "Roadie", craft: "Arms" },
};

interface Props {
  habit: Habit;
  liveSeconds: number;
  open: HabitClass[];
  error: string | null;
  onChoose: (habitClass: HabitClass) => void;
}

export function ClassChoice({ habit, liveSeconds, open, error, onChoose }: Props) {
  return (
    <section class="shell-panel" aria-labelledby="class-choice-habit">
      <p class="eyebrow">Habit class</p>
      <h2 id="class-choice-habit" class="shell-title">
        {habit.name}
        {habit.archived && <span class="muted"> · archived</span>}
      </h2>
      <p class="mono">{formatDuration(liveSeconds)} credited flow</p>
      <div class="shell-actions" role="group" aria-label={`Class for ${habit.name}`}>
        {open.map((habitClass) => (
          <button type="button" key={habitClass} onClick={() => onChoose(habitClass)}>
            {CLASSES[habitClass].name}
            <span class="muted"> · {CLASSES[habitClass].craft}</span>
          </button>
        ))}
      </div>
      {error !== null && <p class="shell-error" role="alert">{error}</p>}
    </section>
  );
}
