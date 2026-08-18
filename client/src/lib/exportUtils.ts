import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { sceneRuntime } from './sceneRuntime';
import { useAppStore } from '../store';

export async function exportGLB(): Promise<void> {
  const obj = sceneRuntime.renderObject;
  if (!obj) throw new Error('No character to export yet.');

  const exporter = new GLTFExporter();
  const glb = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(obj, (result) => resolve(result as ArrayBuffer), reject, { binary: true });
  });

  downloadBlob(new Blob([glb], { type: 'model/gltf-binary' }), 'character.glb');
}

export function recordVideo(seconds: number, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const canvas = sceneRuntime.canvas;
    if (!canvas) {
      reject(new Error('Viewport is not ready yet.'));
      return;
    }

    // This captures actual canvas pixels, so anything visibly toggled on - the
    // skeleton/wireframe rig-debugging overlays - would otherwise end up baked into
    // the exported video. Force them off for the duration of the recording and
    // restore whatever the user had before once it's done, rather than requiring
    // them to remember to turn debug views off before hitting record.
    const { showSkeleton, showWireframe, setShowSkeleton, setShowWireframe } = useAppStore.getState();
    setShowSkeleton(false);
    setShowWireframe(false);
    const restoreOverlays = () => {
      setShowSkeleton(showSkeleton);
      setShowWireframe(showWireframe);
    };

    const stream = canvas.captureStream(30);
    // video/mp4 reports as MediaRecorder.isTypeSupported()===true in Chromium but
    // produces a genuinely corrupt file for a canvas-sourced stream (verified: valid
    // ftyp/moov header, but ffmpeg rejects it as "Invalid data" — a real browser bug,
    // not a codec-support gap). WebM is what actually works; don't "fix" this by
    // trusting the feature-detect over a real decode test again without re-verifying.
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      restoreOverlays();
      downloadBlob(new Blob(chunks, { type: mimeType }), 'scene.webm');
      resolve();
    };
    recorder.onerror = (e) => {
      restoreOverlays();
      reject(e);
    };

    const tick = (startedAt: number) => () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      onProgress?.(Math.min(1, elapsed / seconds));
      if (elapsed >= seconds) {
        recorder.stop();
      } else {
        requestAnimationFrame(tick(startedAt));
      }
    };
    // Toggling the overlays off above only queues a React state update; give it two
    // animation frames to actually commit and render before capture starts, so the
    // first recorded frame doesn't still show the old overlay state - and don't start
    // the elapsed-time clock until recording actually begins.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        recorder.start();
        requestAnimationFrame(tick(performance.now()));
      }),
    );
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
