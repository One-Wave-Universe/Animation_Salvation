import Anthropic from '@anthropic-ai/sdk';
import { TIMELINE_JSON_SCHEMA, type SceneTimeline } from './timelineSchema.js';
import { SYSTEM_PROMPT, userPrompt, validateTimeline, missingKeyError, type BoneSummary } from './sceneDirectorShared.js';

export async function directSceneAnthropic(instruction: string, bones: BoneSummary[]): Promise<SceneTimeline> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw missingKeyError('ANTHROPIC_API_KEY');

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt(instruction, bones) }],
    tools: [
      {
        name: 'emit_timeline',
        description: 'Emit the staged scene as a validated action timeline.',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input_schema: TIMELINE_JSON_SCHEMA as any,
      },
    ],
    tool_choice: { type: 'tool', name: 'emit_timeline' },
  });

  const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
  if (!toolUse) {
    throw Object.assign(new Error('The scene director did not return a timeline.'), { statusCode: 502 });
  }

  return validateTimeline(toolUse.input);
}
