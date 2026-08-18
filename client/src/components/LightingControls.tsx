import { useAppStore } from '../store';

export function LightingControls() {
  const stage = useAppStore((s) => s.stage);
  const keyLightIntensity = useAppStore((s) => s.keyLightIntensity);
  const setKeyLightIntensity = useAppStore((s) => s.setKeyLightIntensity);
  const ambientIntensity = useAppStore((s) => s.ambientIntensity);
  const setAmbientIntensity = useAppStore((s) => s.setAmbientIntensity);

  if (stage !== 'ready') return null;

  return (
    <div className="panel">
      <h2>Lighting</h2>
      <label className="slider-row">
        <span>Key light</span>
        <input
          type="range"
          min={0}
          max={4}
          step={0.05}
          value={keyLightIntensity}
          onChange={(e) => setKeyLightIntensity(Number(e.target.value))}
        />
      </label>
      <label className="slider-row">
        <span>Ambient</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={ambientIntensity}
          onChange={(e) => setAmbientIntensity(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
