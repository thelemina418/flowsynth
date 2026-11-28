import type { JSX } from "preact";
import { boardCells, type CellKind } from "../../engine/board";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  cellKey,
  corners,
  LIFETIME_RADIUS,
  lifetimeCells,
  ring,
  sameCell,
  screenNeighbour,
  toPixel,
  type Cell,
  type Point,
  type ScreenDirection,
} from "../../engine/hex";
import { wallOf, type Modifier } from "../../engine/map";
import { moduleName } from "../../engine/modules";
import { moduleAt } from "../../engine/placement";
import type { Board as BoardState, BoardRates, HabitClass, Placement } from "../../engine/types";
import { startDrag } from "./drag";
import { Cords, type Aim } from "./Cords";
import { ModuleFace } from "./ModuleFace";
import type { Placing, Target } from "./placing";
import { Resonances } from "./Resonances";
import { round } from "./svg";

// The board (spec chunk 02, issue #24): the lifetime board drawn as
// flat-top hexes in The Rack's style. Open cells are machined plates (a
// face with an engraved inner ring), walls are unlit stone slabs carrying
// their name initial, class mark and modifier glyph (issue #48), dark cells are a broken outline with no detail. The
// three differ in shape as well as tone (philosophy.md, State grammar).
// Every cell carries data-cell, data-kind and data-ring, the seams later
// tickets (resonance outlines, Hex detail) hang off. A placed module is a
// faceplate in its category hue with its glyph and nameplate (issue #25);
// a modulator's face adds its facing pointer and jack (issue #31);
// a pick's targets carry data-target (valid: clear outline, invalid:
// muted outline) and the picked module data-picked (a firm inset).
// Resonance outlines (issue #26) are one layer drawn over the cells. A
// picked or inspected modulator's reach cells carry data-reach and a clear
// outline in Charge Green's light register (issue #32). Cords (issue #33,
// Cords.tsx) lie above the cells and under the pick and reach outlines,
// which are their own layer, tagged with data-for.

// The hex circumradius in viewBox units; the SVG scales to its container.
const SIZE = 30;
// The drawn hex sits inside its cell, leaving a hairline gutter.
const FACE = SIZE * 0.94;
const ENGRAVE = SIZE * 0.74;
// A modulator's reach outline, inside the face so a pick's target outline
// still reads around it.
const REACH = SIZE * 0.86;
// A placed module's faceplate, inside the engraved ring.
const MODULE = SIZE * 0.66;
const PAD = 4;
const ORIGIN: Cell = { q: 0, r: 0 };

function points(center: Point, size: number): string {
  return corners(center, size)
    .map((p) => `${round(p.x)},${round(p.y)}`)
    .join(" ");
}

// The viewBox spans the lifetime board, so the board never reflows as
// rings open.
function viewBox(): string {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const cell of lifetimeCells()) {
    const { x, y } = toPixel(cell, SIZE);
    xs.push(x);
    ys.push(y);
  }
  const halfHeight = (SIZE * Math.sqrt(3)) / 2;
  const minX = Math.min(...xs) - SIZE - PAD;
  const minY = Math.min(...ys) - halfHeight - PAD;
  const width = Math.max(...xs) - Math.min(...xs) + 2 * (SIZE + PAD);
  const height = Math.max(...ys) - Math.min(...ys) + 2 * (halfHeight + PAD);
  return `${round(minX)} ${round(minY)} ${round(width)} ${round(height)}`;
}

const VIEW_BOX = viewBox();

// A class's mark on the wall that opens it (philosophy.md, Disclosure).
// Roadie's craft is Arms: a jointed arm. Mixer's is Effects: a fader cap
// on its slot (issue #48).
const CLASS_MARKS: Partial<Record<HabitClass, (x: number, y: number) => JSX.Element>> = {
  roadie: (x, y) => (
    <g data-mark="roadie" class="class-mark" transform={`translate(${round(x)} ${round(y)})`}>
      <path d="M -6 4 L -1 -2 L 6 -2" />
      <circle cx="-1" cy="-2" r="1.6" />
    </g>
  ),
  mixer: (x, y) => (
    <g data-mark="mixer" class="class-mark" transform={`translate(${round(x)} ${round(y)})`}>
      <path d="M -6 0 L 6 0 M -1 -3 L -1 3 M 1 -3 L 1 3" />
    </g>
  ),
};

