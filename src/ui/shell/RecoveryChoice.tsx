// The explicit recovery (ADR-0082): what the choice needs precedes it —
// the unreadable figures verbatim and that they start at 0, what stands,
// and that the original is kept. Nothing more.
interface Props {
  lost: string[];
  error: string | null;
  onRecover: () => void;
  onDownload: () => void;
  onDecline: () => void;
}

export function RecoveryChoice({ lost, error, onRecover, onDownload, onDecline }: Props) {
  return (
    <section class="shell-panel" aria-labelledby="recovery-title">
      <p class="eyebrow">Recovery</p>
      <h2 id="recovery-title" class="shell-title">This save can't be read as it is</h2>
      <p class="mono">Unreadable · {lost.join(", ")} · start at 0</p>
      <p>Kept · your habits, sessions, Notes and Intentions, and the original save</p>
      <div class="shell-actions">
        <button type="button" class="primary" onClick={onRecover}>Recover</button>
        <button type="button" onClick={onDownload}>Download original</button>
        <button type="button" class="quiet" onClick={onDecline}>Not now</button>
      </div>
      {error !== null && <p class="shell-error" role="alert">{error}</p>}
    </section>
  );
}
