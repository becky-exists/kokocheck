import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { mkdir, stat, lstat, writeFile } from 'node:fs/promises';
import { ReviewClient } from './client.js';
import { env as readEnv, withoutAdminToken } from './env.js';
import { changeSchema } from './domain.js';
import { sweepOld } from './housekeeping.js';
import type { Request, Version } from '../shared/types.js';

// Deliberately opt-in. This process never discovers or launches a coding agent on its own.
const args = process.argv.slice(2);
const agentIndex = args.indexOf('--agent');
const commandIndex = args.indexOf('--');
if (agentIndex < 0 || commandIndex < 0 || !args[commandIndex + 1] || !['codex','claude'].includes(args[agentIndex + 1])) {
  console.error('Usage: npm run runner -- --agent codex|claude [--once] [--approve] -- <trusted-adapter-executable> [args...]');
  process.exit(2);
}
// Only the part before `--` is ours: everything after belongs to the adapter.
const ownFlags = args.slice(0, commandIndex);
// --approve: show each claimed job on this terminal and wait for a yes before the adapter starts. Default stays automatic.
const approve = ownFlags.includes('--approve');
if (approve && !process.stdin.isTTY) { console.error('--approve needs an interactive terminal to ask on.'); process.exit(2); }
const agent = args[agentIndex + 1] as 'codex' | 'claude';
const once = ownFlags.includes('--once');
const command = args[commandIndex + 1];
const commandArgs = args.slice(commandIndex + 2);
const client = new ReviewClient();
const worker = `${agent}-${randomUUID().slice(0,8)}`;
const outputSchema = z.object({ videoPath: z.string().min(1), summary: z.string().min(1).max(2000), changes: z.array(changeSchema).min(1).max(100) }).strict();
type Job = { projectId: string; title: string; mode: string; sourceRef: string | null; request: Request; version: Version; reviewUrl: string; mediaBaseUrl: string };
// Job folders live outside the data directory (which holds the admin key and the database). Not a sandbox:
// the adapter runs as this OS user and can still read anything this user can.
const jobsRoot = readEnv('JOBS_DIR') ? resolve(readEnv('JOBS_DIR')!) : join(tmpdir(), `kokocheck-jobs-${process.getuid?.() ?? 'user'}`);
async function prepareJobsRoot() {
  await mkdir(jobsRoot, { recursive: true, mode: 0o700 });
  const info = await lstat(jobsRoot);
  if (!info.isDirectory() || (process.getuid && info.uid !== process.getuid()) || (info.mode & 0o077) !== 0) throw new Error('KOKOCHECK_JOBS_DIR must be a private directory owned by this user (mode 700, not a symlink).');
  sweepOld(jobsRoot, 7 * 86400_000);
}
await prepareJobsRoot();
// Comment text is untrusted: show it without terminal control characters.
const plain = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 300);
async function askApproval(job: Job) {
  const lines = job.request.comments.map(c => `  - ${c.start.toFixed(1)}s ${plain(c.text)}`);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`\nApprove this job?\n  review: ${plain(job.title)}\n  adapter: ${plain([command, ...commandArgs].join(' '))}\n${lines.join('\n')}\nRun the adapter? [y/N] `);
    return answer.trim().toLowerCase() === 'y';
  } finally { rl.close(); }
}
let stopping = false;
let activeChild: ReturnType<typeof spawn> | undefined;
function stopChild() {
  const child = activeChild;
  if (!child?.pid) return;
  const signal = (value: NodeJS.Signals) => { try { process.platform === 'win32' ? child.kill(value) : process.kill(-child.pid!, value); } catch { /* already exited */ } };
  signal('SIGTERM');
  const escalation = setTimeout(() => signal('SIGKILL'), 3000); escalation.unref();
  child.once('close', () => clearTimeout(escalation));
}
for (const sig of ['SIGINT','SIGTERM']) process.on(sig, () => { stopping = true; stopChild(); });
console.error(`Frame runner ready (${agent}). Only the explicitly configured adapter will execute.`);

