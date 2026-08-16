import { useAppStore } from '../store';
import { runInpaintingPass } from '../lib/layeredPipeline';

export function InpaintPanel() {
  const mode = useAppStore((s) => s.mode);
  const stage = useAppStore((s) => s.stage);
  const regionsCount = useAppStore((s) => s.inpaintRegionsCount);
  const busy = useAppStore((s) => s.inpaintBusy);
  const setBusy = useAppStore((s) => s.setInpaintBusy);
  const progress = useAppStore((s) => s.inpaintProgress);
  const setProgress = useAppStore((s) => s.setInpaintProgress);
  const done = useAppStore((s) => s.inpaintDone);
  const setDone = useAppStore((s) => s.setInpaintDone);
  const error = useAppStore((s) => s.inpaintError);
  const setError = useAppStore((s) => s.setInpaintError);
  const markReady = useAppStore((s) => s.markReady);

  if (mode !== 'photo' || stage !== 'ready') return null;

  const run = async () => {
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: regionsCount });
    try {
      await runInpaintingPass((p) => setProgress({ done: p.done, total: p.total }));
      setDone(true);
      markReady(); // remount the Viewport's layer group with the filled textures
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inpainting failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h2>Fill hidden areas</h2>
      {regionsCount === 0 || done ? (
        <p className="hint">
          {done ? 'Filled — moving a limb should no longer show a gap where it used to overlap.' : 'No hidden regions detected on this character.'}
        </p>
      ) : (
        <>
          <p className="hint">
            Found {regionsCount} spot{regionsCount === 1 ? '' : 's'} where one part overlaps another (e.g. an arm over the torso) — moving
            that part will show a gap unless it's filled in first.
          </p>
          <div className="cost-note">
            Uses OpenAI image editing — one API call per region, real cost, real wait (several seconds each).
          </div>
          <button className="btn" disabled={busy} onClick={run}>
            {busy && progress ? `Filling ${progress.done}/${progress.total}…` : `Fill ${regionsCount} region${regionsCount === 1 ? '' : 's'} with AI`}
          </button>
        </>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