// A modifier's engraved glyph (issue #48): small, in the stone's own tone,
// never a hue, at the slab's upper right. `Pressure ×2`: two chevrons
// pressing inward. `Only Arm damage`: a blade's wedge.
const MODIFIER_GLYPHS: Record<Modifier, string> = {
  pressureDouble: "M -3 -3 L 0 0 L -3 3 M 1 -3 L 4 0 L 1 3",
  armOnly: "M -3 3 L 3 -3 L 3 0 L 0 3 Z",
};

interface BoardCellProps {
  cell: Cell;
  kind: CellKind;
  placement: Placement | undefined;
  picked: boolean;
  inspected: boolean;
  // In the reach of the picked or inspected modulator (issue #32).
  reached: boolean;
  target: Target | undefined;
  // The one cell in the tab order (roving focus); the rest are reached by
  // the arrow keys.
  roving: boolean;
  // A click, Enter or Space on the cell: always reads it into the Hex
  // detail, and in upgrade mode also picks or places.
  onActivate: () => void;
  onFocus: () => void;
  // Present only while a placed module can be dragged (upgrade mode).
  onPointerDown: ((event: PointerEvent) => void) | undefined;
}

function BoardCell({ cell, kind, placement, picked, inspected, reached, target, roving, onActivate, onFocus, onPointerDown }: BoardCellProps) {
  const center = toPixel(cell, SIZE);
  // Every cell takes focus, dark ones too, so the Hex detail opens from
  // the keyboard on any of them.
  const common = (label: string) => ({
    "data-cell": cellKey(cell),
    "data-kind": kind,
    "data-ring": String(ring(cell)),
    "data-target": target,
    "data-picked": picked ? "" : undefined,
    "data-inspected": inspected ? "" : undefined,
    "data-reach": reached ? "" : undefined,
    class: `cell cell-${kind}`,
    tabindex: roving ? 0 : -1,
    role: "button" as const,
    "aria-label": label,
    "aria-pressed": picked ? ("true" as const) : undefined,
    onClick: onActivate,
    onFocus,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onActivate();
    },
  });
  if (kind === "open") {
    return (
      <g {...common(placement ? moduleName(placement.module) : "Open cell")} onPointerDown={onPointerDown}>
        <polygon class="cell-face" points={points(center, FACE)} />
        <polygon class="cell-engrave" points={points(center, ENGRAVE)} />
        {placement && <ModuleFace placement={placement} center={center} size={MODULE} />}
      </g>
    );
  }
  if (kind === "dark") {
    return (
      <g {...common("Dark cell")}>
        <polygon class="cell-face" points={points(center, FACE)} stroke-dasharray="3 5" />
      </g>
    );
  }
  const wall = wallOf(cell);
  const mark = wall.opens ? CLASS_MARKS[wall.opens] : undefined;
  const initialY = mark ? center.y - 2 : center.y + 5;
  return (
    <g {...common(wall.name)}>
      <polygon class="cell-face" points={points(center, FACE)} />
      <text class="wall-initial" x={round(center.x)} y={round(initialY)} text-anchor="middle">
        {wall.name.charAt(0)}
      </text>
      {mark?.(center.x, center.y + 10)}
      {wall.modifier && (
        <path
          class="modifier-glyph"
          data-modifier={wall.modifier}
          d={MODIFIER_GLYPHS[wall.modifier]}
          transform={`translate(${round(center.x + 11)} ${round(center.y - 11)})`}
        />
      )}
    </g>
  );
}

