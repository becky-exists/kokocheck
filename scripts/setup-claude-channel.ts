import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { resolveClaudeConfig } from '../server/claude-notify.js';
import { loadNotifyConfig } from '../server/notify.js';
import { env } from '../server/env.js';

const { values } = parseArgs({ options: {
  lang: { type: 'string', default: 'en' }, project: { type: 'string' }, 'data-dir': { type: 'string' }, port: { type: 'string' }, channel: { type: 'string', default: 'review' },
  live: { type: 'boolean', default: false }, 'with-agent-tools': { type: 'boolean', default: false }, 'server-url': { type: 'string' },
} });
const lang = z.enum(['en','ja']).parse(values.lang);
const projectId = z.string().uuid().parse(values.project);
const channelName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Channel names use lowercase letters, digits and hyphens').parse(values.channel);
const dataDir = resolve(values['data-dir'] ?? '.data');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const main = resolve(root, 'build/server/claude-channel-main.js');
const mcpMain = resolve(root, 'build/server/mcp.js');
if (!existsSync(main) || (values['with-agent-tools'] && !existsSync(mcpMain))) throw new Error('Run npm run build first.');
const configPath = resolve(dataDir, 'notify-claude.json');
// The default channel keeps the original file name; another channel gets its own MCP file.
const mcpPath = resolve(dataDir, channelName === 'review' ? 'claude-channel.mcp.json' : `claude-channel-${channelName}.mcp.json`);
if (loadNotifyConfig(dataDir)?.bindings[projectId]) throw new Error('This review already targets Codex. Choose a separate test review.');
const db = new DatabaseSync(resolve(dataDir, 'reviews.sqlite'), { readOnly: true });
try {
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) throw new Error('Review not found in this data directory.');
} finally { db.close(); }

type RawConfig = { version: 1; channels?: Record<string, { port: number; token: string }>; bindings: Record<string, unknown> };
const existing = existsSync(configPath);
// Existing entries (including the older per-review form) are kept exactly as they are; only this review is added.
const config: RawConfig = existing ? JSON.parse(readFileSync(configPath, 'utf8')) : { version: 1, bindings: {} };
if (config.bindings[projectId] || resolveClaudeConfig(config).bindings[projectId]) throw new Error('This review is already bound to a channel. The existing config was not overwritten.');
config.channels ??= {};
const known = config.channels[channelName];
if (known && values.port && Number(values.port) !== known.port) throw new Error(`Channel "${channelName}" already uses port ${known.port}. Omit --port to reuse it.`);
config.channels[channelName] = known ?? { port: Number(values.port ?? 4393), token: randomBytes(32).toString('hex') };
config.bindings[projectId] = { channel: channelName, testOnly: !values.live, lang };
resolveClaudeConfig(config); // fails on a clashing port or a malformed entry before anything is written
// Separate opt-in config: never changes ~/.claude, global MCP settings or existing sessions.
const write = (path: string, body: unknown, create: boolean) => {
  const text = JSON.stringify(body, null, 2) + '\n';
  if (create) { writeFileSync(path, text, { flag: 'wx', mode: 0o600 }); return; }
  writeFileSync(`${path}.tmp`, text, { mode: 0o600 }); renameSync(`${path}.tmp`, path);
};
write(configPath, config, !existing);

type McpFile = { mcpServers: Record<string, unknown> };
const mcpExisting = existsSync(mcpPath);
const mcp: McpFile = mcpExisting ? JSON.parse(readFileSync(mcpPath, 'utf8')) : { mcpServers: {} };
mcp.mcpServers['frame-review-channel'] ??= { command: process.execPath, args: [main, '--data-dir', dataDir, '--channel', channelName] };
// Opt-in only: these tools claim, edit and publish with the operator key on any review in this data directory.
if (values['with-agent-tools']) mcp.mcpServers['frame-review-mcp-server'] ??= { command: process.execPath, args: [mcpMain],
  env: { KOKOCHECK_DATA_DIR: dataDir, KOKOCHECK_SERVER_URL: values['server-url'] ?? env('SERVER_URL') ?? env('PUBLIC_URL') ?? 'http://localhost:4391' } };
write(mcpPath, mcp, !mcpExisting);
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
console.log(`${existing ? 'Added this review to' : 'Created'} the local channel config (${values.live ? 'content review' : 'acknowledgement test'}), channel "${channelName}". KokoCheck reads it on the next event; no restart is needed for this review.${values['with-agent-tools'] ? '\nAgent tools were added to the MCP file: this conversation can claim, edit and publish revisions with the operator key. See docs/CHAT_NOTIFICATIONS.md.' : ''}\n\nIn the production project directory, resume the intended Claude Code conversation:\nclaude --resume --mcp-config ${quote(mcpPath)} --dangerously-load-development-channels server:frame-review-channel\n\nSelect the original conversation and accept the channel prompt. If this conversation is already connected to channel "${channelName}", nothing needs to be reconnected. No Claude session was started or modified.`);
