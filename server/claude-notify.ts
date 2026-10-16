import type { Locale } from '../shared/locale.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { RequestNotification } from '../shared/types.js';

const port = z.number().int().min(1024).max(65535);
const secret = z.string().regex(/^[a-f0-9]{64}$/);
const channelName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
const channelSchema = z.object({ port, token: secret, lang: z.enum(['en','ja']).default('en') }).strict();
// New form: the review points at a named channel. Old form: the review carries its own port and token.
const newBinding = z.object({ channel: channelName, lang: z.enum(['en','ja']).optional(), testOnly: z.boolean().default(true) }).strict();
const legacyBinding = z.object({ port, token: secret, lang: z.enum(['en','ja']).default('en'), testOnly: z.boolean().default(true) }).strict();
export const claudeConfigSchema = z.object({
  version: z.literal(1),
  channels: z.record(channelName, channelSchema).default({}),
  bindings: z.record(z.string().uuid(), z.union([newBinding, legacyBinding])),
}).strict();
export type ClaudeChannel = z.infer<typeof channelSchema>;
export type ClaudeBinding = { channel: string; port: number; token: string; lang: Locale; testOnly: boolean };
export type ClaudeConfig = { channels: Record<string, ClaudeChannel>; bindings: Record<string, ClaudeBinding> };

// Both forms are folded into one resolved shape. A legacy binding becomes a channel of its own.
export function resolveClaudeConfig(raw: unknown): ClaudeConfig {
  const parsed = claudeConfigSchema.parse(raw);
  const channels: Record<string, ClaudeChannel> = { ...parsed.channels };
  const bindings: Record<string, ClaudeBinding> = {};
  for (const [projectId, binding] of Object.entries(parsed.bindings)) {
    if ('channel' in binding) {
      const channel = channels[binding.channel];
      if (!channel) throw new Error(`Review ${projectId} points at an unknown channel.`);
      bindings[projectId] = { channel: binding.channel, ...channel, lang: binding.lang ?? channel.lang, testOnly: binding.testOnly };
    } else {
      const name = `project-${projectId.slice(0, 8)}`;
      channels[name] = { port: binding.port, token: binding.token, lang: binding.lang };
      bindings[projectId] = { channel: name, ...binding };
    }
  }
  if (new Set(Object.values(channels).map(c => c.port)).size !== Object.keys(channels).length) throw new Error('Each channel needs its own channel port');
  return { channels, bindings };
}

// Read on every use: adding a review to the file must not need a restart or a reconnected conversation.
export function loadClaudeConfig(dataDir: string): ClaudeConfig | null {
  let raw: string;
  try { raw = readFileSync(join(dataDir, 'notify-claude.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  return resolveClaudeConfig(JSON.parse(raw));
}

// The channel prints this URL in its notice. Origin and optional path only: no credentials, query or fragment.
export const publicUrlSchema = z.string().max(200).transform((value, ctx) => {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) throw new Error('unsupported');
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch { ctx.addIssue({ code: 'custom', message: 'Invalid public URL' }); return z.NEVER; }
});

// Only a fixed loopback address. The reviewer cannot provide a destination or prompt.
export async function notifyClaude(binding: Pick<ClaudeBinding, 'port' | 'token'>, projectId: string, requestId: string, publicUrl?: string): Promise<RequestNotification> {
  const result = (state: RequestNotification['state']): RequestNotification => ({ state, provider: 'claude', updatedAt: new Date().toISOString() });
  const send = (body: Record<string, string>) => fetch(`http://127.0.0.1:${binding.port}/notify`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${binding.token}` }, body: JSON.stringify(body),
  });
  try {
    let response = await send({ projectId, requestId, ...(publicUrl ? { publicUrl } : {}) });
    // A channel process started from an older build rejects the extra field with 400 (nothing was sent): ask again without the URL.
    if (response.status === 400 && publicUrl) response = await send({ projectId, requestId });
    if ([400, 401, 403, 404, 409, 413, 503].includes(response.status)) return result('failed');
    if (response.status !== 202) return result('uncertain');
    const receipt = z.object({ state: z.literal('queued'), requestId: z.literal(requestId) }).strict().safeParse(await response.json());
    return result(receipt.success ? 'queued' : 'uncertain');
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return result(cause?.code === 'ECONNREFUSED' ? 'failed' : 'uncertain');
  }
}
