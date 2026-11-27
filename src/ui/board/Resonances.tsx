import { corners, DIRECTIONS, cellKey, toPixel, addCell, type Cell, type Point } from "../../engine/hex";
import { round } from "./svg";
import type { BoardRates } from "../../engine/types";

// The resonance outlines (spec chunk 02, issue #26): for each satisfied
// instance, the oscillator's cell and its partner cells share one thin
// engraved outline in the oscillator hue (hue = category only). Instances
// that cover the same cells draw one outline, since they would coincide.
// In flow the outline carries data-pulse and pulses slowly; the stylesheet
// holds it still under prefers-reduced-motion. No number is drawn.

interface Outline {
  members: Cell[];
  key: string;
}

// The satisfied instances' member sets, one per distinct set of cells, in
// placement order.
export function outlinesOf(rates: BoardRates): Outline[] {
  const seen = new Map<string, Outline>();
  for (const oscillator of rates.oscillators) {
    for (const instance of oscillator.instances) {
      const members = [oscillator.cell, ...instance.partners.map((p) => p.cell)];
      const key = members.map(cellKey).sort().join(" ");
      if (!seen.has(key)) seen.set(key, { members, key });
    }
  }
  return [...seen.values()];
}

const pointKey = (p: Point) => `${round(p.x)},${round(p.y)}`;

// The union's boundary as one closed path per loop. A flat-top hex's edge
// from corner i to corner i + 1 faces DIRECTIONS[i + 1]; an edge whose
// neighbour is not a member is on the boundary. Every hex's edges run the
// same way round, so boundary edges chain head to tail.
export function outlinePath(members: Cell[], size: number): string {
  const inside = new Set(members.map(cellKey));
  const next = new Map<string, Point>();
  for (const cell of members) {
    const points = corners(toPixel(cell, size), size);
    for (let i = 0; i < 6; i++) {
      if (inside.has(cellKey(addCell(cell, DIRECTIONS[(i + 1) % 6]!)))) continue;
      next.set(pointKey(points[i]!), points[(i + 1) % 6]!);
    }
  }
  const loops: string[] = [];
  while (next.size > 0) {
    const [startKey] = next.keys() as IterableIterator<string>;
    const steps: string[] = [startKey!];
    let at = next.get(startKey!)!;
    next.delete(startKey!);
    while (pointKey(at) !== startKey) {
      const key = pointKey(at);
      steps.push(key);
      const following = next.get(key);
      if (!following) break;
      next.delete(key);
      at = following;
    }
    loops.push(`M ${steps.join(" L ")} Z`);
  }
  return loops.join(" ");
}

export function Resonances({ rates, flowing, size }: { rates: BoardRates; flowing: boolean; size: number }) {
  return (
    <g class="resonances" aria-hidden="true">
      {outlinesOf(rates).map(({ members, key }) => (
        <path
          key={key}
          class="resonance"
          data-category="oscillator"
          data-members={key}
          data-pulse={flowing ? "" : undefined}
          d={outlinePath(members, size)}
        />
      ))}
    </g>
  );
}
