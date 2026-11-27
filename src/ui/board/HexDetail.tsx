import type { Hex } from "../../engine/hex";
import type { Board, BoardRates } from "../../engine/types";
import { hexDetail } from "./hexReadout";

// The Hex detail (issue #27; GLOSSARY): the fixed panel that shows the full
// readout of a clicked cell. Its place is reserved, so opening it never
// moves the board; until the first click it holds nothing visible.
export function HexDetail({ board, rates, cell }: { board: Board; rates: BoardRates; cell: Hex | null }) {
  const lines = cell ? hexDetail(board, rates, cell) : [];
  return (
    <div class="hex-detail" data-hex-detail="" data-open={cell ? "" : undefined} role="region" aria-label="Hex detail" aria-live="polite">
      {lines.map((line, i) => (
        <p key={i} class="hex-detail-line mono" data-effect={line.effect ? "" : undefined}>
          {line.text}
        </p>
      ))}
    </div>
  );
}
