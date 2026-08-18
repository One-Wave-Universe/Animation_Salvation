import { useState } from 'react';
import { useAppStore } from '../store';
import { parsePerspectiveCommand } from '../lib/perspective';

/**
 * Human controls (sliders) and an AI text-command box for the same scene
 * calibration object the drag handles in PerspectiveOverlay edit - "same data,
 * two interfaces." Only shown once a background with known dimensions exists,
 * since calibration is meaningless without a background to calibrate against.
 */
export function PerspectiveControls() {
  const backgroundUrl = useAppStore((s) => s.backgroundUrl);
  const sceneCalibration = useAppStore((s) => s.sceneCalibration);
  const patchSceneCalibration = useAppStore((s) => s.patchSceneCalibration);
  const showPerspectiveGrid = useAppStore((s) => s.showPerspectiveGrid);
  const setShowPerspectiveGrid = useAppStore((s) => s.setShowPerspectiveGrid);
  const scenePlacement = useAppStore((s) => s.scenePlacement);
  const setScenePlacement = useAppStore((s) => s.setScenePlacement);
  const [command, setCommand] = useState('');
  const [commandFeedback, setCommandFeedback] = useState<string | null>(null);

  if (!backgroundUrl || !sceneCalibration) return null;

  const runCommand = () => {
    const result = parsePerspectiveCommand(command, sceneCalibration);
    if (!result) {
      setCommandFeedback(`Didn't recognize that — try "put the horizon at 38%" or "make the back scale .30".`);
      return;
    }
    if (result.calibrationPatch) patchSceneCalibration(result.calibrationPatch);
    if (result.showGrid !== undefined) setShowPerspectiveGrid(result.showGrid);
    setCommandFeedback('Applied.');
    setCommand('');
  };

  return (
    <div className="panel">
      <h2>Perspective</h2>
      <p className="hint">
        The background is the scene. Drag the horizon (dashed line), vanishing point (orange dot), or the character's
        feet (blue dot) directly in the viewport, or use the controls below — same calibration either way.
      </p>

      <button className={`btn btn-secondary ${showPerspectiveGrid ? 'btn-active' : ''}`} onClick={() => setShowPerspectiveGrid(!showPerspectiveGrid)}>
        {showPerspectiveGrid ? 'Hide' : 'Show'} perspective grid
      </button>

      <div className="slider-row" style={{ marginTop: 10 }}>
        <span>Horizon {(sceneCalibration.horizonY * 100).toFixed(0)}%</span>
        <input
          type="range"
          min={0}
          max={100}
          value={sceneCalibration.horizonY * 100}
          onChange={(e) => patchSceneCalibration({ horizonY: Number(e.target.value) / 100 })}
        />
      </div>
      <div className="slider-row">
        <span>Vanishing pt X {(sceneCalibration.vanishingPointX * 100).toFixed(0)}%</span>
        <input
          type="range"
          min={0}
          max={100}
          value={sceneCalibration.vanishingPointX * 100}
          onChange={(e) => patchSceneCalibration({ vanishingPointX: Number(e.target.value) / 100 })}
        />
      </div>
      <div className="slider-row">
        <span>Foot depth {(scenePlacement.footY * 100).toFixed(0)}%</span>
        <input
          type="range"
          min={0}
          max={100}
          value={scenePlacement.footY * 100}
          onChange={(e) => setScenePlacement({ footY: Number(e.target.value) / 100 })}
        />
      </div>

      {sceneCalibration.depthStops.map((stop) => (
        <div className="slider-row" key={stop.depth}>
          <span>
            Scale @ {(stop.depth * 100).toFixed(0)}% depth: {stop.scale.toFixed(2)}x
          </span>
          <input
            type="range"
            min={0.05}
            max={1.2}
            step={0.01}
            value={stop.scale}
            onChange={(e) => {
              const scale = Number(e.target.value);
              patchSceneCalibration({
                depthStops: sceneCalibration.depthStops.map((s) => (s.depth === stop.depth ? { ...s, scale } : s)),
              });
            }}
          />
        </div>
      ))}

      <div className="row" style={{ marginTop: 10 }}>
        <input
          className="text-input"
          placeholder='e.g. "put the horizon at 38%"'
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') runCommand();
          }}
        />
        <button className="btn btn-secondary" onClick={runCommand}>
          Apply
        </button>
      </div>
      {commandFeedback && <p className="hint small">{commandFeedback}</p>}
    </div>
  );
}
