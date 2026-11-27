import type { JSX } from "preact";
import { boardCells, type CellKind } from "../../engine/board";
import { useRef, useState } from "preact/hooks";
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
import { wallAt } from "../../engine/map";
import { categoryOf, moduleName } from "../../engine/modules";
import { moduleAt } from "../../engine/placement";
import type { Board as BoardState, BoardRates, HabitClass, ModuleType } from "../../engine/types";
import { startDrag } from "./drag";
import { Glyph } from "./glyphs";
import type { Placing, Target } from "./placing";
import { Resonances } from "./Resonances";
import { round } from "./svg";

// The board (spec chunk 02, issue #24): the lifetime board drawn as
// flat-top hexes in The Rack's style. Open cells are machined plates (a
// face with an engraved inner ring), walls are unlit stone slabs carrying
// their name initial, dark cells are a broken outline with no detail. The
// three differ in shape as well as tone (philosophy.md, State grammar).
// Every cell carries data-cell, data-kind and data-ring, the seams later
// tickets (resonance outlines, Hex detail) hang off. A placed module is a
// faceplate in its category hue with its glyph and nameplate (issue #25);
// a pick's targets carry data-target (valid: clear outline, invalid:
// muted outline) and the picked module data-picked (a firm inset).
// Resonance outlines (issue #26) are one layer drawn over the cells.

// The hex circumradius in viewBox units; the SVG scales to its container.
const SIZE = 30;
// The drawn hex sits inside its cell, leaving a hairline gutter.
const FACE = SIZE * 0.94;
const ENGRAVE = SIZE * 0.74;
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

interface BoardCellProps {
  cell: Cell;
  kind: CellKind;
  module: ModuleType | undefined;
  picked: boolean;
  inspected: boolean;
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

function BoardCell({ cell, kind, module, picked, inspected, target, roving, onActivate, onFocus, onPointerDown }: BoardCellProps) {
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
  const targetOutline = target && <polygon class="cell-target" points={points(center, FACE)} />;
  if (kind === "open") {
    return (
      <g {...common(module ? moduleName(module) : "Open cell")} onPointerDown={onPointerDown}>
        <polygon class="cell-face" points={points(center, FACE)} />
        <polygon class="cell-engrave" points={points(center, ENGRAVE)} />
        {module && (
          <g class="module" data-module={module} data-category={categoryOf(module)}>
            <polygon class="module-face" points={points(center, MODULE)} />
            <Glyph module={module} x={round(center.x)} y={round(center.y - 4)} />
            <text class="module-name" x={round(center.x)} y={round(center.y + 13)} text-anchor="middle">
              {moduleName(module)}
            </text>
          </g>
        )}
        {targetOutline}
      </g>
    );
  }
  if (kind === "dark") {
    return (
      <g {...common("Dark cell")}>
        <polygon class="cell-face" points={points(center, FACE)} stroke-dasharray="3 5" />
        {targetOutline}
      </g>
    );
  }
  const wall = wallAt(cell);
  const mark = wall.opens ? CLASS_MARKS[wall.opens] : undefined;
  const initialY = mark ? center.y - 2 : center.y + 5;
  return (
    <g {...common(wall.name ?? "Wall")}>
      <polygon class="cell-face" points={points(center, FACE)} />
      {wall.name !== null && (
        <text class="wall-initial" x={round(center.x)} y={round(initialY)} text-anchor="middle">
          {wall.name.charAt(0)}
        </text>
      )}
      {mark?.(center.x, center.y + 10)}
      {targetOutline}
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
  onDrop: (target: Element | null) => void;
}

const ARROWS: Record<string, ScreenDirection> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

export function Board({ board, rates, flowing, placing, inspected, onCell, onDrop }: BoardProps) {
  const pick = placing.pick.value;
  const targets = placing.targets.value;
  const locked = placing.locked.value;
  // The board is one tab stop: the cell last focused, from (0,0) at
  // first. Arrow keys move it along the drawn grid and stop at the edge.
  const [roving, setRoving] = useState(cellKey(ORIGIN));
  const svg = useRef<SVGSVGElement>(null);
  const onKeyDown = (event: KeyboardEvent) => {
    const direction = ARROWS[event.key];
    const from = event.target instanceof Element ? event.target.closest("[data-cell]")?.getAttribute("data-cell") : null;
    if (!direction || !from) return;
    event.preventDefault();
    const [q, r] = from.split(",").map(Number) as [number, number];
    const next = screenNeighbour({ q, r }, direction);
    if (ring(next) > LIFETIME_RADIUS) return;
    const key = cellKey(next);
    setRoving(key);
    svg.current?.querySelector<SVGGElement>(`[data-cell="${key}"]`)?.focus();
  };
  return (
    <svg ref={svg} class="board" viewBox={VIEW_BOX} role="group" aria-label="Board" onKeyDown={onKeyDown}>
      {boardCells(board).map(({ cell, kind }) => {
        const module = kind === "open" ? moduleAt(board, cell)?.module : undefined;
        return (
          <BoardCell
            key={cellKey(cell)}
            cell={cell}
            kind={kind}
            module={module}
            picked={pick?.from === "cell" && sameCell(pick.cell, cell)}
            inspected={inspected !== null && sameCell(inspected, cell)}
            target={targets.get(cellKey(cell))}
            roving={roving === cellKey(cell)}
            onActivate={() => onCell(cell)}
            onFocus={() => setRoving(cellKey(cell))}
            onPointerDown={!locked && module ? (event) => startDrag(event, { begin: () => placing.pickCell(cell), drop: onDrop }) : undefined}
          />
        );
      })}
      <Resonances rates={rates} flowing={flowing} size={SIZE} />
    </svg>
  );
}
