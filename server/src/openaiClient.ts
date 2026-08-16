import OpenAI from 'openai';
import { TIMELINE_JSON_SCHEMA, type SceneTimeline } from './timelineSchema.js';
import { SYSTEM_PROMPT, userPrompt, validateTimeline, missingKeyError, type BoneSummary } from './sceneDirectorShared.js';

export async function directSceneOpenAI(instruction: string, bones: BoneSummary[]): Promise<SceneTimeline> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw missingKeyError('OPENAI_API_KEY');

  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt(instruction, bones) },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'emit_timeline',
          description: 'Emit the staged scene as a validated action timeline.',
          parameters: TIMELINE_JSON_SCHEMA as Record<string, unknown>,
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'emit_timeline' } },
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== 'function') {
    throw Object.assign(new Error('The scene director did not return a timeline.'), { statusCode: 502 });
  }

  let rawArgs: unknown;
  try {
    rawArgs = JSON.parse(toolCall.function.arguments);
  } catch {
    throw Object.assign(new Error('The scene director returned malformed JSON.'), { statusCode: 502 });
  }

  return validateTimeline(rawArgs);
}
