import { disclosureOf, goalOf } from "../../engine/goal";
import { hasUnseen } from "../../engine/encyclopedia";
import { grantsOf } from "../../engine/levels";
import { unplacedOf } from "../../engine/placement";
import type { Shell } from "./shell";
import { Almanac } from "./Almanac";
import { Encyclopedia } from "./Encyclopedia";
import { BeginFlow } from "./BeginFlow";
import { ClassChoice } from "./ClassChoice";
import { FlowScreen } from "./FlowScreen";
import { HonestyReport } from "./HonestyReport";
import { Summary } from "./Summary";
import { Breather } from "./Breather";
import { BreatherResult } from "./BreatherResult";
import { breatherMinutes } from "./readouts";
import { RecoveryChoice } from "./RecoveryChoice";
import { downloadSave } from "./download";
import { Stage } from "../board/Stage";
import { Console } from "../console/Console";
import { prestigeGainOf } from "../../engine/era";
import { PrestigeConfirm } from "./PrestigeConfirm";

// The shell's one surface (issue #21): the question owed on first load,
// and once nothing is owed, the board and its tray (issues #24, #25),
// `Begin flow` and its panel, and the flow screen (issue #39), and at End
// the honesty report and the summary (issue #40), and the breather's calm
// screen and result (issue #41). Upgrade mode carries the
// Goal line; the chips and doors wait for the first completed session
// (issue #42). The Encyclopedia door carries one quiet unseen-dot (#44).
export function App({ shell }: { shell: Shell }) {
  const screen = shell.screen.value;
  const notice = shell.notice.value;
  const state = shell.state.value;
  const game = state.game;
  const grants = grantsOf(state);
  const shown = disclosureOf(state);
  const goal = goalOf(state);
  // The Prestige Goal opens its confirmation (issue #62).
  const prestigeGoal = goal === "Prestige" && game.mode === "upgrade";
  const arete = game.prestiges > 0 ? game.arete : null;
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
          arrived={grants.arrived}
          arrivedCables={grants.arrivedCables}
          unplaced={unplacedOf(state)}
          chips={shown.chips}
          goal={goal}
          onGoal={prestigeGoal ? () => shell.openPrestige() : undefined}
          arete={arete}
          placing={shell.placing}
          inspected={shell.inspected}
          console={<Console state={state} live={game.mode === "upgrade"} onBuy={(fader, max) => shell.buyFader(fader, max)} />}
        />
      )}
      {screen.kind === "ready" && prestigeGoal && shell.confirmingPrestige.value && (
        <PrestigeConfirm gain={prestigeGainOf(state)} onCancel={() => shell.cancelPrestige()} onConfirm={() => shell.prestige()} />
      )}
      {screen.kind === "ready" && (
        <div class="shell-transport">
          {/* The Almanac and Encyclopedia doors (issues #43, #44), from the
              first completed session on (issue #42). */}
          {shown.doors && (
            <nav class="shell-doors" data-doors="" aria-label="Doors">
              <button type="button" class="quiet" data-door="almanac" onClick={() => shell.openAlmanac()}>
                Almanac
              </button>
              <button type="button" class="quiet encyclopedia-door" data-door="encyclopedia" onClick={() => shell.openEncyclopedia()}>
                Encyclopedia
                {hasUnseen(state) && <span class="encyclopedia-dot" data-unseen="" aria-label="Unseen entries" />}
              </button>
            </nav>
          )}
          {game.breather.banked && (
            <button type="button" onClick={() => shell.takeBreather()}>
              {`Take breather · ${breatherMinutes(game.breather.banked.seconds)}`}
            </button>
          )}
          <button type="button" class="main-switch" onClick={() => shell.openBegin()}>
            Begin flow
          </button>
        </div>
      )}
      {screen.kind === "begin" && (
        <BeginFlow
          state={state}
          error={screen.error}
          onCreate={(name, habitClass) => shell.createHabit(name, habitClass)}
          onBegin={(habitId, minutes) => shell.beginFlow(habitId, minutes)}
          onClose={() => shell.closePanel()}
        />
      )}
      {screen.kind === "almanac" && <Almanac shell={shell} error={screen.error} />}
      {screen.kind === "encyclopedia" && <Encyclopedia shell={shell} entry={screen.entry} />}
      {screen.kind === "flow" && <FlowScreen shell={shell} error={screen.error} />}
      {screen.kind === "honesty" && <HonestyReport session={screen.session} error={screen.error} onAnswer={(outcome) => shell.answerHonesty(outcome)} />}
      {screen.kind === "summary" && <Summary summary={screen.summary} onDismiss={() => shell.dismissSummary()} />}
      {screen.kind === "breather" && <Breather running={screen.running} onEndEarly={() => shell.endBreatherEarly()} />}
      {screen.kind === "breather-result" && <BreatherResult result={screen.result} onDismiss={() => shell.dismissBreatherResult()} />}
    </div>
  );
}
