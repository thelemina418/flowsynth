import { corners, FACING_NAMES, type Point } from "../../engine/hex";
import { categoryOf, moduleName } from "../../engine/modules";
import type { Placement } from "../../engine/types";
import { Glyph } from "./glyphs";
import { round } from "./svg";

// A placed module's faceplate (issues #25, #31): a hex in its category hue
// with its glyph and nameplate. A module with a facing also carries a
// pointer notched into the face's edge toward its facing, and a small jack,
// where chunk 03's cables plug in.

function points(center: Point, size: number): string {
  return corners(center, size)
    .map((p) => `${round(p.x)},${round(p.y)}`)
    .join(" ");
}

// Direction i points at the flat-top hex's edge midpoint at −30° + 60° × i.
function facingAngle(facing: number): number {
  return (Math.PI / 180) * (-30 + 60 * facing);
}

// A small triangle astride the face's edge: its base just inside, its tip
// just outside, pointing along the facing.
function pointer(center: Point, size: number, facing: number): string {
  const apothem = (size * Math.sqrt(3)) / 2;
  const angle = facingAngle(facing);
  const along = (r: number, side: number) => ({
    x: center.x + r * Math.cos(angle) - side * Math.sin(angle),
    y: center.y + r * Math.sin(angle) + side * Math.cos(angle),
  });
  const tip = along(apothem + 3, 0);
  const left = along(apothem - 6, -3);
  const right = along(apothem - 6, 3);
  return [tip, left, right].map((p) => `${round(p.x)},${round(p.y)}`).join(" ");
}

export function ModuleFace({ placement, center, size }: { placement: Placement; center: Point; size: number }) {
  const { module, facing } = placement;
  const faced = facing !== undefined;
  return (
    <g class="module" data-module={module} data-category={categoryOf(module)}>
      <polygon class="module-face" points={points(center, size)} />
      <Glyph module={module} x={round(center.x)} y={round(center.y - (faced ? 6 : 4))} />
      {faced && <circle class="module-jack" data-jack="" cx={round(center.x)} cy={round(center.y + 3.5)} r="2.2" />}
      <text class="module-name" x={round(center.x)} y={round(center.y + 13)} text-anchor="middle">
        {moduleName(module)}
      </text>
      {/* Last, so the nameplate never hides it on the lower facings. */}
      {faced && <polygon class="module-pointer" data-facing={FACING_NAMES[facing]} points={pointer(center, size, facing)} />}
    </g>
  );
}
