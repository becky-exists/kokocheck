# KokoCheck v0.1.0

[日本語は下](#日本語)

A self-hosted video review loop for people who have an AI make their videos. Pause on a frame, point at the spot, write one line. It reaches the Claude Code or Codex conversation that made the video. Ask it to fix, and the revised version comes back on the same link.

## What you can do

- Comment on a time, a range or a pin on a paused frame. A snapshot is attached automatically.
- Add direction examples (framing, motion, captions and more) to a comment; they describe intent and are not source assets.
- Request changes in one batch, then compare versions: before/after playback and changed-only playback.
- Review from a shared link alone. The reviewer does not need to be an engineer.
- Japanese and English screens (follows the browser, switchable).
- Notify the original Claude Code (Channels) or Codex (`codex queue`) conversation. Notifications only ask the receiver to read and report; they never start editing.
- Shared MCP tools, HTTP API and an opt-in runner for production-side automation.
- Docker Compose included: `docker compose up --build -d`, then open http://localhost:4391.

## Known limits

- v0.1 is a local-first prototype. The browser reviews; it does not edit video. Edits are done by your Codex, Claude Code or adapter.
- Actual AI editing quality and integration with individual renderers are unverified. The bundled `agent-adapter.mjs` is a minimal connection.
- Version comparison uses time mappings supplied by the producer; it is not an automatic pixel or semantic diff. Pins mark a paused frame and do not track objects.
- Anyone with a shared link can comment on that video. With an automatic runner, treat link recipients like someone with write access to the production project.
- Chat notifications need a server started from source; the Docker container has no access to your Codex CLI or Claude Code session. Delivery after the host app has exited, and Windows delivery, are unverified.
- Docker was verified on Linux arm64 only; amd64 is unverified.
- Uploads: H.264 with AAC/MP3 audio or no audio, up to 512 MB and 2 hours. Convert other codecs first.
- Not a public SaaS: sharing beyond localhost needs a reachable host and HTTPS you set up yourself.

## Requirements

- Docker with Compose, **or** Node.js 24.14+ and FFmpeg / ffprobe on PATH (the generated demo and media tests also need Python 3 and Pillow).
- Claude Code (interactive, with Channels) and/or the Codex CLI, only if you want chat notifications.

MIT License. Dependencies and FFmpeg keep their own licenses. See the README for setup.

---

## 日本語

AI に動画を作ってもらっている人のための、自分のサーバーで動くレビュー用の道具です。止めたコマに指を置いて一言書くと、その動画を作った Claude Code / Codex の会話に届きます。直してと頼めば、直した版が同じリンクに返ってきます。

### できること

- 時刻・時間範囲・停止フレーム上のピンで指摘。画像は自動で添付。
- 演出アシスト（構図・動き・テロップなど）の見本をコメントに添付。見本は意図を伝えるもので、素材ではありません。
- まとめて再調整を依頼し、版を比較（修正前後の再生、変更区間だけの連続再生）。
- 共有リンクだけでレビューできる。相手はエンジニアでなくていい。
- 日本語・英語の画面（ブラウザの言語に合わせ、切り替え可）。
- 元の Claude Code（Channels）/ Codex（`codex queue`）の会話に通知。通知は「読んで報告して」と頼むだけで、動画の修正は始めません。
- 共通の MCP、HTTP API、任意起動の runner。
- Docker Compose 同梱: `docker compose up --build -d` のあと http://localhost:4391 を開く。

### 既知の制限

- v0.1 は local-first の試作です。ブラウザはレビュー専用で、動画の編集はしません。編集はお使いの Codex / Claude Code / adapter が行います。
- 実際の AI での編集品質と、個別のレンダラーとの接続は未検証です。同梱の `agent-adapter.mjs` は最小の接続です。
- 版の比較は制作側が報告した時間対応を表示するもので、ピクセル差分や意味的な自動検出ではありません。ピンは停止フレーム上の位置で、物体を追跡しません。
- 共有リンクを持つ人はその動画にコメントできます。自動 runner を使う場合、リンクを渡す相手は制作フォルダへの書き込みを許す相手と同じ扱いにしてください。
- チャット通知はソースから起動したサーバーで使います。Docker のコンテナからはお使いの Codex CLI / Claude Code の会話に届きません。ホストのアプリ終了後の配信と Windows は未検証です。
- Docker は Linux arm64 のみ確認、amd64 は未確認です。
- 取り込めるのは H.264 映像、AAC/MP3 音声または無音、最大 512 MB・2 時間。ほかのコーデックは事前に変換してください。
- 公開 SaaS ではありません。localhost の外へ共有するには、到達できるホストと HTTPS を自分で用意します。

### 必要なもの

- Docker（Compose 付き）、**または** Node.js 24.14 以上と FFmpeg / ffprobe（デモと自動テストには Python 3 + Pillow も）。
- チャット通知を使う場合のみ: Claude Code（対話セッション・Channels）や Codex CLI。

MIT License。依存パッケージと FFmpeg はそれぞれのライセンスに従います。始め方は README を参照してください。
