import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { sceneRuntime } from './sceneRuntime';

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
      downloadBlob(new Blob(chunks, { type: mimeType }), 'scene.webm');
      resolve();
    };
    recorder.onerror = (e) => reject(e);

    recorder.start();
    const startedAt = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      onProgress?.(Math.min(1, elapsed / seconds));
      if (elapsed >= seconds) {
        recorder.stop();
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
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
