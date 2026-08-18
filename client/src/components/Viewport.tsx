import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useAppStore } from '../store';
import { sceneRuntime } from '../lib/sceneRuntime';

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
  const planeZ = -6;
  const perspective = camera as THREE.PerspectiveCamera;

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const t = (planeZ - camera.position.z) / forward.z;
  const center = camera.position.clone().addScaledVector(forward, t);
  const distance = camera.position.distanceTo(center);

  const vFov = (perspective.fov * Math.PI) / 180;
  const frameHeight = 2 * Math.tan(vFov / 2) * distance;
  const frameWidth = frameHeight * (size.width / size.height);
  const frameAspect = frameWidth / frameHeight;

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

function CanvasRegistrar() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    sceneRuntime.canvas = gl.domElement;
    return () => {
      sceneRuntime.canvas = null;
    };
  }, [gl]);
  return null;
}

function CharacterMesh() {
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const group = groupRef.current;
    const obj = sceneRuntime.renderObject;
    if (!group || !obj) return;
    group.add(obj);
    return () => {
      group.remove(obj);
    };
  }, []);

  useFrame((_, delta) => {
    sceneRuntime.executor?.update(Math.min(delta, 0.05));
  });

  return <group ref={groupRef} position={[0, 1, 0]} />;
}

export function Viewport() {
  const readyVersion = useAppStore((s) => s.readyVersion);
  const stage = useAppStore((s) => s.stage);
  const backgroundUrl = useAppStore((s) => s.backgroundUrl);

  return (
    <div className="viewport">
      {/* Pulled back from the original [0, 1.3, 3.2]/target-y-1 framing, which
          cropped off the character's feet (and with them, the ground/shadow/
          background context) by default - full body only came into view if
          the user manually zoomed out. */}
      <Canvas shadows camera={{ position: [0, 1.6, 5.6], fov: 40 }} gl={{ preserveDrawingBuffer: true }}>
        <CanvasRegistrar />
        <color attach="background" args={['#14171c']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 5, 2]} intensity={1.6} castShadow />
        <directionalLight position={[-3, 2, -2]} intensity={0.5} />
        <hemisphereLight args={['#8fa8c9', '#1a1c20', 0.6]} />
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
            <ContactBlob />
          </>
        )}
        <OrbitControls target={[0, 0.8, 0]} enableDamping dampingFactor={0.1} minDistance={1} maxDistance={10} />
      </Canvas>
    </div>
  );
}
