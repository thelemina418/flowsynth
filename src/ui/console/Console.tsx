import { affordable, atCap, busesShown, busFaders, channelFaders, consoleShown, costOf, faderEffect, faderName, levelOf, masterFaders, masterShown, type FaderId } from "../../engine/console";
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
// A master cost is up to three digits of Arete with its unit (`999 Arete`),
// or `max`.
const MASTER_COST_CH = 9;
const SEPARATORS_CH = 6;

interface ConsoleProps {
  state: GameState;
  // Upgrade mode: purchases are open.
  live: boolean;
  onBuy: (fader: FaderId, max: boolean) => void;
}

export function Console({ state, live, onBuy }: ConsoleProps) {
  if (!consoleShown(state)) return null;
  return (
    <section class="console" data-console="" data-live={live ? "" : undefined} aria-label="Console">
      <Section name="channels" state={state} faders={channelFaders(state)} live={live} onBuy={onBuy} />
      {/* The bus section (issue #60), apart from the channels behind a rule,
          from the first time a bus fader is affordable. */}
      {busesShown(state) && <Section name="buses" state={state} faders={busFaders(state)} live={live} onBuy={onBuy} />}
      {/* The master section (issue #63), in the Arete register behind a
          further rule, from the first prestige on. */}
      {masterShown(state) && <Section name="master" state={state} faders={masterFaders(state)} live={live} onBuy={onBuy} />}
    </section>
  );
}

interface SectionProps {
  name: "channels" | "buses" | "master";
  state: GameState;
  faders: FaderId[];
  live: boolean;
  onBuy: (fader: FaderId, max: boolean) => void;
}

// One section of faders. A throw's fill is its level against the highest
// level in its own section, so the slow-growing buses read on their own
// scale.
function Section({ name, state, faders, live, onBuy }: SectionProps) {
  const highest = Math.max(0, ...faders.map((fader) => levelOf(state, fader)));
  return (
    <div class={name === "channels" ? "console-section" : "console-section console-section-ruled"} data-section={name}>
      {faders.map((fader) => (
        <Fader key={faderKey(fader)} state={state} fader={fader} highest={highest} live={live} onBuy={onBuy} />
      ))}
    </div>
  );
}

// A fader's handle in the DOM: the type for a channel, `bus-<category>`
// for a bus, `master-<id>` for a master fader.
function faderKey(fader: FaderId): string {
  if (fader.kind === "master") return `master-${fader.id}`;
  return fader.kind === "channel" ? fader.type : `bus-${fader.category}`;
}

// The hue a fader's fill wears: its category, or none for a master fader
// (the Arete register).
function faderCategory(fader: FaderId): string | undefined {
  if (fader.kind === "master") return undefined;
  return fader.kind === "channel" ? categoryOf(fader.type) : fader.category;
}

// The readout's cost: ν for channels and buses, Arete for the master
// section, and `max` once a fader is capped.
function costText(state: GameState, fader: FaderId): string {
  if (atCap(state, fader)) return "max";
  const cost = fmtCost(costOf(state, fader));
  return fader.kind === "master" ? `${cost} Arete` : cost;
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
  const effect = faderEffect(fader);
  const open = live && affordable(state, fader);
  const fill = highest === 0 ? 0 : Math.round((level / highest) * 100);
  return (
    <button
      type="button"
      class="fader"
      data-fader={faderKey(fader)}
      data-category={faderCategory(fader)}
      data-master={fader.kind === "master" ? "" : undefined}
      data-muted={open ? undefined : ""}
      disabled={!open}
      onClick={(event) => onBuy(fader, event.shiftKey)}
    >
      <span class="fader-throw" aria-hidden="true">
        <span class="fader-fill" style={{ height: `${fill}%` }} />
      </span>
      <span class="fader-readout mono" style={{ minWidth: `${name.length + SEPARATORS_CH + LEVEL_CH + (fader.kind === "master" ? MASTER_COST_CH : COST_CH)}ch` }}>
        {`${name} · ${level} · ${costText(state, fader)}`}
      </span>
      {effect !== null && <span class="fader-effect mono">{effect}</span>}
    </button>
  );
}
