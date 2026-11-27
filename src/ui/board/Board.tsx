import type { JSX } from "preact";
import { boardCells, type CellKind } from "../../engine/board";
import { corners, hexKey, lifetimeCells, ring, sameHex, toPixel, type Hex } from "../../engine/hex";
import { wallAt } from "../../engine/map";
import { categoryOf, moduleName } from "../../engine/modules";
import { moduleAt } from "../../engine/placement";
import type { Board as BoardState, HabitClass, ModuleType } from "../../engine/types";
import { startDrag } from "./drag";
import { Glyph } from "./glyphs";
import type { Placing, Target } from "./placing";

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

// The hex circumradius in viewBox units; the SVG scales to its container.
const SIZE = 30;
// The drawn hex sits inside its cell, leaving a hairline gutter.
const FACE = SIZE * 0.94;
const ENGRAVE = SIZE * 0.74;
// A placed module's faceplate, inside the engraved ring.
const MODULE = SIZE * 0.66;
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

interface CellProps {
  cell: Hex;
  kind: CellKind;
  module: ModuleType | undefined;
  picked: boolean;
  target: Target | undefined;
  // Present only while the cell can be acted on (upgrade mode).
  actions: CellActions | undefined;
}

interface CellActions {
  onClick: () => void;
  onPointerDown: ((event: PointerEvent) => void) | undefined;
}

function Cell({ cell, kind, module, picked, target, actions }: CellProps) {
  const center = toPixel(cell, SIZE);
  const common = {
    "data-cell": hexKey(cell),
    "data-kind": kind,
    "data-ring": String(ring(cell)),
    "data-target": target,
    "data-picked": picked ? "" : undefined,
    class: `cell cell-${kind}`,
  };
  if (kind === "open") {
    const interactive = actions
      ? {
          tabindex: 0,
          role: "button" as const,
          "aria-label": module ? moduleName(module) : "Open cell",
          "aria-pressed": picked ? ("true" as const) : undefined,
          onClick: actions.onClick,
          onPointerDown: actions.onPointerDown,
          onKeyDown: (event: KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            actions.onClick();
          },
        }
      : {};
    return (
      <g {...common} {...interactive}>
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
        {target && <polygon class="cell-target" points={points(center, FACE)} />}
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
    <g {...common} onClick={actions?.onClick}>
      <polygon class="cell-face" points={points(center, FACE)} />
      {wall.name !== null && (
        <text class="wall-initial" x={round(center.x)} y={round(initialY)} text-anchor="middle">
          {wall.name.charAt(0)}
        </text>
      )}
      {mark?.(center.x, center.y + 10)}
      {target && <polygon class="cell-target" points={points(center, FACE)} />}
    </g>
  );
}

// The board with its placements. In upgrade mode a cell is a click target
// (and a placed module a drag source) routed to the pick; outside it the
// layout is locked and the cells carry no handlers.
export function Board({ board, placing, onDrop }: { board: BoardState; placing: Placing; onDrop: (target: Element | null) => void }) {
  const pick = placing.pick.value;
  const targets = placing.targets.value;
  const locked = placing.locked.value;
  return (
    <svg class="board" viewBox={VIEW_BOX} role="img" aria-label="Board">
      {boardCells(board).map(({ cell, kind }) => {
        const module = kind === "open" ? moduleAt(board, cell)?.module : undefined;
        const actions: CellActions | undefined = locked
          ? undefined
          : {
              onClick: () => placing.clickCell(cell),
              onPointerDown: module ? (event) => startDrag(event, { begin: () => placing.pickCell(cell), drop: onDrop }) : undefined,
            };
        return (
          <Cell
            key={hexKey(cell)}
            cell={cell}
            kind={kind}
            module={module}
            picked={pick?.from === "cell" && sameHex(pick.cell, cell)}
            target={targets.get(hexKey(cell))}
            actions={kind === "dark" ? undefined : actions}
          />
        );
      })}
    </svg>
  );
}
