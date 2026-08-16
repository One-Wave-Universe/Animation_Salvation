import { useState } from 'react';
import { useAppStore } from '../store';
import { exportGLB, recordVideo } from '../lib/exportUtils';
import { sceneRuntime } from '../lib/sceneRuntime';

const IDLE_ONLY_DURATION = 6;

export function ExportPanel() {
  const stage = useAppStore((s) => s.stage);
  const timeline = useAppStore((s) => s.timeline);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  if (stage !== 'ready') return null;

  const recordDuration = timeline ? Math.max(2, Math.ceil(timeline.totalDuration)) : IDLE_ONLY_DURATION;

  const doExportGlb = async () => {
    setBusy('glb');
    setErr(null);
    try {
      await exportGLB();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setBusy(null);
    }
  };

  const doRecordVideo = async () => {
    setBusy('video');
    setErr(null);
    setProgress(0);
    try {
      // Start the clip from the beginning of whatever's queued up, not wherever
      // live playback happened to be sitting when the button was clicked.
      sceneRuntime.executor?.reset();
      await recordVideo(recordDuration, setProgress);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Recording failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel">
      <h2>Export</h2>
      <div className="row">
        <button className="btn" disabled={!!busy} onClick={doExportGlb}>
          {busy === 'glb' ? 'Exporting…' : 'Export GLB'}
        </button>
        <button className="btn btn-secondary" disabled={!!busy} onClick={doRecordVideo}>
          {busy === 'video' ? `Recording… ${Math.round(progress * 100)}%` : `Record ${recordDuration}s video`}
        </button>
      </div>
      <p className="hint small">
        {timeline
          ? `Matches the current action sequence (${recordDuration}s).`
          : 'No action queued — this will just record the idle sway. Pick a quick action or direct a scene first.'}
      </p>
      {err && <div className="error">{err}</div>}
    </div>
  );
}
