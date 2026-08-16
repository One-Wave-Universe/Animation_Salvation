import { z } from 'zod';

export const ACTION_TYPES = [
  'idle',
  'walk_to',
  'turn_to_face',
  'wave',
  'jump',
  'sit',
  'look_at',
  'move_to',
  'custom_pose',
] as const;

export const TimelineEventSchema = z.object({
  id: z.string().optional(),
  action: z.enum(ACTION_TYPES),
  start: z.number().min(0),
  duration: z.number().min(0.05).max(30),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const SceneTimelineSchema = z.object({
  events: z.array(TimelineEventSchema).min(1).max(30),
  totalDuration: z.number().min(0.1).max(120),
});

export type SceneTimeline = z.infer<typeof SceneTimelineSchema>;

/**
 * Plain JSON Schema mirror of the above, for the Anthropic tool-use "emit_timeline"
 * tool definition (Anthropic tools take raw JSON Schema, not a zod object).
 */
export const TIMELINE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      minItems: 1,
      maxItems: 30,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Short unique id for this event.' },
          action: { type: 'string', enum: ACTION_TYPES },
          start: { type: 'number', minimum: 0, description: 'Seconds from the start of the scene.' },
          duration: { type: 'number', minimum: 0.05, maximum: 30 },
          params: {
            type: 'object',
            description:
              'Action-specific parameters. walk_to/move_to: {x,z} (and y for move_to) target position in meters, root starts at (0,0). turn_to_face/look_at: {x,y,z} point to face. wave: {hand: "left"|"right"}. jump: {height}. sit/idle: {}. custom_pose: {bonePoses: {[boneName]: [xRad,yRad,zRad]}}.',
          },
        },
        required: ['action', 'start', 'duration'],
      },
    },
    totalDuration: { type: 'number', minimum: 0.1, maximum: 120 },
  },
  required: ['events', 'totalDuration'],
} as const;
