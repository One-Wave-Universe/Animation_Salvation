import { useAppStore } from '../store';

const PRESETS: { key: string; label: string }[] = [
  { key: 'front', label: 'Front' },
  { key: 'threeQuarter', label: '3/4' },
  { key: 'side', label: 'Side' },
  { key: 'back', label: 'Back' },
  { key: 'top', label: 'Top' },
  { key: 'closeUp', label: 'Close-up' },
];

export function CameraControls() {
  const stage = useAppStore((s) => s.stage);
  const requestCameraPreset = useAppStore((s) => s.requestCameraPreset);

  if (stage !== 'ready') return null;

  return (
    <div className="panel">
      <h2>Camera</h2>
      <p className="hint">Jump to a fixed angle, or drag/scroll the viewport to orbit freely at any time.</p>
      <div className="preset-grid">
        {PRESETS.map((p) => (
          <button key={p.key} className="btn btn-secondary" onClick={() => requestCameraPreset(p.key)}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
