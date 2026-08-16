import { SceneTimelineSchema, type SceneTimeline } from './timelineSchema.js';

export interface BoneSummary {
  name: string;
  jointType: string;
}

export const SYSTEM_PROMPT = `You are a scene director for a rigged 3D character animator. Given a free-text
description of what should happen, and the list of bones actually present on this
character's auto-generated rig, call the emit_timeline tool with a timeline of
actions that stages the scene.

Rules:
- Only reference actions from the fixed action library (see the tool schema);
  there is no way to invent new actions.
- Bone-targeted actions (wave) only work if a bone whose name starts with the
  needed prefix exists (e.g. "wave" needs an "Arm.L" or "Arm.R" bone; "look_at"
  needs a "Head" bone; walk/sit leg motion needs "Leg.*" bones). If the rig has no
  matching bones, prefer move_to/turn_to_face/idle/jump instead, which only need
  the root and always exist.
- Position units are meters in a ground-plane XZ space; the character starts at
  (0,0) facing +Z. Keep movements modest (roughly -3..3 on each axis) so the
  character stays in frame.
- Sequence events sensibly: order them in time (start/duration) so the described
  scene plays out in the right order; overlapping only when it's things that
  should genuinely happen together (e.g. walking while turning slightly).
- totalDuration must cover the last event's end time.
- Keep the timeline reasonably tight: prefer a handful of clear events over a
  huge number of tiny ones.`;

export function boneListText(bones: BoneSummary[]): string {
  return bones.map((b) => `${b.name} (${b.jointType})`).join(', ') || '(no bones detected)';
}

export function userPrompt(instruction: string, bones: BoneSummary[]): string {
  return `Available rig bones: ${boneListText(bones)}\n\nScene instruction: ${instruction}`;
}

/** Shared validation for both providers' raw tool-call JSON output. */
export function validateTimeline(raw: unknown): SceneTimeline {
  const parsed = SceneTimelineSchema.safeParse(raw);
  if (!parsed.success) {
    throw Object.assign(new Error(`The scene director returned an invalid timeline: ${parsed.error.message}`), { statusCode: 502 });
  }
  return {
    ...parsed.data,
    events: parsed.data.events.map((e, i) => ({ ...e, id: e.id ?? `evt_${i}` })),
  };
}

export function missingKeyError(envVar: string): Error {
  return Object.assign(new Error(`Server is missing ${envVar}. Set it in server/.env and restart the server.`), { statusCode: 500 });
}
