import { useCallback, useRef } from 'react';
import { useAppStore } from '../store';
import { runPipeline } from '../lib/pipeline';
import { setCharacter } from '../lib/sceneRuntime';

const STAGE_LABELS: Record<string, string> = {
  'loading-image': 'Reading image',
  'estimating-depth': 'Estimating depth',
  'building-mesh': 'Building 3D mesh',
  'building-rig': 'Extracting skeleton & rig',
};

export function UploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const stage = useAppStore((s) => s.stage);
  const progressLabel = useAppStore((s) => s.progressLabel);
  const error = useAppStore((s) => s.error);
  const setStage = useAppStore((s) => s.setStage);
  const setError = useAppStore((s) => s.setError);
  const setImageUrl = useAppStore((s) => s.setImageUrl);
  const setRig = useAppStore((s) => s.setRig);
  const markReady = useAppStore((s) => s.markReady);

  const handleFile = useCallback(
    async (file: File) => {
      try {
        const result = await runPipeline(file, {
          onStage: (s, label) => setStage(s as never, label),
        });
        setCharacter(result.runtime, result.material, result.texture);
        setImageUrl(result.imageUrl);
        setRig(result.rig);
        setStage('ready');
        markReady();
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : 'Something went wrong processing that image.');
      }
    },
    [setStage, setError, setImageUrl, setRig, markReady],
  );

  const busy = stage !== 'idle' && stage !== 'ready' && stage !== 'error';

  return (
    <div className="panel">
      <h2>1. Upload character</h2>
      <p className="hint">A PNG with a transparent background works best. Full-body, front-facing poses rig most reliably.</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />
      <button className="btn" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Processing…' : stage === 'ready' ? 'Upload a different character' : 'Choose PNG…'}
      </button>
      {busy && (
        <div className="progress">
          <div className="spinner" />
          <span>{progressLabel ?? STAGE_LABELS[stage] ?? 'Working…'}</span>
        </div>
      )}
      {stage === 'error' && error && <div className="error">{error}</div>}
    </div>
  );
}
