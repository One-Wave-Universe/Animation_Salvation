import { useCallback, useRef } from 'react';
import { useAppStore } from '../store';
import { runPipeline } from '../lib/pipeline';
import { runLayeredPipeline } from '../lib/layeredPipeline';

const STAGE_LABELS: Record<string, string> = {
  'loading-image': 'Reading image',
  'estimating-depth': 'Estimating depth',
  'building-mesh': 'Building 3D mesh',
  'building-rig': 'Extracting skeleton & rig',
};

export function UploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const stage = useAppStore((s) => s.stage);
  const progressLabel = useAppStore((s) => s.progressLabel);
  const error = useAppStore((s) => s.error);
  const setStage = useAppStore((s) => s.setStage);
  const setError = useAppStore((s) => s.setError);
  const setImageUrl = useAppStore((s) => s.setImageUrl);
  const setRig = useAppStore((s) => s.setRig);
  const markReady = useAppStore((s) => s.markReady);
  const setInpaintRegionsCount = useAppStore((s) => s.setInpaintRegionsCount);

  const busy = stage !== 'idle' && stage !== 'ready' && stage !== 'error';

  const setInpaintBusy = useAppStore((s) => s.setInpaintBusy);
  const setInpaintProgress = useAppStore((s) => s.setInpaintProgress);
  const setInpaintDone = useAppStore((s) => s.setInpaintDone);
  const setInpaintError = useAppStore((s) => s.setInpaintError);

  const handleFile = useCallback(
    async (file: File) => {
      try {
        setInpaintBusy(false);
        setInpaintProgress(null);
        setInpaintDone(false);
        setInpaintError(null);
        const onStage = (s: string, label?: string) => setStage(s as never, label);
        if (mode === 'photo') {
          const result = await runLayeredPipeline(file, { onStage });
          setImageUrl(result.imageUrl);
          setRig(result.rig);
          setInpaintRegionsCount(result.regionsCount);
        } else {
          const result = await runPipeline(file, { onStage });
          setImageUrl(result.imageUrl);
          setRig(result.rig);
          setInpaintRegionsCount(0);
        }
        setStage('ready');
        markReady();
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : 'Something went wrong processing that image.');
      }
    },
    [
      mode,
      setStage,
      setError,
      setImageUrl,
      setRig,
      markReady,
      setInpaintRegionsCount,
      setInpaintBusy,
      setInpaintProgress,
      setInpaintDone,
      setInpaintError,
    ],
  );

  return (
    <div className="panel">
      <h2>Upload character</h2>

      <div className="mode-toggle">
        <button className={`mode-btn ${mode === 'rig3d' ? 'mode-btn-active' : ''}`} disabled={busy} onClick={() => setMode('rig3d')}>
          3D Rig
        </button>
        <button className={`mode-btn ${mode === 'photo' ? 'mode-btn-active' : ''}`} disabled={busy} onClick={() => setMode('photo')}>
          Photo Animation
        </button>
      </div>
      <p className="hint">
        {mode === 'rig3d'
          ? 'A continuous 3D mesh with a full skeleton — best for big motion (walking, jumping, gestures). The back is a guessed mirror of the front.'
          : "The character split into flat per-limb layers, kept as the original photo pixels — best for subtle, photorealistic motion (sway, head turn). Gaps revealed by moving parts can be filled with AI inpainting (costs money, see step 2)."}
      </p>
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
