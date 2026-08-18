import type { DepthStop, SceneCalibration } from '../types';

/**
 * Default depth stops for a typical scene: foreground reads full size, distance
 * shrinks a character down toward the horizon. Matches the reference curve given
 * for this feature - foreground 1.00x down to near-horizon 0.22x - not derived
 * from any real-world lens math, just a usable default an author can retune per
 * background via the calibration UI.
 */
const DEFAULT_DEPTH_STOPS: DepthStop[] = [
  { depth: 0, scale: 1.0 },
  { depth: 0.2, scale: 0.82 },
  { depth: 0.4, scale: 0.68 },
  { depth: 0.6, scale: 0.48 },
  { depth: 0.8, scale: 0.34 },
  { depth: 1, scale: 0.22 },
];

export function defaultCalibration(sceneWidth: number, sceneHeight: number): SceneCalibration {
  return {
    sceneWidth,
    sceneHeight,
    horizonY: 0.38,
    vanishingPointX: 0.5,
    vanishingPointY: 0.38,
    depthStops: DEFAULT_DEPTH_STOPS.map((s) => ({ ...s })),
  };
}

/**
 * Foot Y (background pixels, 0 at top) -> depth fraction (0 = foreground/bottom
 * edge of the scene, 1 = at the horizon line). A foot above the horizon (e.g.
 * dragged there by mistake, or a background with no ground below the horizon)
 * clamps to 1 rather than producing depth > 1 or a negative scale.
 */
export function depthForFootY(calibration: SceneCalibration, footY: number): number {
  const horizonPx = calibration.horizonY * calibration.sceneHeight;
  const bottomPx = calibration.sceneHeight;
  if (bottomPx <= horizonPx) return 0;
  const raw = (bottomPx - footY) / (bottomPx - horizonPx);
  return Math.max(0, Math.min(1, raw));
}

/** Piecewise-linear interpolation through the calibration's depth stops. */
export function scaleForDepth(calibration: SceneCalibration, depth: number): number {
  const stops = [...calibration.depthStops].sort((a, b) => a.depth - b.depth);
  if (stops.length === 0) return 1;
  const d = Math.max(0, Math.min(1, depth));
  if (d <= stops[0].depth) return stops[0].scale;
  const last = stops[stops.length - 1];
  if (d >= last.depth) return last.scale;
  for (let i = 1; i < stops.length; i++) {
    if (d <= stops[i].depth) {
      const a = stops[i - 1];
      const b = stops[i];
      const span = b.depth - a.depth;
      const t = span === 0 ? 0 : (d - a.depth) / span;
      return a.scale + (b.scale - a.scale) * t;
    }
  }
  return last.scale;
}

export function scaleForFootY(calibration: SceneCalibration, footY: number): number {
  return scaleForDepth(calibration, depthForFootY(calibration, footY));
}

/**
 * Parses the small set of natural-language calibration commands this feature is
 * meant to accept ("put the horizon at 38%", "move vanishing point slightly
 * left", "make the back scale .30", "show the perspective grid") into a partial
 * patch the caller applies to the current calibration/grid-visibility state.
 * Deliberately narrow pattern matching, not a general NL parser - the brief's own
 * examples are the whole target surface. Returns null (and changes nothing) for
 * anything it doesn't recognize, so an unrecognized command is a visible no-op
 * rather than a silent misinterpretation.
 */
export interface PerspectiveCommandResult {
  calibrationPatch?: Partial<SceneCalibration>;
  showGrid?: boolean;
}

const DEPTH_STOP_NAMES: Record<string, number> = {
  foreground: 0,
  'near-mid': 0.2,
  nearmid: 0.2,
  middle: 0.4,
  mid: 0.4,
  'far-mid': 0.6,
  farmid: 0.6,
  back: 0.8,
  horizon: 1,
  'near horizon': 1,
};

export function parsePerspectiveCommand(text: string, current: SceneCalibration): PerspectiveCommandResult | null {
  const t = text.trim().toLowerCase();

  const gridOn = /\b(show|enable|turn on)\b.*\b(grid|perspective|guide)/.test(t);
  const gridOff = /\b(hide|disable|turn off)\b.*\b(grid|perspective|guide)/.test(t);
  if (gridOn) return { showGrid: true };
  if (gridOff) return { showGrid: false };

  const horizonMatch = t.match(/horizon\D*?(-?\d+(?:\.\d+)?)\s*%?/);
  if (/horizon/.test(t) && horizonMatch) {
    const pct = parseFloat(horizonMatch[1]);
    return { calibrationPatch: { horizonY: clampFraction(pct / 100) } };
  }

  if (/vanishing point/.test(t)) {
    const nudge = /slightly|a bit|a little/.test(t) ? 0.03 : 0.08;
    if (/left/.test(t)) return { calibrationPatch: { vanishingPointX: clampFraction(current.vanishingPointX - nudge) } };
    if (/right/.test(t)) return { calibrationPatch: { vanishingPointX: clampFraction(current.vanishingPointX + nudge) } };
    const pctMatch = t.match(/(-?\d+(?:\.\d+)?)\s*%/);
    if (pctMatch) return { calibrationPatch: { vanishingPointX: clampFraction(parseFloat(pctMatch[1]) / 100) } };
  }

  for (const [name, depth] of Object.entries(DEPTH_STOP_NAMES)) {
    if (t.includes(name)) {
      const scaleMatch = t.match(/(-?\d*\.?\d+)/g);
      const scaleValue = scaleMatch?.map(Number).find((n) => n > 0 && n <= 2);
      if (scaleValue !== undefined) {
        const stops = current.depthStops.map((s) => (Math.abs(s.depth - depth) < 1e-6 ? { ...s, scale: scaleValue } : s));
        return { calibrationPatch: { depthStops: stops } };
      }
    }
  }

  return null;
}

function clampFraction(v: number): number {
  return Math.max(0, Math.min(1, v));
}
