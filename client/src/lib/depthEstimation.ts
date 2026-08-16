let worker: Worker | null = null;
function getDepthWorker(): Worker {
  if (!worker) worker = new Worker(new URL('./depthWorker.ts', import.meta.url), { type: 'module' });
  return worker;
}

export function estimateDepth(
  imageDataUrl: string,
  outWidth: number,
  outHeight: number,
  onProgress: (label: string) => void,
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const w = getDepthWorker();
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'result') {
        w.removeEventListener('message', handler);
        resolve(e.data.depth as Float32Array);
      } else if (e.data?.type === 'error') {
        w.removeEventListener('message', handler);
        reject(new Error(e.data.message));
      } else if (e.data?.type === 'progress') {
        const p = e.data.progress;
        if (p?.status === 'progress' && p.file) onProgress(`Downloading depth model: ${p.file} (${Math.round(p.progress ?? 0)}%)`);
        else if (p?.status) onProgress(`Depth model: ${p.status}`);
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({ type: 'estimate', imageDataUrl, outWidth, outHeight });
  });
}

/**
 * DEV-only stand-in for the real depth model (window.__MOCK_DEPTH__), used so the
 * mesh/rig/skinning/animation pipeline can be exercised without a network call to
 * Hugging Face. Approximates depth via distance to the nearest silhouette edge
 * (thicker mid-limb/torso areas bulge more than thin edges).
 */
export function mockDepth(mask: Uint8Array, width: number, height: number): Float32Array {
  const depth = new Float32Array(width * height);
  const dist = new Float32Array(width * height).fill(Infinity);
  const queue: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const isEdge = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(([nx, ny]) => nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[ny * width + nx]);
      if (isEdge) {
        dist[i] = 0;
        queue.push(i);
      }
    }
  }
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const x = i % width;
    const y = Math.floor(i / width);
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (!mask[ni] || dist[ni] !== Infinity) continue;
      dist[ni] = dist[i] + 1;
      queue.push(ni);
    }
  }
  let max = 0;
  for (const d of dist) if (d !== Infinity && d > max) max = d;
  for (let i = 0; i < depth.length; i++) depth[i] = dist[i] === Infinity ? 0 : dist[i] / (max || 1);
  return depth;
}

export function shouldUseMockDepth(): boolean {
  return import.meta.env.DEV && Boolean((window as unknown as { __MOCK_DEPTH__?: boolean }).__MOCK_DEPTH__);
}
