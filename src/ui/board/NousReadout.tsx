import { fmt, type Num } from "../../engine/num";

// The nous readout (philosophy.md, Disclosure: `ν 0`). A live readout holds
// its size (ADR-0031): its lane is reserved in the stylesheet, so a growing
// figure never shifts what sits beside it.
export function NousReadout({ nous }: { nous: Num }) {
  return <p class="nous-readout mono">ν {fmt(nous)}</p>;
}
