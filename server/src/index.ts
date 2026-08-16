import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { directSceneAnthropic } from './anthropicClient.js';
import { directSceneOpenAI } from './openaiClient.js';
import { inpaintLayer } from './inpaintClient.js';

const app = express();
app.use(cors());
// Generous limit: base64-encoded layer-texture crops sent to /api/inpaint-layer can
// run several MB. A second express.json() with a bigger per-route limit would not
// help here — the global middleware already reads (and would reject) the stream
// first — so this single global limit has to cover every route.
app.use(express.json({ limit: '15mb' }));

const PROVIDERS = ['anthropic', 'openai'] as const;
type Provider = (typeof PROVIDERS)[number];

function availableProviders(): Record<Provider, boolean> {
  return {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
  };
}

function defaultProvider(): Provider {
  const available = availableProviders();
  if (available.anthropic) return 'anthropic';
  if (available.openai) return 'openai';
  return 'anthropic'; // neither configured; error message will name the right env var
}

app.get('/api/health', (_req, res) => {
  const providers = availableProviders();
  res.json({ ok: true, providers, defaultProvider: defaultProvider() });
});

const DirectSceneRequestSchema = z.object({
  instruction: z.string().min(1).max(2000),
  bones: z.array(z.object({ name: z.string(), jointType: z.string() })).max(500),
  provider: z.enum(PROVIDERS).optional(),
});

app.post('/api/direct-scene', async (req, res) => {
  const parsed = DirectSceneRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: `Invalid request: ${parsed.error.message}` });
    return;
  }
  const provider = parsed.data.provider ?? defaultProvider();
  try {
    const timeline =
      provider === 'openai'
        ? await directSceneOpenAI(parsed.data.instruction, parsed.data.bones)
        : await directSceneAnthropic(parsed.data.instruction, parsed.data.bones);
    res.json({ timeline, provider });
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(statusCode).json({ error: message });
  }
});

const InpaintRequestSchema = z.object({
  imageBase64: z.string().min(1),
  maskBase64: z.string().min(1),
  prompt: z.string().max(2000).optional(),
});

app.post('/api/inpaint-layer', async (req, res) => {
  const parsed = InpaintRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: `Invalid request: ${parsed.error.message}` });
    return;
  }
  try {
    const imageBase64 = await inpaintLayer(parsed.data.imageBase64, parsed.data.maskBase64, parsed.data.prompt);
    res.json({ imageBase64 });
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(statusCode).json({ error: message });
  }
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`character-animator server listening on http://localhost:${port}`);
  const available = availableProviders();
  if (!available.anthropic && !available.openai) {
    console.warn('Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set — the scene director endpoint will return an error until one is.');
  } else {
    console.log(`Scene director providers available: ${PROVIDERS.filter((p) => available[p]).join(', ')}`);
  }
});
