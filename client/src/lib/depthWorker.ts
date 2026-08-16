/// <reference lib="webworker" />
import { pipeline, env, type DepthEstimationPipeline } from '@huggingface/transformers';

// Fetch model weights from the HF CDN at runtime; cache in the browser after first load.
env.allowLocalModels = false;

let depthPipelinePromise: Promise<DepthEstimationPipeline> | null = null;

function getPipeline() {
  if (!depthPipelinePromise) {
    depthPipelinePromise = pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      progress_callback: (p: any) => {
        self.postMessage({ type: 'progress', progress: p });
      },
    }) as Promise<DepthEstimationPipeline>;
  }
  return depthPipelinePromise;
}

export interface DepthRequest {
  type: 'estimate';
  imageDataUrl: string;
  outWidth: number;
  outHeight: number;
}

export interface DepthResponse {
  type: 'result';
  depth: Float32Array;
}

self.onmessage = async (e: MessageEvent<DepthRequest>) => {
  if (e.data.type !== 'estimate') return;
  try {
    const model = await getPipeline();
    const output = await model(e.data.imageDataUrl);
    // output.depth is a transformers.js RawImage-like tensor wrapper with .data, .width, .height
    const raw = output.depth as unknown as { data: Float32Array | Uint8ClampedArray; width: number; height: number };

    const resized = resampleToSize(raw.data, raw.width, raw.height, e.data.outWidth, e.data.outHeight);
    normalizeInPlace(resized);

    (self as unknown as Worker).postMessage({ type: 'result', depth: resized } satisfies DepthResponse, [resized.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

function resampleToSize(
  src: Float32Array | Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  const out = new Float32Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y / dstH) * srcH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x / dstW) * srcW));
      out[y * dstW + x] = src[sy * srcW + sx];
    }
  }
  return out;
}

function normalizeInPlace(depth: Float32Array) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of depth) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  for (let i = 0; i < depth.length; i++) {
    depth[i] = (depth[i] - min) / range;
  }
}
