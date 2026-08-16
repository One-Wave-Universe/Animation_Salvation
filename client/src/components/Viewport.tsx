import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useAppStore } from '../store';
import { sceneRuntime } from '../lib/sceneRuntime';

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

  return (
    <div className="viewport">
      <Canvas shadows camera={{ position: [0, 1.3, 3.2], fov: 40 }} gl={{ preserveDrawingBuffer: true }}>
        <CanvasRegistrar />
        <color attach="background" args={['#14171c']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 5, 2]} intensity={1.6} castShadow />
        <directionalLight position={[-3, 2, -2]} intensity={0.5} />
        <hemisphereLight args={['#8fa8c9', '#1a1c20', 0.6]} />
        <Grid infiniteGrid fadeDistance={20} cellColor="#2a2f3a" sectionColor="#3a4150" position={[0, 0, 0]} />
        {stage === 'ready' && readyVersion > 0 && <CharacterMesh key={readyVersion} />}
        <OrbitControls target={[0, 1, 0]} enableDamping dampingFactor={0.1} minDistance={1} maxDistance={10} />
      </Canvas>
    </div>
  );
}
