import { openAsBlob } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { basename } from 'node:path';
import { loadAdminToken, publicUrl } from './config.js';
import { env } from './env.js';
export class ReviewClient {
  constructor(public url = env('SERVER_URL') || publicUrl, private auth = loadAdminToken()) {}
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${this.auth}`);
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    const res = await fetch(`${this.url}/api${path}`, { ...options, headers, signal: options.signal || AbortSignal.timeout(options.body instanceof FormData ? 600_000 : 30_000) });
    const data = await res.json();
    if (!res.ok) throw new Error(`${res.status}: ${data.error || 'Request failed'}`);
    return data as T;
  }
  post<T>(path: string, body: unknown) { return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) }); }
  async upload<T>(path: string, file: string, fields: Record<string, string>) {
    const body = new FormData();
    for (const [key,value] of Object.entries(fields)) body.append(key, value);
    body.append('video', await openAsBlob(file, { type: 'video/mp4' }), basename(file));
    return this.request<T>(path, { method: 'POST', body });
  }
  async evidence(projectId: string, file: string) {
    const res = await fetch(`${this.url}/api/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(file)}`, { headers: { Authorization: `Bearer ${this.auth}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error('Evidence could not be retrieved. Check the project and snapshot filename.');
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/jpeg')) throw new Error('Only comment JPEG snapshots are accepted.');
    return Buffer.from(await res.arrayBuffer()).toString('base64');
  }
  async downloadVideo(projectId: string, file: string, destination: string) {
    const res = await fetch(`${this.url}/api/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(file)}`, { headers: { Authorization: `Bearer ${this.auth}` }, signal: AbortSignal.timeout(600_000) });
    if (!res.ok || !res.body || !res.headers.get('content-type')?.startsWith('video/mp4')) throw new Error('Input video could not be retrieved.');
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  }
}
