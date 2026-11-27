import { cellKey, sameCell, toPixel, type Cell, type Point } from "../../engine/hex";
import { categoryOf } from "../../engine/modules";
import { moduleAt } from "../../engine/placement";
import type { Board, Cable } from "../../engine/types";
import { startDrag } from "./drag";
import type { Target } from "./placing";
import { round } from "./svg";

// Cords (spec chunk 03, issue #33): each placed cable drawn as a patch
// cord, a thin and slightly slack curve from its source's jack to a plug
// at the target end, stroked in the source's category hue (philosophy.md,
// Look). The board draws them above the cells and under the pick and
// reach outlines. While a jack is plugged (or a plug picked), a would-be
// cord runs from the jack to the pointer or the focused cell, muted over
// an invalid target. In flow, beads of charge light travel each cord at
// one slow constant pace; under prefers-reduced-motion there are none.
// A plug's hit target is a circle at least 44px across on the desktop
// board, live only while nothing is picked in upgrade mode. It reaches
// over the target cell's centre, so it is clipped to leave a disc there
// (CLEAR): a click on the target's centre falls through to the cell and
// inspects or picks it, and the rest of the circle stays the plug's.

// Where the cord leaves the modulator: its jack, under the glyph
// (ModuleFace.tsx).
const JACK_DROP = 3.5;
// The plug sits inside the target cell, short of its centre on the
// source's side, so the target's faceplate stays readable.
const PLUG_INSET = 0.8;
// The plug's hit radius in viewBox units: beside the tray the desktop
// board draws its 518 units in about 460px, so 52 units make 46px.
const HIT = 26;
// The disc left to the target cell, as a share of the hex's circumradius:
// 12 units, about 21px across on the desktop board.
const CLEAR = 0.4;
// The clip's outer square: wider than any hit circle.
const CLIP_SPAN = 4;
// The sag, as a share of the cord's span, plus a little.
const SAG = 0.12;
// Beads: viewBox units per second, and roughly one per this many units.
const BEAD_SPEED = 9;
const BEAD_GAP = 22;

export interface Aim {
  cell: Cell;
  // The pointer, in viewBox units, when it is over the board; else the
  // cord runs to the focused cell.
  point: Point | null;
}

function jackPoint(source: Cell, size: number): Point {
  const c = toPixel(source, size);
  return { x: c.x, y: c.y + JACK_DROP };
}

// The plug's point: the target's centre, drawn toward the jack.
export function plugPoint(source: Cell, target: Cell, size: number): Point {
  const from = jackPoint(source, size);
  const to = toPixel(target, size);
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const span = Math.hypot(dx, dy) || 1;
  const inset = Math.min(size * PLUG_INSET, span / 2);
  return { x: to.x + (dx / span) * inset, y: to.y + (dy / span) * inset };
}

// Everything around `around` but a disc on the target's centre, as one
// evenodd path: an outer square, then the disc as two arcs from its
// rightmost point.
function clearedCentre(around: Point, centre: Point, size: number): string {
  const half = HIT * CLIP_SPAN;
  const r = size * CLEAR;
  const x0 = round(around.x - half);
  const x1 = round(around.x + half);
  const y0 = round(around.y - half);
  const y1 = round(around.y + half);
  const right = `${round(centre.x + r)} ${round(centre.y)}`;
  const left = `${round(centre.x - r)} ${round(centre.y)}`;
  return `M ${x0} ${y0} H ${x1} V ${y1} H ${x0} Z M ${right} A ${round(r)} ${round(r)} 0 1 0 ${left} A ${round(r)} ${round(r)} 0 1 0 ${right} Z`;
}

// A slack curve: one quadratic hung below the straight line.
function curve(a: Point, b: Point): { d: string; length: number } {
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  const control = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 2 + span * SAG };
  let length = 0;
  let last = a;
  for (let i = 1; i <= 16; i++) {
    const t = i / 16;
    const p = {
      x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * control.x + t * t * b.x,
      y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * control.y + t * t * b.y,
    };
    length += Math.hypot(p.x - last.x, p.y - last.y);
    last = p;
  }
  const at = (p: Point) => `${round(p.x)} ${round(p.y)}`;
  return { d: `M ${at(a)} Q ${at(control)} ${at(b)}`, length };
}

function reducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function Beads({ d, length }: { d: string; length: number }) {
  const count = Math.max(1, Math.round(length / BEAD_GAP));
  const seconds = length / BEAD_SPEED;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <circle key={i} class="bead" r="1.4">
          <animateMotion dur={`${round(seconds)}s`} begin={`${round((-i * seconds) / count)}s`} repeatCount="indefinite" {...({ path: d } as Record<string, string>)} />
        </circle>
      ))}
    </>
  );
}

interface CordsProps {
  board: Board;
  size: number;
  flowing: boolean;
  // Plugs take clicks and drags (upgrade mode, nothing picked).
  live: boolean;
  // The jack a held cable runs from, and the cell it is aimed at.
  source: Cell | null;
  aim: Aim | null;
  aimTarget: Target | undefined;
  onPlug: (source: Cell) => void;
  onPlugDrag: (source: Cell) => void;
  onDrop: (target: Element | null) => void;
}

export function Cords({ board, size, flowing, live, source, aim, aimTarget, onPlug, onPlugDrag, onDrop }: CordsProps) {
  const beads = flowing && !reducedMotion();
  const category = (cell: Cell) => {
    const placed = moduleAt(board, cell);
    return placed ? categoryOf(placed.module) : undefined;
  };
  // A picked plug's cord follows the aim instead of its target.
  const reaiming = (cable: Cable) => source !== null && aim !== null && sameCell(cable.source, source);
  const wouldBe = source !== null && aim !== null ? curve(jackPoint(source, size), aim.point ?? plugPoint(source, aim.cell, size)) : null;
  return (
    <g class="cords">
      {board.cables.map((cable) => {
        if (reaiming(cable)) return null;
        const key = cellKey(cable.source);
        const clipId = `plug-clear-${cable.source.q}_${cable.source.r}`;
        const plug = plugPoint(cable.source, cable.target, size);
        const { d, length } = curve(jackPoint(cable.source, size), plug);
        return (
          <g key={key}>
            <path class="cord" data-cord={key} data-category={category(cable.source)} d={d} />
            {beads && <Beads d={d} length={length} />}
            <g
              class="plug"
              data-plug={key}
              data-category={category(cable.source)}
              data-live={live ? "" : undefined}
              onClick={live ? () => onPlug(cable.source) : undefined}
              onPointerDown={live ? (event) => startDrag(event, { begin: () => onPlugDrag(cable.source), drop: onDrop }) : undefined}
            >
              <clipPath id={clipId}>
                <path clip-rule="evenodd" d={clearedCentre(plug, toPixel(cable.target, size), size)} />
              </clipPath>
              <circle class="plug-hit" cx={round(plug.x)} cy={round(plug.y)} r={HIT} clip-path={`url(#${clipId})`} />
              <circle class="plug-body" cx={round(plug.x)} cy={round(plug.y)} r="3.2" />
            </g>
          </g>
        );
      })}
      {wouldBe && source && (
        <path class="cord" data-would-be="" data-category={category(source)} data-muted={aimTarget === "invalid" ? "" : undefined} d={wouldBe.d} />
      )}
    </g>
  );
}
