import * as THREE from 'three';
import type { SceneTimeline } from '../types';
import type { RigRuntime } from './skinning';
import { ACTIONS, makeActionContext, type ActionContext } from './actions';

export class TimelineExecutor {
  private ctx: ActionContext;
  private eventState = new Map<string, Record<string, unknown>>();
  private clock = 0;
  timeline: SceneTimeline | null = null;
  playing = true;

  constructor(runtime: RigRuntime) {
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
    this.ctx.runtime.rootBone.position.set(0, 0, 0);
    this.ctx.runtime.rootBone.rotation.set(0, 0, 0);
    this.ctx.runtime.skinnedMesh.scale.set(1, 1, 1);

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
