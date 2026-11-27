// The explicit recovery (ADR-0082): the explanation precedes the choice.
// It names the unreadable figures verbatim, what stands, what starts at
// 0, and that the original is kept.
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
      <p class="mono">Unreadable · {lost.join(", ")}</p>
      <p>
        Recovering keeps your habits, sessions, Notes and Intentions. The unreadable figures start at 0.
        The original save is kept as it was.
      </p>
      <p class="muted">Not now leaves the save untouched and asks again next time.</p>
      <div class="shell-actions">
        <button type="button" class="primary" onClick={onRecover}>Recover</button>
        <button type="button" onClick={onDownload}>Download original</button>
        <button type="button" class="quiet" onClick={onDecline}>Not now</button>
      </div>
      {error !== null && <p class="shell-error" role="alert">{error}</p>}
    </section>
  );
}
