import { lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Removes direct children of `dir` not modified for `maxAgeMs`. Never follows symlinks, never touches `dir` itself.
export function sweepOld(dir: string, maxAgeMs: number, nowMs = Date.now()) {
  let removed = 0;
  let names: string[];
  try { names = readdirSync(dir); } catch { return removed; }
  for (const name of names) {
    try {
      const path = join(dir, name);
      if (nowMs - lstatSync(path).mtimeMs <= maxAgeMs) continue;
      rmSync(path, { recursive: true, force: true }); removed++;
    } catch { /* in use or already gone: leave it for the next start */ }
  }
  return removed;
}
