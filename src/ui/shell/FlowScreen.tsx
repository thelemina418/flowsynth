import { useState } from "preact/hooks";
import { activeHabit } from "../../engine/habits";
import { grantsOf } from "../../engine/levels";
import { Stage } from "../board/Stage";
import { NousReadout } from "../board/NousReadout";
import { Notes } from "./Notes";
import { clockCaption, clockFigure, classLine, readyCount } from "./readouts";
import type { Shell } from "./shell";

// The flow screen (issue #39), flow and paused:
//
//                      ⬡ board (resonance outlines pulse, beads run along cables)
//   ν 48 210            Engineer · Lv 1 ▕██████░░░▏ 1.1h / 1.5h
//                                                    Ready · 3
//                          31:04   [Pause] [End]
//
// No tray, Goal or doors, and nothing prompts the player. Board clicks
// inspect read-only. The clock and the Notes door are the old console's.
export function FlowScreen({ shell, error }: { shell: Shell; error: string | null }) {
  const [notes, setNotes] = useState(false);
  const state = shell.state.value;
  const game = state.game;
  const session = game.session;
  const paused = game.mode === "paused";
  const line = classLine(state, activeHabit(state));
  const grants = grantsOf(state);
  return (
    <div class="flow-screen">
      <Stage
        nous={game.nous}
        board={game.board}
        rates={game.rates}
        flowing={game.mode === "flow"}
        arrived={grants.arrived}
        arrivedCables={grants.arrivedCables}
        unplaced={{ oscillator: 0, modulator: 0 }}
        chips={false}
        placing={shell.placing}
        inspected={shell.inspected}
        tray={false}
        readouts={
          <div class="flow-readouts">
            <NousReadout nous={game.nous} />
            <div class="flow-right">
              {line !== null && (
                <p class="flow-class mono" data-class-line="">
                  {line}
                </p>
              )}
              <p class="flow-ready mono" data-ready="">{`Ready · ${readyCount(state)}`}</p>
            </div>
          </div>
        }
      />
      {session && (
        <div class="flow-console" data-paused={paused ? "" : undefined}>
          <button type="button" class="quiet" aria-pressed={notes} onClick={() => setNotes(!notes)}>
            Notes
          </button>
          <div class="flow-clock">
            <p class="session-clock mono" role="timer">
              {clockFigure(session)}
            </p>
            <p class="clock-caption mono">{clockCaption(session, paused)}</p>
          </div>
          <button type="button" onClick={() => (paused ? shell.resume() : shell.pause())}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button type="button" class="main-switch" onClick={() => shell.end()}>
            End
          </button>
        </div>
      )}
      {error !== null && (
        <p class="shell-refusal" data-refusal="" role="status">
          {error}
        </p>
      )}
      {notes && <Notes state={state} onCapture={(text) => shell.writeNote(text)} onClose={() => setNotes(false)} />}
    </div>
  );
}
