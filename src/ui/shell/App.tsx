import type { Shell } from "./shell";
import { ClassChoice } from "./ClassChoice";
import { RecoveryChoice } from "./RecoveryChoice";
import { downloadSave } from "./download";
import { Board } from "../board/Board";
import { NousReadout } from "../board/NousReadout";

// The shell's one surface (issue #21): the question owed on first load,
// and once nothing is owed, the board (issue #24).
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
        <section class="stage">
          <NousReadout nous={game.nous} />
          <Board board={game.board} />
        </section>
      )}
    </div>
  );
}
