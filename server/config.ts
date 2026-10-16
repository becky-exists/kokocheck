import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { env } from './env.js';

export const root = process.cwd();
export const dataDir = resolve(env('DATA_DIR') || resolve(root, '.data'));
export const mediaDir = resolve(dataDir, 'media');
export const port = Number(process.env.PORT || 4391);
export const host = process.env.HOST || '127.0.0.1';
export const publicUrl = (env('PUBLIC_URL') || `http://localhost:${port}`).replace(/\/$/, '');
export const maxUpload = 512 * 1024 * 1024;
export const token = () => randomBytes(32).toString('hex');
export function loadAdminToken() {
  const fromEnv = env('ADMIN_TOKEN');
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error('KOKOCHECK_ADMIN_TOKEN (or FR_ADMIN_TOKEN) must be at least 32 characters.');
    return fromEnv;
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = resolve(dataDir, 'access.json');
  if (!existsSync(path)) writeFileSync(path, JSON.stringify({ adminToken: token() }), { mode: 0o600, flag: 'wx' });
  return (JSON.parse(readFileSync(path, 'utf8')) as { adminToken: string }).adminToken;
}
