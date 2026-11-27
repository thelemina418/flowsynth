import { useState } from "preact/hooks";
import { formatClock, formatDuration } from "../../engine/clock";
import { REFLECTION_SLIDER_NEUTRAL } from "../../engine/constants";
import { intentionSummary } from "../../engine/intentions";
import { habitRecordName, recordMissed, recordTargetHit, sessionRecordsNewestFirst } from "../../engine/records";
import type { GameState, HonestyOutcome, SessionRecord } from "../../engine/types";

// The Almanac's history surface (issue #43), ported from the old
// console's history face (`8ecaeac^` focus.ts, format.ts): the legacy
// line for a migrated player, then the session records newest first,
// twenty at a time, each row `Sep 19 · Piano · 25 / 25 min` with a hit or
// a muted miss chip. A row opens the full record: when, plan, practice
// time, honesty, the saved reflection, and the Intentions it advanced.

const PAGE = 20;

const OUTCOME: Record<HonestyOutcome, string> = {
  missed: "didn't practice",
  planned: "did what I planned",
  full: "practiced the whole time away",
};

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const DATE_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function date(ms: number, withYear = false): string {
  if (!(ms > 0)) return "—";
  return (withYear ? DATE_YEAR : DATE).format(ms);
}

function minutes(seconds: number): number {
  return Math.max(0, Math.floor(seconds / 60 + 1e-9));
}

// `X / Y min` for a planned session, `X min` for an open-ended one.
function practice(record: SessionRecord): string {
  return record.plannedTarget === null ? `${minutes(record.creditedSeconds)} min` : `${minutes(record.creditedSeconds)} / ${minutes(record.plannedTarget)} min`;
}

function valence(slider: number): string {
  if (slider === REFLECTION_SLIDER_NEUTRAL) return "";
  return ` · felt ${slider < REFLECTION_SLIDER_NEUTRAL ? "rough" : "great"}`;
}

function Record({ state, record, onBack }: { state: GameState; record: SessionRecord; onBack: () => void }) {
  const habit = record.habitId === null ? "Unstructured practice" : habitRecordName(state, record.habitId);
  const plan = record.plannedTarget !== null ? `Planned · ${formatClock(record.plannedTarget)}` : "Open-ended";
  const reflection = record.reflection;
  return (
    <div class="almanac-surface history-record">
      <button type="button" class="quiet small history-back" onClick={onBack}>
        ← History
      </button>
      <h3 class="history-title">{`Session ${record.sessionNumber} · ${habit}`}</h3>
      <div class="history-stat">
        <span>When</span>
        <span class="mono">{`${date(record.startedAt, true)} – ${date(record.endedAt, true)}`}</span>
      </div>
      <div class="history-stat">
        <span>Plan</span>
        <span class="mono">{plan}</span>
      </div>
      <div class="history-stat">
        <span>Practice time</span>
        <span class="mono">{practice(record)}</span>
      </div>
      <span class="eyebrow">Honesty</span>
      {record.honestyEvents.length > 0 ? (
        record.honestyEvents.map((event, index) => <p key={index} class="history-line">{`${formatDuration(event.awaySeconds)} away · ${OUTCOME[event.outcome]}`}</p>)
      ) : (
        <p class="history-line muted">Nothing to reconcile.</p>
      )}
      <span class="eyebrow">Reflection</span>
      {reflection === null ? <p class="history-line muted">No reflection.</p> : <p class="history-line">{`"${reflection.text}"${valence(reflection.slider)}`}</p>}
      <span class="eyebrow">Intentions advanced</span>
      {record.goalsAdvanced.length > 0 ? (
        record.goalsAdvanced.map(({ goalId, seconds, goal }) => {
          const intention = goal ?? state.records.intentions.find((g) => g.id === goalId);
          return <p key={goalId} class="history-line">{`${minutes(seconds)} min · ${intention ? intentionSummary(state, intention) : "a since-removed Intention"}`}</p>;
        })
      ) : (
        <p class="history-line muted">No Intentions advanced.</p>
      )}
    </div>
  );
}

export function AlmanacHistory({ state }: { state: GameState }) {
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<number | null>(null);
  const records = sessionRecordsNewestFirst(state);
  const record = open === null ? undefined : records.find((r) => r.sessionNumber === open);
  if (record) return <Record state={state} record={record} onBack={() => setOpen(null)} />;
  const legacy = state.game.legacyLine;
  return (
    <div class="almanac-surface">
      {legacy !== null && (
        <p class="history-legacy mono muted" data-legacy="">
          {legacy}
        </p>
      )}
      {records.length === 0 && <p class="history-line muted">No sessions yet.</p>}
      {records.slice(0, shown).map((row) => (
        <button type="button" key={row.sessionNumber} class="history-row" data-session={String(row.sessionNumber)} onClick={() => setOpen(row.sessionNumber)}>
          <span class="mono">{date(row.startedAt)}</span>
          <span class="history-habit">{row.habitId === null ? "unstructured" : habitRecordName(state, row.habitId)}</span>
          <span class="mono">{practice(row)}</span>
          {recordMissed(row) ? <span class="history-chip" data-miss="">miss</span> : recordTargetHit(row) ? <span class="history-chip" data-hit="">hit</span> : <span />}
        </button>
      ))}
      {records.length > shown && (
        <button type="button" class="quiet small" onClick={() => setShown(shown + PAGE)}>
          {`Show ${Math.min(PAGE, records.length - shown)} more`}
        </button>
      )}
    </div>
  );
}
