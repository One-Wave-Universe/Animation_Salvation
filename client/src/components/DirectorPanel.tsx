import { useState } from 'react';
import { useAppStore } from '../store';
import { sceneRuntime } from '../lib/sceneRuntime';
import type { SceneTimeline } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';

export function DirectorPanel() {
  const [instruction, setInstruction] = useState('');
  const stage = useAppStore((s) => s.stage);
  const rig = useAppStore((s) => s.rig);
  const timeline = useAppStore((s) => s.timeline);
  const setTimeline = useAppStore((s) => s.setTimeline);
  const busy = useAppStore((s) => s.directorBusy);
  const setBusy = useAppStore((s) => s.setDirectorBusy);
  const error = useAppStore((s) => s.directorError);
  const setDirectorError = useAppStore((s) => s.setDirectorError);

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
      <h2>3. Direct the scene</h2>
      <p className="hint">Describe what happens — e.g. "wave hello, then walk forward and turn to face the left".</p>
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
          Needs the backend running locally with an <code>ANTHROPIC_API_KEY</code> set (see server/README).
        </p>
      )}
    </div>
  );
}
