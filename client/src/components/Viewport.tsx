import { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react';
import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useAppStore } from '../store';
import { sceneRuntime } from '../lib/sceneRuntime';
import { GamepadJointControl } from './GamepadJointControl';
import { WorldMovementController } from './WorldMovementController';

export const BACKDROP_PLANE_Z = -6;

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const tmpQuat = new THREE.Quaternion();
const FACING_SMOOTH_TAU = 0.12;

/**
 * The world-space rectangle the backdrop image currently fills, found by
 * intersecting the camera's true forward ray with the plane (accounts for the
 * camera's tilt, not just raw z-distance) so it always exactly fills the frame.
 * Shared between the Backdrop mesh itself and character scene-placement, so a
 * character "standing" on a background pixel stays visually locked to that pixel
 * even as the (debug) camera orbits - both derive from the same live camera state.
 */
function computeBackdropFrame(camera: THREE.Camera, size: { width: number; height: number }, planeZ: number) {
  const perspective = camera as THREE.PerspectiveCamera;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const t = (planeZ - camera.position.z) / forward.z;
  const center = camera.position.clone().addScaledVector(forward, t);
  const distance = camera.position.distanceTo(center);

  const vFov = (perspective.fov * Math.PI) / 180;
  const frameHeight = 2 * Math.tan(vFov / 2) * distance;
  const frameWidth = frameHeight * (size.width / size.height);
  return { center, frameWidth, frameHeight, frameAspect: frameWidth / frameHeight };
}

/**
 * A soft radial-gradient blob under the character's feet - grounds him against
 * a photo background instead of reading as pasted on top. Deliberately a plain
 * alpha-blended decal (canvas-drawn gradient texture) rather than drei's
 * ContactShadows: that component renders through an offscreen render target
 * and a blur pass, which is worth avoiding here since this app is also driven
 * headlessly (Playwright + software WebGL) for testing, where render-target
 * paths are more likely to behave inconsistently than a single static texture.
 */
function ContactBlob() {
  const texture = useMemo(() => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0,0,0,0.7)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.55)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }, []);

  return (
    <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      <planeGeometry args={[1.6, 0.9]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/**
 * A locked Episode-01 plate, placed as a flat plane behind the character.
 * Sized to the *actual* view frustum at that depth (found by intersecting the
 * camera's true forward ray with the plane - accounts for the camera's
 * downward tilt, not just raw z-distance) so it always fills the frame with
 * no seam at the edges. The image is UV-cropped to "cover" that frame rather
 * than stretched, since the plate's aspect ratio rarely matches the canvas.
 */
function Backdrop({ url }: { url: string }) {
  const texture = useLoader(THREE.TextureLoader, url);
  const { camera, size } = useThree();
  const planeZ = BACKDROP_PLANE_Z;
  const ensureSceneCalibration = useAppStore((s) => s.ensureSceneCalibration);

  useEffect(() => {
    if (texture.image) ensureSceneCalibration(texture.image.width, texture.image.height);
  }, [texture, ensureSceneCalibration]);

  const { center, frameWidth, frameHeight, frameAspect } = computeBackdropFrame(camera, size, planeZ);

  const imageAspect = texture.image ? texture.image.width / texture.image.height : frameAspect;
  if (imageAspect > frameAspect) {
    texture.repeat.set(frameAspect / imageAspect, 1);
    texture.offset.set((1 - texture.repeat.x) / 2, 0);
  } else {
    texture.repeat.set(1, imageAspect / frameAspect);
    texture.offset.set(0, (1 - texture.repeat.y) / 2);
  }

  return (
    <mesh position={[center.x, center.y, planeZ]}>
      <planeGeometry args={[frameWidth, frameHeight]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

/**
 * A real, solid, walkable floor at y=0 - present whether or not a background is
 * loaded, so the character always has actual 3D ground to move across rather
 * than an implied one. Kept visually neutral (dark, matte) since it's meant to
 * ground the character physically, not compete with either the debug grid lines
 * or a painted backdrop's own perspective.
 */
function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[200, 200]} />
      <meshStandardMaterial color="#1c1f26" roughness={0.95} metalness={0} />
    </mesh>
  );
}

/** Keeps OrbitControls' target locked onto the character's current world position
 *  every frame, so a human free-orbiting the camera still has the character stay
 *  framed as WASD/gamepad movement carries them around the ground plane - a
 *  proper "game camera" follow instead of the character walking out of frame. */
const tmpFollowTarget = new THREE.Vector3();

function CameraFollow({ controlsRef }: { controlsRef: RefObject<OrbitControlsImpl | null> }) {
  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    tmpFollowTarget.copy(sceneRuntime.worldPosition);
    tmpFollowTarget.y += 0.9;
    controls.target.lerp(tmpFollowTarget, 0.08);
    controls.update();
  });
  return null;
}

