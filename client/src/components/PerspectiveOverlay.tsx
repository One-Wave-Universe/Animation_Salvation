import { useRef, useState } from 'react';
import { useAppStore } from '../store';

/**
 * The perspective calibration guide - horizon line, vanishing point, and
 * convergence lines - rendered as an SVG layer sitting in normal DOM flow above
 * the WebGL <canvas>, not as geometry inside the Three.js scene. That's not a
 * style choice: canvas.captureStream() (see exportUtils.ts's recordVideo) can
 * only ever see pixels the canvas itself drew, so a guide that lives outside the
 * canvas element is structurally incapable of ending up in an exported video,
 * with no toggle-before-export step to remember.
 *
 * Both a human (dragging the horizon line or the vanishing point handle) and AI
 * text commands (see perspective.ts's parsePerspectiveCommand) write into the
 * exact same sceneCalibration store fields - there is one calibration object,
 * two ways to move it.
 */
export function PerspectiveOverlay() {
  const showPerspectiveGrid = useAppStore((s) => s.showPerspectiveGrid);
  const sceneCalibration = useAppStore((s) => s.sceneCalibration);
  const backgroundUrl = useAppStore((s) => s.backgroundUrl);
  const patchSceneCalibration = useAppStore((s) => s.patchSceneCalibration);
  const scenePlacement = useAppStore((s) => s.scenePlacement);
  const setScenePlacement = useAppStore((s) => s.setScenePlacement);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'horizon' | 'vanishing' | 'foot' | null>(null);

  if (!showPerspectiveGrid || !backgroundUrl || !sceneCalibration) return null;

  const fractionFromEvent = (e: React.PointerEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const fx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const fy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { fx, fy };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const { fx, fy } = fractionFromEvent(e);
    if (dragging === 'horizon') patchSceneCalibration({ horizonY: fy });
    else if (dragging === 'vanishing') patchSceneCalibration({ vanishingPointX: fx, vanishingPointY: fy });
    else if (dragging === 'foot') setScenePlacement({ footX: fx, footY: fy });
  };

  const endDrag = () => setDragging(null);

  const horizonPct = sceneCalibration.horizonY * 100;
  const vpXPct = sceneCalibration.vanishingPointX * 100;
  const vpYPct = sceneCalibration.vanishingPointY * 100;
  const footXPct = scenePlacement.footX * 100;
  const footYPct = scenePlacement.footY * 100;

  const corners: [number, number][] = [
    [0, 0],
    [100, 0],
    [0, 100],
    [100, 100],
  ];

  return (
    <div
      ref={containerRef}
      className="perspective-overlay"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {corners.map(([cx, cy], i) => (
          <line
            key={i}
            x1={`${cx}%`}
            y1={`${cy}%`}
            x2={`${vpXPct}%`}
            y2={`${vpYPct}%`}
            stroke="rgba(95,227,163,0.35)"
            strokeWidth={1}
          />
        ))}
        <line x1="0%" y1={`${horizonPct}%`} x2="100%" y2={`${horizonPct}%`} stroke="#5fe3a3" strokeWidth={2} strokeDasharray="6 4" />
        <circle cx={`${vpXPct}%`} cy={`${vpYPct}%`} r={6} fill="#e8a35c" stroke="#0f1114" strokeWidth={1.5} />
        <circle cx={`${footXPct}%`} cy={`${footYPct}%`} r={7} fill="#6fa8f5" stroke="#0f1114" strokeWidth={1.5} />
      </svg>

      <div
        className="perspective-handle perspective-handle-horizon"
        style={{ top: `${horizonPct}%` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging('horizon');
        }}
        title="Drag to set horizon"
      />
      <div
        className="perspective-handle perspective-handle-point"
        style={{ left: `${vpXPct}%`, top: `${vpYPct}%` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging('vanishing');
        }}
        title="Drag to set vanishing point"
      />
      <div
        className="perspective-handle perspective-handle-foot"
        style={{ left: `${footXPct}%`, top: `${footYPct}%` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging('foot');
        }}
        title="Drag to place character's feet"
      />
    </div>
  );
}
