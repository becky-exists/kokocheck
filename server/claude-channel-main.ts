import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createClaudeChannel } from './claude-channel.js';

const { values } = parseArgs({ options: { 'data-dir': { type: 'string' }, channel: { type: 'string' }, project: { type: 'string' } } });
if (!values['data-dir'] || !values.channel === !values.project) throw new Error('Required: --data-dir <absolute directory> and one of --channel <name> or --project <review UUID>');
const channel = createClaudeChannel(resolve(values['data-dir']), values.channel ? { channel: values.channel } : { project: values.project! });
await channel.server.connect(new StdioServerTransport());
const http = channel.app.listen(channel.port, '127.0.0.1');
http.on('listening', () => console.error(`KokoCheck channel listening on loopback port ${channel.port}. Enable the channel in Claude Code to receive events.`));
http.on('error', () => { console.error('Channel port unavailable. No existing service was stopped.'); process.exit(1); });
let closing = false;
async function close() {
  if (closing) return; closing = true;
  http.close(); http.closeAllConnections(); channel.close();
  await channel.server.close();
}
channel.server.server.onclose = () => { void close(); };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void close(); });