function CanvasRegistrar() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    sceneRuntime.canvas = gl.domElement;
    sceneRuntime.gl = gl;
    sceneRuntime.threeScene = scene;
    sceneRuntime.threeCamera = camera;
    return () => {
      sceneRuntime.canvas = null;
      sceneRuntime.gl = null;
      sceneRuntime.threeScene = null;
      sceneRuntime.threeCamera = null;
    };
  }, [gl, scene, camera]);
  return null;
}

function CharacterMesh() {
  const groupRef = useRef<THREE.Group>(null);
  const helperRef = useRef<THREE.SkeletonHelper | null>(null);
  const wireframeRef = useRef<THREE.LineSegments | null>(null);
  const showSkeleton = useAppStore((s) => s.showSkeleton);
  const showWireframe = useAppStore((s) => s.showWireframe);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const group = groupRef.current;
    const obj = sceneRuntime.renderObject;
    if (!group || !obj) return;
    group.add(obj);
    // SkeletonHelper draws a bone from every Bone's position to its parent's -
    // exactly the "wire mesh" skeleton view: every joint, from any angle,
    // independent of whatever the skin mesh itself is doing. It has to be added
    // to the SCENE, not to `group` (this character's own [0,1,0]-offset parent):
    // three.js's SkeletonHelper sets its own `.matrix` to the target object's
    // *already-world-space* `.matrixWorld` (see its constructor), specifically so
    // it can be dropped in at the scene root. Parenting it under `group` instead
    // applies that same [0,1,0] offset a second time on top of the one already
    // baked into `obj.matrixWorld` - confirmed by reading the helper's own
    // matrixWorld back out (translation (0,2,0), not (0,1,0)) - which is what
    // read as a "floating skeleton" hovering a full body-height above the head.
    const helper = new THREE.SkeletonHelper(obj);
    helper.visible = false;
    scene.add(helper);
    helperRef.current = helper;

    // Toggling material.wireframe directly on the skinned mesh - even set
    // at material construction time, before ever rendering - never showed
    // any visible lines on this mesh, only a solid fill; a plain opaque
    // MeshBasicMaterial isolated the same way had the identical result, so
    // it wasn't the texture/alphaTest/transparency either. Whatever the
    // cause, an explicit WireframeGeometry + LineSegments overlay is the
    // standard, more reliable way to get a wireframe view in three.js and
    // sidesteps it entirely. Bind-pose only (doesn't track animation - the
    // overlay is a snapshot of the base geometry, not itself skinned) but
    // that's enough to inspect mesh topology/density from any angle, which
    // is the actual goal.
    let wireframe: THREE.LineSegments | null = null;
    if (obj instanceof THREE.SkinnedMesh) {
      const wireGeo = new THREE.WireframeGeometry(obj.geometry);
      wireframe = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x5fe3a3, transparent: true, opacity: 0.6 }));
      wireframe.visible = false;
      group.add(wireframe);
      wireframeRef.current = wireframe;
    }

    return () => {
      group.remove(obj);
      scene.remove(helper);
      helper.dispose();
      helperRef.current = null;
      if (wireframe) {
        group.remove(wireframe);
        wireframe.geometry.dispose();
        (wireframe.material as THREE.Material).dispose();
        wireframeRef.current = null;
      }
    };
  }, [scene]);

  useEffect(() => {
    if (helperRef.current) helperRef.current.visible = showSkeleton;
  }, [showSkeleton]);

  useEffect(() => {
    if (wireframeRef.current) wireframeRef.current.visible = showWireframe;
  }, [showWireframe]);

  const facingQuatRef = useRef(new THREE.Quaternion());

  useFrame((_, delta) => {
    sceneRuntime.executor?.update(Math.min(delta, 0.05));

    const group = groupRef.current;
    if (!group) return;
    // Real 3D placement: WorldMovementController writes sceneRuntime.worldPosition/
    // worldFacing every frame from WASD/gamepad input. y stays 0 - the ground plane
    // - since character-space y=0 is already the true foot position (see
    // computeImageToModelTransform in meshBuilder.ts). Scale is always 1: apparent
    // size comes from the camera's own perspective projection at whatever distance
    // the character actually is, not a hand-authored depth curve.
    group.position.copy(sceneRuntime.worldPosition);
    group.scale.set(1, 1, 1);
    const targetQuat = tmpQuat.setFromAxisAngle(UP_AXIS, sceneRuntime.worldFacing);
    facingQuatRef.current.slerp(targetQuat, 1 - Math.exp(-delta / FACING_SMOOTH_TAU));
    group.quaternion.copy(facingQuatRef.current);
  });

  // ContactBlob lives inside this group (not as a scene-level sibling) specifically
  // so it inherits the group's dynamic position/scale from the block above - a
  // shadow that stayed fixed in world space while the character shrank and moved
  // toward the horizon would visibly detach from the character's feet.
  return (
    <group ref={groupRef}>
      <ContactBlob />
    </group>
  );
}

