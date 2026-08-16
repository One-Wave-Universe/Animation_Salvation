import { useAppStore } from '../store';
import { sceneRuntime } from '../lib/sceneRuntime';
import { QUICK_ACTIONS } from '../lib/quickActions';

/** Free, instant, no API key — direct alternative to the AI scene director. */
export function QuickActionsPanel() {
  const stage = useAppStore((s) => s.stage);
  const timeline = useAppStore((s) => s.timeline);
  const setTimeline = useAppStore((s) => s.setTimeline);

  if (stage !== 'ready') return null;

  const run = (build: () => ReturnType<(typeof QUICK_ACTIONS)[number]['build']>) => {
    const built = build();
    setTimeline(built);
    sceneRuntime.executor?.reset();
    sceneRuntime.executor?.setTimeline(built);
    if (sceneRuntime.executor) sceneRuntime.executor.playing = true;
  };

  return (
    <div className="panel">
      <h2>Quick actions</h2>
      <p className="hint">No AI needed — instantly play a built-in motion, then record it below.</p>
      <div className="quick-actions-grid">
        {QUICK_ACTIONS.map((qa) => (
          <button key={qa.label} className="btn btn-secondary" onClick={() => run(qa.build)}>
            {qa.label}
          </button>
        ))}
      </div>
      {timeline && (
        <button
          className="btn btn-secondary"
          style={{ marginTop: 8 }}
          onClick={() => {
            setTimeline(null);
            sceneRuntime.executor?.setTimeline(null);
          }}
        >
          Stop / clear
        </button>
      )}
    </div>
  );
}
