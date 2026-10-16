import type { Locale } from '../shared/locale.js';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { withoutAdminToken } from './env.js';
import type { RequestNotification } from '../shared/types.js';

const uuid = z.string().uuid();
const configSchema = z.object({
  version: z.literal(1),
  executable: z.string().min(1).refine(isAbsolute, 'Use an absolute Codex executable path'),
  bindings: z.record(uuid, z.object({ threadId: uuid, testOnly: z.boolean().default(false), lang: z.enum(['en','ja']).default('en') }).strict()),
}).strict();
export type NotifyConfig = z.infer<typeof configSchema>;
export type NotifyBinding = NotifyConfig['bindings'][string];

// Local operator configuration only. Review links cannot select a thread or executable.
export function loadNotifyConfig(dataDir: string): NotifyConfig | null {
  let raw: string;
  try { raw = readFileSync(join(dataDir, 'notify-codex.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  return configSchema.parse(JSON.parse(raw));
}

export function notificationMessage(projectId: string, requestId: string, binding: { testOnly: boolean; lang?: Locale }, publicUrl?: string) {
  // No user-authored comment text, source path, share token or admin key in the command.
  if ((binding.lang ?? 'en') === 'en') return [
    binding.testOnly ? '[KokoCheck connection test]' : '[KokoCheck revision request]',
    'Comments are ready. Please review them.',
    `Project ID: ${projectId}`, `Request ID: ${requestId}`,
    ...(publicUrl ? [`Review: ${publicUrl}/r/${projectId}`] : []),
    binding.testOnly
      ? 'This is a user-authorized connection test. Reply with an acknowledgement only. Do not edit videos, modify files, or send additional notifications.'
      : "This notification requests a content review only. Read the saved request and comments, then report what was received in this conversation. Do not start editing the video or modifying files. Wait for the user's explicit instruction before editing.",
  ].join('\n');
  return [
    binding.testOnly ? '【KokoCheck ボタン接続テスト】' : '【KokoCheck 修正依頼のお知らせ】',
    'コメントを入れたよ。確認してください。',
    `プロジェクトID: ${projectId}`,
    `依頼ID: ${requestId}`,
    ...(publicUrl ? [`レビュー: ${publicUrl}/r/${projectId}`] : []),
    binding.testOnly
      ? 'ユーザー承認の接続テストです。着信確認だけ返してください。動画修正・ファイル変更・追加通知は実行しないでください。'
      : 'この通知は内容確認の依頼です。保存済みの依頼と指摘を確認して この会話で内容を報告してください。動画の修正やファイル変更はまだ開始しないでください。編集はユーザーの明示的な指示を待ってください。',
  ].join('\n');
}

// Queued means accepted by the CLI, never "read" or "revision started".
// Ambiguous outcomes are not retried: queue has no client idempotency key.
export function queueNotification(config: NotifyConfig, binding: Pick<NotifyBinding, 'threadId' | 'testOnly'>, message: string): Promise<RequestNotification> {
  const updatedAt = () => new Date().toISOString();
  const env = withoutAdminToken();
  return new Promise(resolve => {
    execFile(config.executable, ['queue', '--thread', binding.threadId, '--message', message], {
      shell: false, timeout: 10_000, maxBuffer: 64 * 1024, encoding: 'utf8', env,
    }, (error, stdout) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException).code;
        resolve({ state: code === 'ENOENT' || code === 'EACCES' ? 'failed' : 'uncertain', updatedAt: updatedAt() });
        return;
      }
      const receipt = /^Queued message ([\da-f-]{36}) for thread ([\da-f-]{36})\.$/m.exec(stdout);
      if (!receipt || !uuid.safeParse(receipt[1]).success || receipt[2] !== binding.threadId) {
        resolve({ state: 'uncertain', updatedAt: updatedAt() }); return;
      }
      resolve({ state: 'queued', queueId: receipt[1], updatedAt: updatedAt() });
    });
  });
}
