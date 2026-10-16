import { realpathSync } from 'node:fs';
import { env as readEnv } from './env.js';
import { delimiter, dirname, basename, join, resolve, sep } from 'node:path';

// KOKOCHECK_MCP_ALLOWED_DIRS (formerly FR_MCP_ALLOWED_DIRS): absolute folders (separated like PATH) the MCP tools may read from or write to.
// Unset or empty means no restriction, as before.
function allowedRoots(env = readEnv('MCP_ALLOWED_DIRS')) {
  if (!env?.trim()) return null;
  return env.split(delimiter).filter(Boolean).map(dir => realpathSync(resolve(dir)));
}
const inside = (path: string, root: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

// For a file that must already exist (an upload source).
export function allowedExisting(path: string, env?: string) {
  const roots = allowedRoots(env);
  const real = realpathSync(path);
  if (roots && !roots.some(root => inside(real, root))) throw new Error('This path is outside KOKOCHECK_MCP_ALLOWED_DIRS.');
  return real;
}
// For a file that will be created: its folder must exist and be allowed. The file name is kept as given.
export function allowedNew(path: string, env?: string) {
  const roots = allowedRoots(env);
  const parent = realpathSync(dirname(path));
  if (roots && !roots.some(root => inside(parent, root))) throw new Error('This path is outside KOKOCHECK_MCP_ALLOWED_DIRS.');
  return join(parent, basename(path));
}