// The pick and reach outlines, one layer over the cells and the cords
// (issue #33), each tagged with the cell it outlines.
function Outlines({ reach, targets, picked }: { reach: Set<string>; targets: ReadonlyMap<string, Target>; picked: Cell | null }) {
  return (
    <g class="outlines" aria-hidden="true">
      {lifetimeCells().map((cell) => {
        const key = cellKey(cell);
        const target = targets.get(key);
        if (!target && !reach.has(key)) return null;
        const center = toPixel(cell, SIZE);
        return (
          <g key={key}>
            {reach.has(key) && <polygon class="cell-reach" data-for={key} points={points(center, REACH)} />}
            {target && (
              <polygon
                class="cell-target"
                data-for={key}
                data-target={target}
                data-picked={picked && sameCell(picked, cell) ? "" : undefined}
                points={points(center, FACE)}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}

// The board with its placements. Every cell is a click target for the Hex
// detail. In upgrade mode a click also goes to the pick (and a placed
// module is a drag source); outside it the layout is locked, so a click
// only inspects.
interface BoardProps {
  board: BoardState;
  rates: BoardRates;
  flowing: boolean;
  placing: Placing;
  inspected: Cell | null;
  onCell: (cell: Cell) => void;
  // A click on a placed cable's plug (issue #33).
  onPlug: (source: Cell) => void;
  onDrop: (target: Element | null) => void;
}

function cellOf(key: string): Cell {
  const [q, r] = key.split(",").map(Number) as [number, number];
  return { q, r };
}

const ARROWS: Record<string, ScreenDirection> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

export function Board({ board, rates, flowing, placing, inspected, onCell, onPlug, onDrop }: BoardProps) {
  const pick = placing.pick.value;
  const targets = placing.targets.value;
  const locked = placing.locked.value;
  // The jack a held cable runs from (issue #33): its cell reads as picked.
  const source = placing.source.value;
  const picked = pick?.from === "cell" ? pick.cell : source;
  // The board is one tab stop: the cell last focused, from (0,0) at
  // first. Arrow keys move it along the drawn grid and stop at the edge.
  const [roving, setRoving] = useState(cellKey(ORIGIN));
  const svg = useRef<SVGSVGElement>(null);
  // Where a held cable's would-be cord runs: the pointer, else the
  // focused cell. A new jack starts with no aim.
  const [aim, setAim] = useState<Aim | null>(null);
  const sourceKey = source ? cellKey(source) : null;
  useEffect(() => setAim(null), [sourceKey]);
  const onPointerMove = (event: PointerEvent) => {
    if (!source) return;
    const key = event.target instanceof Element ? event.target.closest("[data-cell]")?.getAttribute("data-cell") : null;
    if (!key) return;
    const matrix = svg.current?.getScreenCTM?.()?.inverse();
    const point = matrix && typeof DOMPoint === "function" ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix) : null;
    setAim({ cell: cellOf(key), point: point ? { x: point.x, y: point.y } : null });
  };
  // The picked module's cell, else the inspected one: a modulator there
  // outlines its reach, with no number on the board (issue #32).
  const shown = pick?.from === "cell" ? pick.cell : inspected;
  const modulator = shown ? rates.modulators.find((m) => sameCell(m.cell, shown)) : undefined;
  const reach = new Set(modulator?.deliveries.map((d) => cellKey(d.cell)));
  const onKeyDown = (event: KeyboardEvent) => {
    const direction = ARROWS[event.key];
    const from = event.target instanceof Element ? event.target.closest("[data-cell]")?.getAttribute("data-cell") : null;
    if (!direction || !from) return;
    event.preventDefault();
    const next = screenNeighbour(cellOf(from), direction);
    if (ring(next) > LIFETIME_RADIUS) return;
    const key = cellKey(next);
    setRoving(key);
    svg.current?.querySelector<SVGGElement>(`[data-cell="${key}"]`)?.focus();
  };
  return (
    <svg ref={svg} class="board" viewBox={VIEW_BOX} role="group" aria-label="Board" onKeyDown={onKeyDown} onPointerMove={onPointerMove}>
      {boardCells(board).map(({ cell, kind }) => {
        const placement = kind === "open" ? moduleAt(board, cell) : undefined;
        return (
          <BoardCell
            key={cellKey(cell)}
            cell={cell}
            kind={kind}
            placement={placement}
            picked={picked !== null && sameCell(picked, cell)}
            inspected={inspected !== null && sameCell(inspected, cell)}
            reached={reach.has(cellKey(cell))}
            target={targets.get(cellKey(cell))}
            roving={roving === cellKey(cell)}
            onActivate={() => onCell(cell)}
            onFocus={() => {
              setRoving(cellKey(cell));
              if (source) setAim({ cell, point: null });
            }}
            onPointerDown={!locked && placement && !source ? (event) => startDrag(event, { begin: () => placing.pickCell(cell), drop: onDrop }) : undefined}
          />
        );
      })}
      <Cords
        board={board}
        size={SIZE}
        flowing={flowing}
        live={!locked && pick === null}
        source={source}
        aim={source ? aim : null}
        aimTarget={aim ? targets.get(cellKey(aim.cell)) : undefined}
        onPlug={onPlug}
        onPlugDrag={(from) => placing.pickPlug(from)}
        onDrop={onDrop}
      />
      <Outlines reach={reach} targets={targets} picked={picked} />
      <Resonances rates={rates} flowing={flowing} size={SIZE} />
    </svg>
  );
}
