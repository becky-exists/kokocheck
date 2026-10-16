import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

let failures = 0;
function check(name, pass, hint) {
  console.log(`${pass ? 'OK' : 'MISSING'} ${name}${pass ? '' : ` — ${hint}`}`);
  if (!pass) failures++;
}
const [major, minor] = process.versions.node.split('.').map(Number);
check('Node.js 24.14+', major > 24 || (major === 24 && minor >= 14), 'Install Node.js 24.14 or later');
for (const binary of ['ffmpeg', 'ffprobe']) {
  const result = spawnSync(binary, ['-version'], { encoding: 'utf8' });
  check(binary, result.status === 0, 'Install FFmpeg and make both commands available on PATH');
}
check('npm dependencies', existsSync('node_modules/react/package.json') && existsSync('node_modules/express/package.json'), 'Run npm ci');
if (process.argv.includes('--demo')) {
  check('Python 3 + Pillow (demo/tests)', spawnSync('python3', ['-c', 'from PIL import Image'], { encoding: 'utf8' }).status === 0, 'Install Python 3 and Pillow in your Python environment');
}
console.log('Read-only check. No credentials were read and no AI runner was started.');
process.exitCode = failures ? 1 : 0;
