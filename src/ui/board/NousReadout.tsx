import { fmt, type Num } from "../../engine/num";

// The nous readout (philosophy.md, Disclosure: `ν 0`). A live readout holds
// its size (ADR-0031): its lane is reserved in the stylesheet, so a growing
// figure never shifts what sits beside it. From the first prestige on
// (issue #62) the Arete readout sits beside it in the Arete register, and
// nothing hides it again (ADR-0029): the caller passes the Arete once any
// prestige has happened, null before.
export function NousReadout({ nous, arete = null }: { nous: Num; arete?: Num | null }) {
  return (
    <div class="nous-lane">
      <p class="nous-readout mono">ν {fmt(nous)}</p>
      {arete !== null && (
        <p class="arete-readout mono" data-arete="">
          Arete {fmt(arete)}
        </p>
      )}
    </div>
  );
}
