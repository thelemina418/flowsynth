import type { JSX } from "preact";
import { boardCells, type CellKind } from "../../engine/board";
import { corners, hexKey, lifetimeCells, ring, toPixel, type Hex } from "../../engine/hex";
import { wallAt } from "../../engine/map";
import type { Board as BoardState, HabitClass } from "../../engine/types";

// The board (spec chunk 02, issue #24): the lifetime board drawn as
// flat-top hexes in The Rack's style. Open cells are machined plates (a
// face with an engraved inner ring), walls are unlit stone slabs carrying
// their name initial, dark cells are a broken outline with no detail. The
// three differ in shape as well as tone (philosophy.md, State grammar).
// Every cell carries data-cell, data-kind and data-ring, the seams later
// tickets (placement, resonance outlines, Hex detail) hang off.

// The hex circumradius in viewBox units; the SVG scales to its container.
const SIZE = 30;
// The drawn hex sits inside its cell, leaving a hairline gutter.
const FACE = SIZE * 0.94;
const ENGRAVE = SIZE * 0.74;
const PAD = 4;

function points(center: { x: number; y: number }, size: number): string {
  return corners(center, size)
    .map((p) => `${round(p.x)},${round(p.y)}`)
    .join(" ");
}

function round(n: number): number {
  return Math.round(n * 100) / 100 + 0;
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
// Roadie's craft is Arms: a jointed arm. Further marks arrive with the
// walls that carry them (chunk 05).
const CLASS_MARKS: Partial<Record<HabitClass, (x: number, y: number) => JSX.Element>> = {
  roadie: (x, y) => (
    <g data-mark="roadie" class="class-mark" transform={`translate(${round(x)} ${round(y)})`}>
      <path d="M -6 4 L -1 -2 L 6 -2" />
      <circle cx="-1" cy="-2" r="1.6" />
    </g>
  ),
};

function Cell({ cell, kind }: { cell: Hex; kind: CellKind }) {
  const center = toPixel(cell, SIZE);
  const common = { "data-cell": hexKey(cell), "data-kind": kind, "data-ring": String(ring(cell)), class: `cell cell-${kind}` };
  if (kind === "open") {
    return (
      <g {...common}>
        <polygon class="cell-face" points={points(center, FACE)} />
        <polygon class="cell-engrave" points={points(center, ENGRAVE)} />
      </g>
    );
  }
  if (kind === "dark") {
    return (
      <g {...common}>
        <polygon class="cell-face" points={points(center, FACE)} stroke-dasharray="3 5" />
      </g>
    );
  }
  const wall = wallAt(cell);
  const mark = wall.opens ? CLASS_MARKS[wall.opens] : undefined;
  const initialY = mark ? center.y - 2 : center.y + 5;
  return (
    <g {...common}>
      <polygon class="cell-face" points={points(center, FACE)} />
      {wall.name !== null && (
        <text class="wall-initial" x={round(center.x)} y={round(initialY)} text-anchor="middle">
          {wall.name.charAt(0)}
        </text>
      )}
      {mark?.(center.x, center.y + 10)}
    </g>
  );
}

export function Board({ board }: { board: BoardState }) {
  return (
    <svg class="board" viewBox={VIEW_BOX} role="img" aria-label="Board">
      {boardCells(board).map(({ cell, kind }) => (
        <Cell key={hexKey(cell)} cell={cell} kind={kind} />
      ))}
    </svg>
  );
}
