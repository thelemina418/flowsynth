import { useEffect } from "preact/hooks";
import type { Board as BoardState, ModuleType } from "../../engine/types";
import type { Num } from "../../engine/num";
import { Board } from "./Board";
import { NousReadout } from "./NousReadout";
import type { Placing } from "./placing";
import { Tray } from "./Tray";

// The game surface once nothing is owed on first load: the ν readout, the
// board and the tray beside it. Escape or a tap away cancels a pick
// (PRODUCT.md).
export function Stage({ nous, board, arrived, placing }: { nous: Num; board: BoardState; arrived: ModuleType[]; placing: Placing }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") placing.clear();
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest("[data-cell], [data-tray]")) placing.clear();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [placing]);

  const onDrop = (target: Element | null) => {
    const cell = target?.closest("[data-cell]")?.getAttribute("data-cell");
    if (cell) {
      const [q, r] = cell.split(",").map(Number) as [number, number];
      placing.clickCell({ q, r });
    } else if (target?.closest("[data-tray]")) {
      placing.returnToTray();
    } else {
      placing.clear();
    }
  };

  const note = placing.note.value;
  return (
    <section class="stage">
      <NousReadout nous={nous} />
      <div class="stage-board">
        <Board board={board} placing={placing} onDrop={onDrop} />
        <Tray arrived={arrived} placing={placing} onDrop={onDrop} />
      </div>
      {note !== null && (
        <p class="board-note mono" role="status">
          {note}
        </p>
      )}
    </section>
  );
}
