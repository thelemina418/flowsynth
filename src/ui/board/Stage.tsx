import type { Signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { Cell } from "../../engine/hex";
import type { Board as BoardState, BoardRates, ModuleType } from "../../engine/types";
import type { Num } from "../../engine/num";
import { Board } from "./Board";
import { HexDetail } from "./HexDetail";
import { NousReadout } from "./NousReadout";
import type { Placing } from "./placing";
import { Tray } from "./Tray";

// The game surface once nothing is owed on first load: the ν readout, the
// board, the tray beside it and the Hex detail. Escape or a tap away
// cancels a pick and empties the Hex detail (PRODUCT.md). R and Shift+R
// turn a modulator (issue #31).
interface StageProps {
  nous: Num;
  board: BoardState;
  rates: BoardRates;
  flowing: boolean;
  arrived: ModuleType[];
  placing: Placing;
  inspected: Signal<Cell | null>;
}

export function Stage({ nous, board, rates, flowing, arrived, placing, inspected }: StageProps) {
  useEffect(() => {
    const dismiss = () => {
      placing.clear();
      inspected.value = null;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
      // R turns the picked or inspected modulator clockwise, Shift+R
      // counter-clockwise (issue #31). Outside upgrade mode it does nothing.
      if ((event.key === "r" || event.key === "R") && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const cell = placing.rotationCell(inspected.value);
        if (cell) placing.rotate(cell, event.shiftKey ? "counterclockwise" : "clockwise");
      }
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest("[data-cell], [data-tray], [data-hex-detail]")) dismiss();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [placing, inspected]);

  // Every click on a cell reads it; in upgrade mode it also picks or places.
  const onCell = (cell: Cell) => {
    placing.clickCell(cell);
    inspected.value = { q: cell.q, r: cell.r };
  };

  const onDrop = (target: Element | null) => {
    const cell = target?.closest("[data-cell]")?.getAttribute("data-cell");
    if (cell) {
      const [q, r] = cell.split(",").map(Number) as [number, number];
      onCell({ q, r });
    } else if (target?.closest("[data-tray]")) {
      placing.returnToTray();
    } else {
      placing.clear();
    }
  };

  const note = placing.note.value;
  const open = inspected.value;
  return (
    <section class="stage">
      <NousReadout nous={nous} />
      <div class="stage-board">
        <Board board={board} rates={rates} flowing={flowing} placing={placing} inspected={open} onCell={onCell} onDrop={onDrop} />
        <Tray arrived={arrived} placing={placing} onDrop={onDrop} />
      </div>
      <HexDetail board={board} rates={rates} cell={open} />
      {note !== null && (
        <p class="board-note mono" role="status">
          {note}
        </p>
      )}
    </section>
  );
}