async function runJob(job: Job) {
  const base = `/agent/projects/${job.projectId}/requests/${job.request.id}`;
  const leaseToken = job.request.leaseToken!;
  let leaseLost = false;
  let renewing = false;
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void client.post(`${base}/heartbeat`, { leaseToken }).catch(() => { leaseLost = true; stopChild(); }).finally(() => { renewing = false; });
  }, 30_000);
  try {
    const jobDir = resolve(jobsRoot, job.request.id, randomUUID());
    await mkdir(jobDir, { recursive: true, mode: 0o700 });
    const inputVideoPath = resolve(jobDir, 'input.mp4');
    await client.downloadVideo(job.projectId, job.version.file, inputVideoPath);
    const evidence = [];
    for (const comment of job.request.comments) {
      const path = resolve(jobDir, `${comment.id}.jpg`);
      await writeFile(path, Buffer.from(await client.evidence(job.projectId, comment.snapshot), 'base64'), { mode: 0o600 });
      evidence.push({ commentId: comment.id, path });
    }
    const { leaseToken: _lease, ...request } = job.request;
    // The adapter gets review content/evidence, never the admin credential or lease token.
    const payload = { protocolVersion: 1, projectId: job.projectId, title: job.title, mode: job.mode, sourceRef: job.sourceRef, version: job.version, request, evidence, inputVideoPath, outputDirectory: jobDir };
    if (leaseLost || stopping) throw new Error('Lease lost or runner stopped before adapter launch.');
    if (approve && !(await askApproval(job))) {
      await client.post(`${base}/fail`, { leaseToken, reason: '制作側で実行が承認されませんでした。' }).catch(() => {});
      console.error('Declined. Nothing was run.'); return;
    }
    if (leaseLost || stopping) throw new Error('Lease lost or runner stopped before adapter launch.');
    const stdout = await new Promise<string>((fulfill, reject) => {
      const env = withoutAdminToken();
      const child = spawn(command, commandArgs, { stdio: ['pipe','pipe','pipe'], env, shell: false, detached: process.platform !== 'win32' }); activeChild = child;
      let output = ''; let tooLarge = false;
      const timeout = setTimeout(() => { stopChild(); reject(new Error('Adapter exceeded the 30 minute limit.')); }, 30 * 60_000);
      child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 1_000_000) { tooLarge = true; stopChild(); } });
      // Adapter logs stay local. Do not echo arbitrary source content into review pages.
      child.stderr.on('data', () => {});
      child.on('error', e => { clearTimeout(timeout); reject(e); });
      child.on('close', code => { clearTimeout(timeout); activeChild = undefined; if (code === 0 && !tooLarge && !stopping) fulfill(output); else reject(new Error('Adapter did not produce a valid successful result.')); });
      child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(payload));
    });
    if (leaseLost || stopping) throw new Error('Lease lost or runner stopped.');
    const output = outputSchema.parse(JSON.parse(stdout));
    // Validate output file accessibility before uploading; project input is never executed as a command.
    if (!(await stat(resolve(output.videoPath))).isFile()) throw new Error('Output is not a file.');
    await client.upload(`/agent/projects/${job.projectId}/versions`, resolve(output.videoPath), { manifest: JSON.stringify({ requestId: job.request.id, leaseToken, baseVersionId: job.request.versionId, summary: output.summary, changes: output.changes }) });
    console.error('Revision registered. Waiting for reviewer confirmation.');
  } catch {
    if (!leaseLost) await client.post(`${base}/fail`, { leaseToken, reason: '制作側の処理が完了しませんでした。接続プログラム・生成元・出力形式を確認してから再受付してください。' }).catch(() => {});
    console.error('Revision stopped; no automatic edit retry.');
  } finally { clearInterval(timer); }
}
do {
  let found = false;
  try {
    let offset: number | null = 0;
    while (offset !== null && !found && !stopping) {
      const list: { requests: { projectId: string; requestId: string; status: string; target: string; delivery?: string }[]; nextOffset: number | null } = await client.request(`/agent/requests?offset=${offset}`);
      for (const item of list.requests) {
        if (item.delivery === 'chat' || item.status !== 'queued' || (item.target !== 'any' && item.target !== agent) || stopping) continue;
        let job: Job;
        try { job = await client.post(`/agent/projects/${item.projectId}/requests/${item.requestId}/claim`, { worker, agent }); }
        catch { continue; }
        found = true; await runJob(job); break;
      }
      offset = list.nextOffset;
    }
  } catch { console.error('Review server unavailable. No job was started.'); }
  if (once || stopping) break;
  await new Promise(r => setTimeout(r, 3000));
} while (!stopping);
