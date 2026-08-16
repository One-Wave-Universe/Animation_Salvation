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

export interface ProcessedCharacter {
  sourceImageUrl: string;
  imageWidth: number;
  imageHeight: number;
  mask: Uint8Array; // 0/255 per pixel, imageWidth*imageHeight
  depth: Float32Array; // 0..1 per pixel, imageWidth*imageHeight
}
