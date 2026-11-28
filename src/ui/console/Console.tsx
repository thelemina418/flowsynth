import { affordable, channelFaders, consoleShown, costOf, faderName, levelOf, type FaderId } from "../../engine/console";
import { categoryOf } from "../../engine/modules";
import { fmtCost } from "../../engine/num";
import type { GameState } from "../../engine/types";

// The console (spec chunk 06, issue #58; philosophy.md, Look: "Upgrades
// are a console"): a strip of faders below the board, drawn from the
// engine's console readers alone, from the first time any fader is
// affordable on. Each fader is a vertical throw whose fill is its level
// against the highest level on the strip, with a `name · level · next
// cost` readout beneath at a reserved width (ADR-0031). Hue is category
// only; the state grammar marks affordability (clear outline) and
// everything else (muted). Outside upgrade mode it is read-only and every
// fader is muted. On a phone the strip scrolls inside itself.

// The widest figures a readout reserves: a two-digit level and an
// eight-character cost (`999 999`, `9.99e99`, `e1.2e308`'s neighbours).
const LEVEL_CH = 2;
const COST_CH = 8;
const SEPARATORS_CH = 6;

interface ConsoleProps {
  state: GameState;
  // Upgrade mode: purchases are open.
  live: boolean;
  onBuy: (fader: FaderId, max: boolean) => void;
}

export function Console({ state, live, onBuy }: ConsoleProps) {
  if (!consoleShown(state)) return null;
  const faders = channelFaders(state);
  const highest = Math.max(0, ...faders.map((fader) => levelOf(state, fader)));
  return (
    <section class="console" data-console="" data-live={live ? "" : undefined} aria-label="Console">
      <div class="console-section" data-section="channels">
        {faders.map((fader) => (
          <Fader key={fader.type} state={state} fader={fader} highest={highest} live={live} onBuy={onBuy} />
        ))}
      </div>
    </section>
  );
}

interface FaderProps {
  state: GameState;
  fader: FaderId;
  highest: number;
  live: boolean;
  onBuy: (fader: FaderId, max: boolean) => void;
}

function Fader({ state, fader, highest, live, onBuy }: FaderProps) {
  const level = levelOf(state, fader);
  const name = faderName(fader);
  const open = live && affordable(state, fader);
  const fill = highest === 0 ? 0 : Math.round((level / highest) * 100);
  return (
    <button
      type="button"
      class="fader"
      data-fader={fader.type}
      data-category={categoryOf(fader.type)}
      data-muted={open ? undefined : ""}
      disabled={!open}
      onClick={(event) => onBuy(fader, event.shiftKey)}
    >
      <span class="fader-throw" aria-hidden="true">
        <span class="fader-fill" style={{ height: `${fill}%` }} />
      </span>
      <span class="fader-readout mono" style={{ minWidth: `${name.length + SEPARATORS_CH + LEVEL_CH + COST_CH}ch` }}>
        {`${name} · ${level} · ${fmtCost(costOf(state, fader))}`}
      </span>
    </button>
  );
}
