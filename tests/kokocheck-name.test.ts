import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { env, withoutAdminToken } from '../server/env.js';
import { loadAdminToken } from '../server/config.js';
import { allowedExisting } from '../server/allowed-paths.js';
import { createApp } from '../server/app.js';
import { notificationMessage } from '../server/notify.js';
import { englishMessages } from '../shared/ui-messages.js';

const withEnv = async (vars: Record<string, string | undefined>, run: () => unknown) => {
  const before = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : process.env[k] = v;
  try { return await run(); } finally { for (const [k, v] of Object.entries(before)) v === undefined ? delete process.env[k] : process.env[k] = v; }
};

test('settings read KOKOCHECK_* first and the old FR_* names still work', async () => {
  assert.equal(env('DATA_DIR', { KOKOCHECK_DATA_DIR: '/new', FR_DATA_DIR: '/old' }), '/new', 'the new name wins');
  assert.equal(env('DATA_DIR', { FR_DATA_DIR: '/old' }), '/old', 'a launcher that still sets the old name keeps working');
  assert.equal(env('DATA_DIR', { KOKOCHECK_DATA_DIR: '', FR_DATA_DIR: '/old' }), '/old', 'an empty new value does not hide the old one');
  assert.equal(env('DATA_DIR', {}), undefined);
  const stripped = withoutAdminToken({ KOKOCHECK_ADMIN_TOKEN: 'a', FR_ADMIN_TOKEN: 'b', KEEP: 'c' });
  assert.deepEqual(stripped, { KEEP: 'c' }, 'the admin key never reaches an adapter under either name');
  await withEnv({ KOKOCHECK_ADMIN_TOKEN: undefined, FR_ADMIN_TOKEN: 'o'.repeat(40) }, () => assert.equal(loadAdminToken(), 'o'.repeat(40)));
  await withEnv({ KOKOCHECK_ADMIN_TOKEN: 'n'.repeat(40), FR_ADMIN_TOKEN: 'o'.repeat(40) }, () => assert.equal(loadAdminToken(), 'n'.repeat(40)));
  await withEnv({ KOKOCHECK_ADMIN_TOKEN: 'short', FR_ADMIN_TOKEN: undefined }, () => assert.throws(() => loadAdminToken(), /at least 32/));
  const inside = await mkdtemp(join(tmpdir(), 'kokocheck-allowed-')), outside = await mkdtemp(join(tmpdir(), 'kokocheck-outside-'));
  await writeFile(join(outside, 'a.mp4'), 'x'); await writeFile(join(inside, 'b.mp4'), 'x');
  for (const name of ['FR_MCP_ALLOWED_DIRS', 'KOKOCHECK_MCP_ALLOWED_DIRS']) await withEnv({ KOKOCHECK_MCP_ALLOWED_DIRS: undefined, FR_MCP_ALLOWED_DIRS: undefined, [name]: inside }, () => {
    assert.ok(allowedExisting(join(inside, 'b.mp4')));
    assert.throws(() => allowedExisting(join(outside, 'a.mp4')), /outside KOKOCHECK_MCP_ALLOWED_DIRS/);
  });
});

test('the session cookie is named for KokoCheck, and a cookie set under the old name is still accepted', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kokocheck-cookie-'));
  const { app, store } = createApp({ dataDir, publicUrl: 'http://localhost:4391', adminToken: 'test-key' });
  const http = app.listen(0, '127.0.0.1'); await once(http, 'listening');
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  try {
    const login = await fetch(`${url}/api/local-session`, { method: 'POST' });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    assert.match(cookie, /^kokocheck_session=[a-f0-9]{64}$/);
    const value = cookie.split('=')[1];
    for (const name of ['kokocheck_session', 'frame_session']) assert.equal((await fetch(`${url}/api/projects`, { headers: { Cookie: `${name}=${value}` } })).status, 200, name);
    assert.equal((await fetch(`${url}/api/projects`, { headers: { Cookie: `kokocheck_session=${'0'.repeat(64)}` } })).status, 401);
  } finally { await new Promise<void>(r => http.close(() => r())); store.close(); }
});

test('the product name people read is KokoCheck everywhere on screen and in the messages an agent receives', async () => {
  for (const lang of ['ja', 'en'] as const) for (const testOnly of [true, false]) assert.match(notificationMessage('p', 'r', { lang, testOnly }), /KokoCheck/);
  assert.equal(englishMessages['KokoCheck ホーム'], 'KokoCheck home');
  const files = ['index.html', 'package.json', ...['src', 'shared', 'server'].flatMap(d => [d])];
  const read = async (path: string): Promise<string> => (await readdir(path, { withFileTypes: true }).then(
    entries => Promise.all(entries.filter(e => /\.(tsx?|css|json)$/.test(e.name)).map(e => readFile(join(path, e.name), 'utf8'))).then(parts => parts.join('\n')), () => readFile(path, 'utf8')));
  const text = (await Promise.all(files.map(read))).join('\n');
  // 人が読む所に旧名は残さない。仕組みの名前（MCP のサーバー名 frame-review-*、道具名 frame_*）は互換のために残す。
  assert.doesNotMatch(text.replaceAll(/frame-review-(?:channel|mcp-server)/g, ''), /Frame Review|frame review|FRAME REVIEW/);
  assert.match(await readFile('index.html', 'utf8'), /<title>KokoCheck<\/title>/);
  assert.equal(JSON.parse(await readFile('package.json', 'utf8')).name, 'kokocheck');
  assert.match(await readFile('server/mcp.ts', 'utf8'), /name: 'frame-review-mcp-server'/, 'MCP names stay so that existing Codex and Claude Code setups keep working');
  assert.match(await readFile('server/claude-channel.ts', 'utf8'), /name: 'frame-review-channel'/);
});

test('the logo files are in place: favicon, touch icon, and the small lockups at the top left in light and dark', async () => {
  const html = await readFile('index.html', 'utf8');
  assert.match(html, /rel="icon" href="\/favicon\.svg"/); assert.match(html, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
  for (const file of ['favicon.svg', 'kokocheck-lockup-small-light.svg', 'kokocheck-lockup-small-dark.svg', 'kokocheck-mark-light.svg', 'kokocheck-mark-dark.svg']) assert.match(await readFile(`public/${file}`, 'utf8'), /^<svg /, file);
  const png = await readFile('public/apple-touch-icon.png');
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]); assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [180, 180]);
  const app = await readFile('src/App.tsx', 'utf8');
  assert.match(app, /prefers-color-scheme: dark\)" srcSet="\/kokocheck-lockup-small-dark\.svg"/);
  assert.match(app, /src="\/kokocheck-lockup-small-light\.svg" alt="KokoCheck" width="159" height="24"/, 'the small lockup is for 24px height');
  assert.match(await readFile('README.md', 'utf8'), /docs\/brand\/kokocheck-lockup-light\.svg/);
  for (const file of ['kokocheck-lockup-light.svg', 'kokocheck-lockup-dark.svg']) assert.match(await readFile(`docs/brand/${file}`, 'utf8'), /^<svg /);
});
