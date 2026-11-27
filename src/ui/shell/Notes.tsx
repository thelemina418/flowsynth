import { useEffect, useRef, useState } from "preact/hooks";
import { formatClock } from "../../engine/clock";
import { activeHabit } from "../../engine/habits";
import { isInFlowNote } from "../../engine/notes";
import { habitRecordName } from "../../engine/records";
import type { GameState, NoteEntry } from "../../engine/types";

// The Notes door's panel, ported from the old console (`8ecaeac^`
// focus.ts, the notes modal): CAPTURE leads, LOGGED carries the stream
// newest first with no cap. During a session the live tag shows the
// habit the note will carry. Ctrl/⌘+Enter captures, Escape closes.

type Face = "capture" | "logged";

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

// `Sep 19 · S12 · 14:03`, or `… · between sessions`.
function stamp(note: NoteEntry): string {
  return `${note.at > 0 ? `${DATE.format(note.at)} · ` : ""}${isInFlowNote(note) ? `S${note.sessionId} · ${formatClock(note.atElapsed)}` : "between sessions"}`;
}

interface Props {
  state: GameState;
  onCapture: (text: string) => { ok: boolean; reason?: string };
  onClose: () => void;
}

export function Notes({ state, onCapture, onClose }: Props) {
  const [face, setFace] = useState<Face>("capture");
  const [draft, setDraft] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const session = state.game.session;
  const habit = session !== null ? activeHabit(state) : null;

  useEffect(() => {
    if (face === "capture") composer.current?.focus();
  }, [face]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const capture = () => {
    const result = onCapture(draft);
    setRefusal(result.ok ? null : (result.reason ?? null));
    if (result.ok) setDraft("");
    composer.current?.focus();
  };

  const stream = [...state.records.notes].reverse();
  return (
    <section class="shell-panel notes-panel" aria-label="Notes">
      <div class="notes-head">
        <div class="notes-tabs" role="group" aria-label="Notes faces">
          {(["capture", "logged"] as const).map((key) => (
            <button type="button" key={key} class="small" aria-pressed={face === key} onClick={() => setFace(key)}>
              {key === "capture" ? "CAPTURE" : "LOGGED"}
            </button>
          ))}
        </div>
        <span class="mono muted small">{session !== null ? `session ${state.records.sessionsCompleted + 1}` : "stream"}</span>
        <button type="button" class="quiet small" onClick={onClose}>
          Close
        </button>
      </div>
      {face === "capture" ? (
        <div class="notes-capture">
          <textarea
            ref={composer}
            class="note-composer"
            placeholder="What are you noticing?"
            maxLength={2000}
            rows={3}
            value={draft}
            onInput={(event) => setDraft((event.currentTarget as HTMLTextAreaElement).value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                capture();
              }
            }}
          />
          <div class="notes-actions">
            {habit && <span class="mono muted small">· {habit.name.toUpperCase()}</span>}
            <button type="button" class="primary" onClick={capture}>
              Capture note
            </button>
          </div>
          {refusal !== null && (
            <p class="shell-refusal" data-refusal="" role="status">
              {refusal}
            </p>
          )}
        </div>
      ) : (
        stream.length > 0 && (
          <div class="note-list">
            {stream.map((note) => (
              <div class="note-entry" key={note.id}>
                <span class="mono muted small">
                  {stamp(note)}
                  {note.habitId !== null && ` · ${habitRecordName(state, note.habitId)}`}
                </span>
                <p>{note.text}</p>
              </div>
            ))}
          </div>
        )
      )}
    </section>
  );
}
