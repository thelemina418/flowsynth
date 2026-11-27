import type { Shell } from "./shell";
import { ClassChoice } from "./ClassChoice";
import { RecoveryChoice } from "./RecoveryChoice";
import { downloadSave } from "./download";

// The shell's one surface (issue #21): the question owed on first load,
// or nothing. There are no game surfaces yet; they arrive from chunk 02.
export function App({ shell }: { shell: Shell }) {
  const screen = shell.screen.value;
  const notice = shell.notice.value;
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
    </div>
  );
}
