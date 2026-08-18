import * as THREE from 'three';
import type { SceneTimeline } from '../types';
import type { AnimatableRig } from './boneHierarchy';
import { ACTIONS, makeActionContext, type ActionContext } from './actions';
import { poseBone } from './jointConstraints';
import { sceneRuntime } from './sceneRuntime';

// How quickly the rendered pose catches up to the raw target pose, in seconds.
// Bind-pose resets and hard cuts between actions produce an instantaneous
// target change every frame; slewing the *rendered* transform toward that
// target (instead of applying it directly) turns those pops into a fast but
// continuous catch-up instead of a snap, without changing any action's math.
const SMOOTHING_TAU = 0.09;

export class TimelineExecutor {
  private ctx: ActionContext;
  private eventState = new Map<string, Record<string, unknown>>();
  private clock = 0;
  private smoothedBoneQuat = new Map<string, THREE.Quaternion>();
  private smoothedRootPos = new THREE.Vector3();
  private smoothedRootQuat = new THREE.Quaternion();
  private smoothedRootScale = new THREE.Vector3(1, 1, 1);
  private smoothingPrimed = false;
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

    if (this.timeline) {
      for (const event of this.timeline.events) {
        if (this.clock < event.start || this.clock > event.start + event.duration) continue;
        const fn = ACTIONS[event.action];
        if (!fn) continue;
        const t = event.duration > 0 ? THREE.MathUtils.clamp((this.clock - event.start) / event.duration, 0, 1) : 1;
        const elapsed = this.clock - event.start;
        fn(this.ctx, t, elapsed, event.params, this.stateFor(event.id));
      }
    }

    this.applyManualOverrides();
    this.smoothPose(deltaSeconds);
  }

  /**
   * Gamepad-driven joint posing (GamepadJointControl.tsx writes into
   * sceneRuntime.manualBoneOverrides). Runs after idle/actions so manual
   * control wins over whatever's playing, and through poseBone so a ball
   * joint still respects its cone limit and a hinge still respects its axis
   * and range - the same constraints every other action is subject to,
   * not a bypass. Runs before smoothPose so manual input gets the same
   * catch-up damping as everything else instead of snapping frame to frame.
   */
  private applyManualOverrides() {
    if (sceneRuntime.manualBoneOverrides.size === 0) return;
    const q = new THREE.Quaternion();
    for (const [boneId, euler] of sceneRuntime.manualBoneOverrides) {
      const bone = this.ctx.runtime.boneById.get(boneId);
      const desc = this.ctx.runtime.rig.bones.find((b) => b.id === boneId);
      if (!bone || !desc || desc.jointType === 'root') continue;
      q.setFromEuler(euler);
      poseBone(bone, desc, q);
    }
  }

  /**
   * Slews the actually-rendered transform toward the raw target every frame
   * instead of applying the target directly - see SMOOTHING_TAU. Runs after
   * idle/actions have written their raw target into rootBone and every bone's
   * quaternion, then overwrites those same fields with the smoothed result.
   */
  private smoothPose(deltaSeconds: number) {
    const root = this.ctx.runtime.rootBone;
    const alpha = this.smoothingPrimed ? 1 - Math.exp(-Math.max(deltaSeconds, 0) / SMOOTHING_TAU) : 1;
    this.smoothingPrimed = true;

    this.smoothedRootPos.lerp(root.position, alpha);
    this.smoothedRootQuat.slerp(root.quaternion, alpha);
    this.smoothedRootScale.lerp(root.scale, alpha);
    root.position.copy(this.smoothedRootPos);
    root.quaternion.copy(this.smoothedRootQuat);
    root.scale.copy(this.smoothedRootScale);

    for (const [id, bone] of this.ctx.runtime.boneById) {
      if (bone === root) continue;
      let smoothed = this.smoothedBoneQuat.get(id);
      if (!smoothed) {
        smoothed = bone.quaternion.clone();
        this.smoothedBoneQuat.set(id, smoothed);
      }
      smoothed.slerp(bone.quaternion, alpha);
      bone.quaternion.copy(smoothed);
    }
  }

  private stateFor(id: string): Record<string, unknown> {
    if (!this.eventState.has(id)) this.eventState.set(id, {});
    return this.eventState.get(id)!;
  }
}