const CAMERA_PRESETS: Record<string, { position: [number, number, number]; target: [number, number, number] }> = {
  front: { position: [0, 1.6, 5.6], target: [0, 0.8, 0] },
  threeQuarter: { position: [3.6, 1.8, 4.2], target: [0, 0.9, 0] },
  side: { position: [5.4, 1.6, 0], target: [0, 0.9, 0] },
  back: { position: [0, 1.6, -5.6], target: [0, 0.8, 0] },
  top: { position: [0.01, 6, 0.01], target: [0, 0.5, 0] },
  closeUp: { position: [0, 1.5, 1.8], target: [0, 1.4, 0] },
};

/** Applies a requested camera preset (see CameraControls.tsx) directly to the
 *  live camera + OrbitControls target, then clears the request. Lives inside
 *  the Canvas since it needs the real camera/controls instances, not just
 *  the store values a sibling UI panel can see. */
function CameraPresetHandler({ controlsRef }: { controlsRef: RefObject<OrbitControlsImpl | null> }) {
  const camera = useThree((s) => s.camera);
  const cameraPresetRequest = useAppStore((s) => s.cameraPresetRequest);
  const clearCameraPresetRequest = useAppStore((s) => s.clearCameraPresetRequest);

  useEffect(() => {
    if (!cameraPresetRequest) return;
    const preset = CAMERA_PRESETS[cameraPresetRequest];
    if (preset) {
      camera.position.set(...preset.position);
      controlsRef.current?.target.set(...preset.target);
      controlsRef.current?.update();
    }
    clearCameraPresetRequest();
  }, [cameraPresetRequest, camera, controlsRef, clearCameraPresetRequest]);

  return null;
}

export function Viewport() {
  const readyVersion = useAppStore((s) => s.readyVersion);
  const stage = useAppStore((s) => s.stage);
  const backgroundUrl = useAppStore((s) => s.backgroundUrl);
  const keyLightIntensity = useAppStore((s) => s.keyLightIntensity);
  const ambientIntensity = useAppStore((s) => s.ambientIntensity);
  const orbitControlsRef = useRef<OrbitControlsImpl | null>(null);

  return (
    <div className="viewport">
      {/* Pulled back from the original [0, 1.3, 3.2]/target-y-1 framing, which
          cropped off the character's feet (and with them, the ground/shadow/
          background context) by default - full body only came into view if
          the user manually zoomed out. */}
      <Canvas shadows camera={{ position: [0, 1.6, 5.6], fov: 40 }} gl={{ preserveDrawingBuffer: true }}>
        <CanvasRegistrar />
        <CameraPresetHandler controlsRef={orbitControlsRef} />
        <CameraFollow controlsRef={orbitControlsRef} />
        <color attach="background" args={['#14171c']} />
        <ambientLight intensity={ambientIntensity} />
        <directionalLight position={[3, 5, 2]} intensity={keyLightIntensity} castShadow />
        <directionalLight position={[-3, 2, -2]} intensity={0.5} />
        <hemisphereLight args={['#8fa8c9', '#1a1c20', 0.6]} />
        <Ground />
        {backgroundUrl ? (
          <Suspense fallback={null}>
            <Backdrop key={backgroundUrl} url={backgroundUrl} />
          </Suspense>
        ) : (
          <Grid infiniteGrid fadeDistance={20} cellColor="#2a2f3a" sectionColor="#3a4150" position={[0, 0, 0]} />
        )}
        {stage === 'ready' && readyVersion > 0 && (
          <>
            <CharacterMesh key={readyVersion} />
            <GamepadJointControl />
            <WorldMovementController />
          </>
        )}
        <OrbitControls ref={orbitControlsRef} target={[0, 0.8, 0]} enableDamping dampingFactor={0.1} minDistance={1} maxDistance={10} />
      </Canvas>
    </div>
  );
}
