export type JointType = 'root' | 'ball' | 'hinge';

export interface BoneNode {
  id: string;
  name: string;
  parentId: string | null;
  /** Position in bind-pose model space (not parent-relative), Y-up, Z toward camera. */
  position: [number, number, number];
  /** Source-image pixel coordinates this bone was extracted from (Mode B layer segmentation). */
  pixelPosition?: [number, number];
  jointType: JointType;
  /** Local axis (unit vector, bind-pose model space) the hinge rotates around. */
  hingeAxis?: [number, number, number];
  hingeMinDeg?: number;
  hingeMaxDeg?: number;
  /** Max deflection of the bone direction away from its bind-pose direction. */
  ballConeLimitDeg?: number;
}

export interface RigDescription {
  bones: BoneNode[];
}

export type ActionType =
  | 'idle'
  | 'walk_to'
  | 'turn_to_face'
  | 'wave'
  | 'jump'
  | 'sit'
  | 'look_at'
  | 'move_to'
  | 'custom_pose';

export interface TimelineEvent {
  id: string;
  action: ActionType;
  start: number;
  duration: number;
  params: Record<string, unknown>;
}

export interface SceneTimeline {
  events: TimelineEvent[];
  totalDuration: number;
}

/** One control point of the depth->scale curve. depth: 0 = foreground (closest to
 *  camera), 1 = at the horizon (furthest away a grounded character can be). */
export interface DepthStop {
  depth: number;
  scale: number;
}

/**
 * Per-background calibration: turns "where are this character's feet in the
 * background image" into "how big should they render and how far into the scene
 * are they." Edited by a human (dragging the horizon/vanishing point, or the
 * depth-stop sliders) and by AI text commands ("put the horizon at 38%") through
 * the exact same store fields - there is only one calibration object, two ways
 * to change it.
 */
export interface SceneCalibration {
  sceneWidth: number;
  sceneHeight: number;
  /** Fraction (0-1) of sceneHeight where the horizon line sits. */
  horizonY: number;
  /** Fraction (0-1) of sceneWidth/sceneHeight where the vanishing point sits. */
  vanishingPointX: number;
  vanishingPointY: number;
  /** Depth -> scale control points, interpolated piecewise-linearly between them. */
  depthStops: DepthStop[];
}

/** Where a character's feet are planted in the current background, in fractions
 *  (0-1) of the background image's own width/height - not affected by viewport
 *  size or camera framing. */
export interface ScenePlacement {
  footX: number;
  footY: number;
}

export interface ProcessedCharacter {
  sourceImageUrl: string;
  imageWidth: number;
  imageHeight: number;
  mask: Uint8Array; // 0/255 per pixel, imageWidth*imageHeight
  depth: Float32Array; // 0..1 per pixel, imageWidth*imageHeight
}
