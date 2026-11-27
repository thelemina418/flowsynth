import type { Shell } from "./shell";
import { ClassChoice } from "./ClassChoice";
import { RecoveryChoice } from "./RecoveryChoice";
import { downloadSave } from "./download";
import { Stage } from "../board/Stage";

// The shell's one surface (issue #21): the question owed on first load,
// and once nothing is owed, the board and its tray (issues #24, #25).
export function App({ shell }: { shell: Shell }) {
  const screen = shell.screen.value;
  const notice = shell.notice.value;
  const game = shell.state.value.game;
  return (
    <div class="shell">
      <h1 class="sr-only">FlowSynth</h1>
      {notice !== null && <p class="shell-notice mono" role="status">{notice}</p>}
      {screen.kind === "recovery" && (
        <RecoveryChoice
          lost={screen.lost}
          error={screen.error}
          onRecover={() => shell.recover()}
          onDownload={() => downloadSave(screen.raw)}
          onDecline={() => shell.declineRecovery()}
        />
      )}
      {screen.kind === "class" && (
        <ClassChoice
          habit={screen.habit}
          liveSeconds={screen.liveSeconds}
          open={screen.open}
          error={screen.error}
          onChoose={(habitClass) => shell.chooseClass(screen.habit.id, habitClass)}
        />
      )}
      {screen.kind === "ready" && (
        <Stage
          nous={game.nous}
          board={game.board}
          rates={game.rates}
          flowing={game.mode === "flow"}
          arrived={game.arrived}
          arrivedCables={game.arrivedCables}
          placing={shell.placing}
          inspected={shell.inspected}
        />
      )}
    </div>
  );
}
