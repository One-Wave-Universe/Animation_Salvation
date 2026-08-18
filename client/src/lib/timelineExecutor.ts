import * as THREE from 'three';
import type { SceneTimeline } from '../types';
import type { AnimatableRig } from './boneHierarchy';
import { ACTIONS, makeActionContext, type ActionContext } from './actions';

export class TimelineExecutor {
  private ctx: ActionContext;
  private eventState = new Map<string, Record<string, unknown>>();
  private clock = 0;
  timeline: SceneTimeline | null = null;
  playing = true;

  constructor(runtime: AnimatableRig) {
    this.ctx = makeActionContext(runtime);
  }

  setTimeline(timeline: SceneTimeline | null) {
    this.timeline = timeline;
    this.eventState.clear();
    this.clock = 0;
  }

  reset() {
    this.clock = 0;
    this.eventState.clear();
  }

  update(deltaSeconds: number) {
    if (this.playing) this.clock += deltaSeconds;

    // Reset transient per-frame pose state; idle always runs as the base layer.
    // Every bone goes back to bind pose first - otherwise a bone an action doesn't
    // touch this frame keeps whatever rotation the *previous* action last wrote
    // (quaternions are set directly in poseBone, not blended), and a later action
    // that moves/scales the root can drag that stale, often mid-swing rotation
    // through a large arc and shear the skin badly (e.g. jump immediately after
    // walk_to, which never un-bends the frozen mid-stride legs/arms).
    this.ctx.runtime.rootBone.position.set(0, 0, 0);
    this.ctx.runtime.rootBone.rotation.set(0, 0, 0);
    this.ctx.runtime.rootBone.scale.set(1, 1, 1);
    for (const bone of this.ctx.runtime.boneById.values()) {
      if (bone !== this.ctx.runtime.rootBone) bone.quaternion.identity();
    }

    ACTIONS.idle(this.ctx, 1, this.clock, {}, this.stateFor('__idle'));

    if (!this.timeline) return;
    for (const event of this.timeline.events) {
      if (this.clock < event.start || this.clock > event.start + event.duration) continue;
      const fn = ACTIONS[event.action];
      if (!fn) continue;
      const t = event.duration > 0 ? THREE.MathUtils.clamp((this.clock - event.start) / event.duration, 0, 1) : 1;
      const elapsed = this.clock - event.start;
      fn(this.ctx, t, elapsed, event.params, this.stateFor(event.id));
    }
  }

  private stateFor(id: string): Record<string, unknown> {
    if (!this.eventState.has(id)) this.eventState.set(id, {});
    return this.eventState.get(id)!;
  }
}
