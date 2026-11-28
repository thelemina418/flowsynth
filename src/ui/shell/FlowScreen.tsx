import { useState } from "preact/hooks";
import { activeHabit } from "../../engine/habits";
import { foughtWall } from "../../engine/fought";
import { grantsOf } from "../../engine/levels";
import { Stage } from "../board/Stage";
import { Console } from "../console/Console";
import { NousReadout } from "../board/NousReadout";
import { Notes } from "./Notes";
import { clockCaption, clockFigure, classLine, hpRow, readyCount } from "./readouts";
import type { Shell } from "./shell";

// The flow screen (issue #39), flow and paused:
//
//                      ⬡ board (resonance outlines pulse, beads run along cables)
//   ν 48 210            Engineer · Lv 1 ▕██████░░░▏ 1.1h / 1.5h
//   Shale  ▕███████░░░▏ 412 / 600 HP                 Ready · 3
//                          31:04   [Pause] [End]
//
// The HP row is the fought wall's (issue #50), absent while none is
// fought; it moves to the next wall when one falls, and adds no control.
// No tray, Goal or doors, and nothing prompts the player. Board clicks
// inspect read-only, and the console (issue #58) is drawn muted. The clock and the Notes door are the old console's.
export function FlowScreen({ shell, error }: { shell: Shell; error: string | null }) {
  const [notes, setNotes] = useState(false);
  const state = shell.state.value;
  const game = state.game;
  const session = game.session;
  const paused = game.mode === "paused";
  const line = classLine(state, activeHabit(state));
  const grants = grantsOf(state);
  const fought = foughtWall(game.board, game.rates);
  const hp = fought && hpRow(fought);
  return (
    <div class="flow-screen">
      <Stage
        nous={game.nous}
        board={game.board}
        rates={game.rates}
        flowing={game.mode === "flow"}
        arrived={grants.arrived}
        arrivedCables={grants.arrivedCables}
        unplaced={{ oscillator: 0, modulator: 0, arm: 0 }}
        chips={false}
        placing={shell.placing}
        inspected={shell.inspected}
        tray={false}
        console={<Console state={state} live={false} onBuy={() => undefined} />}
        readouts={
          <div class="flow-readouts">
            <NousReadout nous={game.nous} arete={game.prestiges > 0 ? game.arete : null} />
            <div class="flow-right">
              {line !== null && (
                <p class="flow-class mono" data-class-line="">
                  {line}
                </p>
              )}
              <div class="flow-fight">
                {fought && hp && (
                  <p class="flow-hp mono" data-hp-row="" data-cell={`${fought.cell.q},${fought.cell.r}`}>
                    <span class="hp-name">{hp.name}</span> <span class="hp-bar">{hp.bar}</span>{" "}
                    <span class="hp-figures" style={{ minWidth: `${hp.width}ch` }}>
                      {hp.figures}
                    </span>
                  </p>
                )}
                <p class="flow-ready mono" data-ready="">{`Ready · ${readyCount(state)}`}</p>
              </div>
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
