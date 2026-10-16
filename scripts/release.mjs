import { existsSync, readdirSync, lstatSync, readFileSync, mkdirSync, mkdtempSync, copyFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

// Source distribution only. Never recursively copy the project root or data folders.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixed = ['package.json', 'package-lock.json', 'README.md', 'README.ja.md', 'SECURITY.ja.md', 'LICENSE', 'CONTRIBUTING.md', 'CONTRIBUTING.ja.md', 'SECURITY.md',
  '.gitignore', '.dockerignore', '.env.example', 'Dockerfile', 'compose.yaml', 'index.html',
  'tsconfig.json', 'tsconfig.server.json', 'vite.config.ts'];
const directories = { src: ['.ts', '.tsx', '.css'], server: ['.ts'], shared: ['.ts'],
  scripts: ['.mjs', '.ts', '.py'], tests: ['.ts', '.json'], docs: ['.md', '.svg', '.gif', '.png'], public: ['.svg', '.png'], '.github': ['.yml', '.md'] };
const files = [...fixed];
// Generic traces of a developer machine and credentials. Anything specific to the person releasing (their name, host,
// company, private tools) is not written into the repository: it comes from a local file (see docs/RELEASE.md).
const generic = [/\/Users\/[^/\s]+\//, /\/Volumes\//, /\.ts\.net/, /#key=[a-f0-9]{32,}/, /(?:sk-proj-|sk-ant-)[A-Za-z0-9_-]{20,}/];
// KOKOCHECK_RELEASE_DENYLIST (old name FR_RELEASE_DENYLIST). The default file is ~/.config/kokocheck/…, and the old ~/.config/frame-review/… is used if only that exists.
const oldDenylist = resolve(homedir(), '.config/frame-review/release-denylist.txt'), newDenylist = resolve(homedir(), '.config/kokocheck/release-denylist.txt');
const denylistPath = process.env.KOKOCHECK_RELEASE_DENYLIST || process.env.FR_RELEASE_DENYLIST || (!existsSync(newDenylist) && existsSync(oldDenylist) ? oldDenylist : newDenylist);
let personal = [];
try {
  // One case-insensitive regular expression per line. Blank lines and # comments are ignored.
  personal = readFileSync(denylistPath, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => new RegExp(l, 'i'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.error('Note: no personal denylist found, only generic patterns are checked. See docs/RELEASE.md.');
}
const patterns = [...generic, ...personal];
function collect(directory, extensions) {
  for (const name of readdirSync(resolve(root, directory)).sort()) {
    const path = join(directory, name);
    const stat = lstatSync(resolve(root, path));
    if (stat.isSymbolicLink()) throw new Error(`Symlink is not distributable: ${path}`);
    if (stat.isDirectory()) collect(path, extensions);
    else if (extensions.includes(extname(name))) files.push(path);
  }
}
for (const [directory, extensions] of Object.entries(directories)) collect(directory, extensions);
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid version');
const name = `kokocheck-${version}`;
const stage = mkdtempSync(join(tmpdir(), 'kokocheck-source-'));
const output = resolve(root, '.data', 'releases', new Date().toISOString().replace(/[:.]/g, '-'));
const manifest = [];
for (const path of files.sort()) {
  const source = resolve(root, path);
  if (!lstatSync(source).isFile()) throw new Error(`Not a regular file: ${path}`);
  const body = readFileSync(source);
  // Catch known local-only references and credentials without echoing their contents.
  const text = body.toString('utf8');
  // This script holds the generic patterns themselves, so only the personal ones apply to it.
  if ((path === 'scripts/release.mjs' ? personal : patterns).some(pattern => pattern.test(text))) {
    throw new Error(`Local information found: ${path}`);
  }
  const target = resolve(stage, name, path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  manifest.push({ path, sha256: createHash('sha256').update(body).digest('hex') });
}
mkdirSync(output, { recursive: true });
const archive = resolve(output, `${name}.tar.gz`);
const tar = spawnSync('tar', ['-czf', archive, '-C', stage, name], { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } });
if (tar.status !== 0) throw new Error('Archive creation failed');
const hash = createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(resolve(output, 'SHA256SUMS'), `${hash}  ${name}.tar.gz\n`);
writeFileSync(resolve(output, 'manifest.json'), JSON.stringify({ version, files: manifest }, null, 2) + '\n');
console.log(`Source archive: ${relative(root, archive)}\nFiles: ${manifest.length}\nSHA256: ${hash}\nNothing was published.`);
