import type { ModuleType } from "../../engine/types";

// Each module type's glyph (philosophy.md: every hue is paired with a
// glyph). The type is told by glyph and nameplate, never by hue. Paths are
// drawn in an 18 × 8 box centred on the origin, as stroked waveforms.
const PATHS: Record<ModuleType, string> = {
  sine: "M -9 0 C -6.5 -8 -2.5 -8 0 0 S 6.5 8 9 0",
  triangle: "M -9 4 L -4.5 -4 L 0 4 L 4.5 -4 L 9 4",
  square: "M -9 4 L -9 -4 L 0 -4 L 0 4 L 9 4 L 9 -4",
  saw: "M -9 4 L -1 -4 L -1 4 L 8 -4 L 8 4",
  release: "M -9 -4 Q -5 4 9 4",
  // A disc on its axle.
  flywheel: "M -4 0 A 4 4 0 1 0 4 0 A 4 4 0 1 0 -4 0 M -9 0 L -4 0 M 4 0 L 9 0 M 0 -4 L 0 4",
  // A pulse rising out of a flat line and back (chunk 04 brings it on).
  pulsewell: "M -9 2 L -4 2 L -2 -4 L 2 4 L 4 2 L 9 2",
};

// The glyph inside the board's SVG, at a cell's centre.
export function Glyph({ module, x, y }: { module: ModuleType; x: number; y: number }) {
  return <path class="glyph" data-glyph={module} d={PATHS[module]} transform={`translate(${x} ${y})`} />;
}

// A cable's tray icon (issue #33): a slack cord between a jack and a plug.
export function CableIcon() {
  return (
    <svg class="glyph-icon" data-glyph="cable" viewBox="-11 -6 22 12" aria-hidden="true">
      <path class="glyph" d="M -8 -2 Q 0 7 8 -2" />
      <circle class="glyph" cx="-8" cy="-2" r="1.8" />
      <circle class="glyph" cx="8" cy="-2" r="1.8" />
    </svg>
  );
}

// The glyph as a standalone icon, for the tray.
export function GlyphIcon({ module }: { module: ModuleType }) {
  return (
    <svg class="glyph-icon" data-glyph={module} viewBox="-11 -6 22 12" aria-hidden="true">
      <path class="glyph" d={PATHS[module]} />
    </svg>
  );
}
