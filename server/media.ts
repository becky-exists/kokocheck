import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pin, Version } from '../shared/types.js';
import { id, now } from './domain.js';
import { check, HttpError } from './store.js';

const exec = promisify(execFile);
// Both tools are told the container up front (the MP4/MOV demuxer is named `mov`) instead of guessing from file content.
export async function probe(path: string) {
  try {
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-show_format', '-show_streams', '-of', 'json', path], { timeout: 20_000, maxBuffer: 2_000_000 });
    const info = JSON.parse(stdout) as { format: { duration: string; format_name: string }; streams: { codec_type: string; codec_name: string; width: number; height: number; side_data_list?: { rotation?: number }[] }[] };
    const video = info.streams.find(s => s.codec_type === 'video');
    check(video && info.format.format_name.includes('mp4') && video.codec_name === 'h264', 400, 'video_format');
    const audio = info.streams.filter(s => s.codec_type === 'audio');
    check(audio.every(a => a.codec_name === 'aac' || a.codec_name === 'mp3'), 400, 'audio_format');
    const duration = Number(info.format.duration);
    check(Number.isFinite(duration) && duration > 0 && duration <= 7200, 400, 'video_duration');
    const rotation = video.side_data_list?.find(d => d.rotation !== undefined)?.rotation ?? 0;
    const rotated = Math.abs(rotation % 180) === 90;
    return { duration, width: rotated ? video.height : video.width, height: rotated ? video.width : video.height, hasAudio: audio.length > 0, size: (await stat(path)).size };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'video_unreadable');
  }
}
export async function snapshot(dir: string, file: string, time: number, pin: Pin | null = null, name = `${id()}.jpg`) {
  const filters = ['scale=min(960\\,iw):-2'];
  if (pin) {
    // A two-tone crosshair is baked into the agent evidence, using image-relative coordinates.
    const x = pin.x.toFixed(6), y = pin.y.toFixed(6);
    filters.push(`drawbox=x=iw*${x}-12:y=ih*${y}-3:w=24:h=6:color=white:t=fill`, `drawbox=x=iw*${x}-3:y=ih*${y}-12:w=6:h=24:color=white:t=fill`, `drawbox=x=iw*${x}-10:y=ih*${y}-1:w=20:h=2:color=0x2563eb:t=fill`, `drawbox=x=iw*${x}-1:y=ih*${y}-10:w=2:h=20:color=0x2563eb:t=fill`);
  }
  try {
    await exec('ffmpeg', ['-v', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-ss', String(time), '-i', join(dir, file), '-frames:v', '1', '-vf', filters.join(','), '-q:v', '3', '-y', join(dir, name)], { timeout: 30_000, maxBuffer: 500_000 });
    check((await stat(join(dir, name))).size > 0, 400, 'snapshot_empty');
    return name;
  } catch (e) {
    await unlink(join(dir, name)).catch(() => {});
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'snapshot_failed');
  }
}
export async function importVideo(temp: string, dir: string): Promise<Version> {
  const info = await probe(temp);
  const file = `${id()}.mp4`;
  await rename(temp, join(dir, file));
  try {
    const poster = await snapshot(dir, file, Math.min(0.5, info.duration / 2));
    return { ...info, id: id(), number: 1, file, poster, createdAt: now(), summary: '最初の版', requestId: null, changes: [] };
  } catch (e) { await unlink(join(dir, file)).catch(() => {}); throw e; }
}
export async function discardVersion(dir: string, version: Version | undefined) {
  if (version) await Promise.all([version.file, version.poster].map(file => unlink(join(dir, file)).catch(() => {})));
}
