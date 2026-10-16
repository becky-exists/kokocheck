import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const exec = promisify(execFile);
export async function createFixture(directory: string, revision = false, portrait = false) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${portrait ? 'portrait' : revision ? 'revision' : 'original'}.mp4`);
  if (existsSync(path) && (await stat(path)).size > 1000) return path;
  const frames = join(directory, `${portrait ? 'portrait' : revision ? 'revision' : 'original'}-frames`);
  const artScript = new URL('./fixture-art.py', import.meta.url).pathname;
  await exec('python3', [artScript, frames, String(revision), String(portrait)], { timeout: 20_000 });
  // 1 秒ごとの 12 コマ（黒地・大きなタイムコード・小さな目盛り）を 24fps に伸ばす
  await exec('ffmpeg', ['-v','error','-nostdin','-framerate','1','-i',join(frames,'f%02d.png'),'-f','lavfi','-i','sine=frequency=220:sample_rate=44100:duration=12','-af',`volume=${revision ? 0.02 : 0.04}`,'-r','24','-c:v','libx264','-preset','ultrafast','-crf','22','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','-t','12','-y',path], { timeout: 60_000, maxBuffer: 1_000_000 });
  return path;
}
