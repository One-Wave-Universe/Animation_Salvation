import { useState } from 'react';
import { useAppStore } from '../store';
import { exportGLB, recordVideo } from '../lib/exportUtils';

export function ExportPanel() {
  const stage = useAppStore((s) => s.stage);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  if (stage !== 'ready') return null;

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
      await recordVideo(6, setProgress);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Recording failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel">
      <h2>4. Export</h2>
      <div className="row">
        <button className="btn" disabled={!!busy} onClick={doExportGlb}>
          {busy === 'glb' ? 'Exporting…' : 'Export GLB'}
        </button>
        <button className="btn btn-secondary" disabled={!!busy} onClick={doRecordVideo}>
          {busy === 'video' ? `Recording… ${Math.round(progress * 100)}%` : 'Record 6s video'}
        </button>
      </div>
      {err && <div className="error">{err}</div>}
    </div>
  );
}
