import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageRoot } from '../server/package-root.js';

test('packageRoot points at the same folder from scripts/ and from the compiled build/scripts/', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'kokocheck-root-')));
  await writeFile(join(root, 'package.json'), '{}');
  await mkdir(join(root, 'scripts'), { recursive: true });
  await mkdir(join(root, 'build', 'scripts'), { recursive: true });
  assert.equal(packageRoot(pathToFileURL(join(root, 'scripts', 'setup-claude-channel.ts')).href), root);
  assert.equal(packageRoot(pathToFileURL(join(root, 'build', 'scripts', 'setup-claude-channel.js')).href), root);
});
