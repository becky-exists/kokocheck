// Contract-only example. Use this with generated test media, never as a real editor.
// Real adapters must apply editorial instructions to source, render an MP4, and report each result.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const job = JSON.parse(input);
const { stat } = await import('node:fs/promises');
if (!(await stat(job.inputVideoPath)).isFile()) throw new Error('Missing downloaded input video.');
const exampleVideo = process.env.KOKOCHECK_EXAMPLE_VIDEO || process.env.FR_EXAMPLE_VIDEO; // the old name still works
if (!exampleVideo) throw new Error('Set KOKOCHECK_EXAMPLE_VIDEO to an absolute test revision MP4 path.');
process.stdout.write(JSON.stringify({
  videoPath: exampleVideo,
  summary: '接続テスト用の修正版（編集品質の検証ではありません）',
  changes: job.request.comments.map(c => ({
    commentId: c.id, summary: '接続テストで版の受け渡しを確認', outcome: 'addressed',
    before: { start: c.start, end: c.end ?? c.start },
    after: { start: c.start, end: c.end ?? c.start },
  })),
}));
