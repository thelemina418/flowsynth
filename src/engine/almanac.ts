import { localDayStart } from "./intentions";
import type { GameState } from "./types";

// The Almanac's reads (spec chunk 04, issue #43). The Almanac plans; it
// never touches the board, so everything here only reads records.

// A habit's credited seconds per local calendar day, live and manual, for
// the `days` days ending today, oldest first. The days are the ones daily
// Intention occurrences roll on (ADR-0080): each starts at the local
// midnight `localDayStart` gives, and the walk back builds each day from
// the calendar date, never by subtracting 24 hours, so a 23- or 25-hour
// day stays one day. A live entry is stamped at its session's end, so it
// counts on the day the session ended.
export function dayStrip(state: GameState, habitId: string, days: number, now: number): number[] {
  const today = localDayStart(now);
  const starts: number[] = [];
  for (let back = days - 1; back >= -1; back--) {
    starts.push(new Date(today.getFullYear(), today.getMonth(), today.getDate() - back).getTime());
  }
  const strip = new Array<number>(days).fill(0);
  for (const entry of state.records.practiceLog) {
    if (entry.habitId !== habitId || entry.at < starts[0]! || entry.at >= starts[days]!) continue;
    let day = days - 1;
    while (entry.at < starts[day]!) day--;
    strip[day]! += entry.seconds;
  }
  return strip;
}
