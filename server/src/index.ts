import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { directScene } from './anthropicClient.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY) });
});

const DirectSceneRequestSchema = z.object({
  instruction: z.string().min(1).max(2000),
  bones: z.array(z.object({ name: z.string(), jointType: z.string() })).max(500),
});

app.post('/api/direct-scene', async (req, res) => {
  const parsed = DirectSceneRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: `Invalid request: ${parsed.error.message}` });
    return;
  }
  try {
    const timeline = await directScene(parsed.data.instruction, parsed.data.bones);
    res.json({ timeline });
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(statusCode).json({ error: message });
  }
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`character-animator server listening on http://localhost:${port}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY is not set — the scene director endpoint will return an error until it is.');
  }
});
