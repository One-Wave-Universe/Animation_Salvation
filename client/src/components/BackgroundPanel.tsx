import { useAppStore } from '../store';

const BACKGROUNDS = [
  { label: 'Forest fork', url: '/production-pack/episode-01/backgrounds/forest-fork-machine-v1.png' },
  { label: 'Forest fork (machine active)', url: '/production-pack/episode-01/backgrounds/forest-fork-machine-activated-v1.png' },
];

export function BackgroundPanel() {
  const backgroundUrl = useAppStore((s) => s.backgroundUrl);
  const setBackgroundUrl = useAppStore((s) => s.setBackgroundUrl);

  return (
    <div className="panel">
      <h2>Background</h2>
      <p className="hint">Locked Episode 01 plates — composited behind the character, not baked into the mesh.</p>
      <div className="row">
        {BACKGROUNDS.map((bg) => (
          <button
            key={bg.url}
            className={`btn btn-secondary ${backgroundUrl === bg.url ? 'btn-active' : ''}`}
            onClick={() => setBackgroundUrl(backgroundUrl === bg.url ? null : bg.url)}
          >
            {bg.label}
          </button>
        ))}
      </div>
    </div>
  );
}
