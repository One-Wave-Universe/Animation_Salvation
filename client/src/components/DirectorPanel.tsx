import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { sceneRuntime } from '../lib/sceneRuntime';
import type { SceneTimeline } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';

type Provider = 'anthropic' | 'openai';
const PROVIDER_LABEL: Record<Provider, string> = { anthropic: 'Claude', openai: 'ChatGPT' };

interface HealthResponse {
  providers: Record<Provider, boolean>;
  defaultProvider: Provider;
}

export function DirectorPanel() {
  const [instruction, setInstruction] = useState('');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [provider, setProvider] = useState<Provider>('anthropic');
  const stage = useAppStore((s) => s.stage);
  const rig = useAppStore((s) => s.rig);
  const timeline = useAppStore((s) => s.timeline);
  const setTimeline = useAppStore((s) => s.setTimeline);
  const busy = useAppStore((s) => s.directorBusy);
  const setBusy = useAppStore((s) => s.setDirectorBusy);
  const error = useAppStore((s) => s.directorError);
  const setDirectorError = useAppStore((s) => s.setDirectorError);

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => r.json())
      .then((data: HealthResponse) => {
        setHealth(data);
        setProvider(data.defaultProvider);
      })
      .catch(() => setHealth(null));
  }, []);

  if (stage !== 'ready' || !rig) return null;

  const submit = async () => {
    if (!instruction.trim()) return;
    setBusy(true);
    setDirectorError(null);
    try {
      const res = await fetch(`${API_BASE}/api/direct-scene`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction,
          provider,
          bones: rig.bones.map((b) => ({ name: b.name, jointType: b.jointType })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Server error (${res.status})`);
      const newTimeline = data.timeline as SceneTimeline;
      setTimeline(newTimeline);
      sceneRuntime.executor?.setTimeline(newTimeline);
      sceneRuntime.executor!.playing = true;
    } catch (err) {
      setDirectorError(err instanceof Error ? err.message : 'Could not reach the scene director.');
    } finally {
      setBusy(false);
    }
  };

  const stop = () => {
    setTimeline(null);
    sceneRuntime.executor?.setTimeline(null);
  };

  return (
    <div className="panel">
      <h2>Direct the scene</h2>
      <p className="hint">Describe what happens — e.g. "wave hello, then walk forward and turn to face the left".</p>

      <div className="provider-toggle">
        {(['anthropic', 'openai'] as Provider[]).map((p) => {
          const configured = health?.providers[p] ?? true; // assume available until health loads
          return (
            <button
              key={p}
              className={`provider-btn ${provider === p ? 'provider-btn-active' : ''}`}
              disabled={!configured}
              title={configured ? undefined : `${p === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} not set on the server`}
              onClick={() => setProvider(p)}
            >
              {PROVIDER_LABEL[p]}
            </button>
          );
        })}
      </div>

      <textarea
        className="director-input"
        rows={3}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="Type what should happen…"
      />
      <div className="row">
        <button className="btn" disabled={busy || !instruction.trim()} onClick={submit}>
          {busy ? 'Directing…' : 'Make it happen'}
        </button>
        {timeline && (
          <button className="btn btn-secondary" onClick={stop}>
            Stop / clear
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {!import.meta.env.VITE_API_BASE && (
        <p className="hint small">
          Needs the backend running locally with an <code>ANTHROPIC_API_KEY</code> and/or <code>OPENAI_API_KEY</code> set (see
          server/README).
        </p>
      )}
    </div>
  );
}
