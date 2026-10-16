<h1 align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/brand/kokocheck-lockup-dark.svg"/><img src="docs/brand/kokocheck-lockup-light.svg" alt="KokoCheck" width="360"/></picture></h1>

[English](README.md)

**AI に動画を作ってもらってる人へ。** 「ここ、もうちょっとこう」を、もう言葉で説明しなくていい。止めたコマに指を置いて一言書くだけで、その動画を作った AI（Claude Code / Codex）に届く。直してと頼めば、直した版が同じリンクに返ってくる。

- 共有リンクだけでレビューできる。相手はエンジニアでなくていい。
- 版の比較（修正前と修正後）。
- 日本語・英語の画面。
- Claude Code と Codex の両方に通知。

<p align="center"><img src="docs/brand/demo.gif" alt="再生して、止めて、ここを指して、コメントして、再調整を依頼する" width="320"/></p>

## 最短の始め方（Docker）

Docker（Compose 付き）だけあれば動きます。

```sh
git clone https://github.com/becky-exists/kokocheck.git
cd kokocheck
docker compose up --build -d
```

http://localhost:4391 を開き、MP4を取り込んでください。H.264映像、AAC/MP3音声または無音、最大512MB・2時間。同じマシンのブラウザは自動でログインされます。止めるときは `docker compose down`（`-v` を付けると保存したレビューも消えます）。

ほかの端末から開くときは管理キーが要ります。自分の端末で表示し、他人に見せないでください。

```sh
docker compose exec review node -e 'console.log(JSON.parse(require("fs").readFileSync("/data/access.json","utf8")).adminToken)'
```

コンテナの中にはお使いのCodex CLIやClaude Codeの会話がないため、[チャット通知](docs/CHAT_NOTIFICATIONS.ja.md)は下のソースから動かす方法で使います。localhost の外へ共有するときは[セルフホスト手順](docs/SELF_HOST.ja.md)を参照してください。

## ソースから起動

必要: Node.js 24.14以上、FFmpeg / ffprobe（PATH上）。デモと自動テストにはPython 3 + Pillowも必要です。

```sh
npm ci
npm run doctor
npm run dev
```

http://localhost:4391 を開いてください。デモは別ターミナルで `npm run demo`。黒地にタイムコードと目盛りを描いた試験映像と音から動画を作り、修正前後・ピン・音量変更のサンプルを登録します。外部AI呼び出しはありません。

ビルドして起動:

```sh
npm run build
npm start
```

設定は`KOKOCHECK_*`環境変数です（`.env.example`参照）。旧名`FR_*`とMCPの道具名`frame_*`も引き続き使えます。詳しくは[旧名との互換](docs/INTEGRATION.ja.md#旧名との互換)。

`.data/`にSQLite、動画、スナップショット、管理キーが保存されます。サーバーを止めてもレビューは残ります。バックアップ時はサーバーとrunnerを停止して`.data/`全体を保存してください。

## できること

- 動画入りの共有URLを発行。URLを持つ人がその動画をレビュー。
- 時刻、時間範囲、停止フレームのピン、画像の自動添付。
- 演出アシスト：最初に見える6つ＋畳んだ26種（構図・動き・画面の組み方・テロップ・音・つなぎ・冒頭と締め）を組み合わせてコメントに添付。テロップの文言指定も可能。動画全体への指示は、コメントの時刻を「全体」に切り替えるだけ。見本だけでも依頼でき 時間・ピン・補足とともに制作側へ渡ります。
- コメント返信、依頼前の文面修正、まとめて再調整依頼。
- 版履歴、修正前後のA/B再生、聴く音声の切替、変更区間だけ連続再生。
- 未依頼 → 依頼済み → 確認待ち → OK。再指摘は元の履歴を残す。
- Codex／Claude Code共通のMCP、HTTP API、任意起動のrunner。

**共有リンクの扱い:** リンクを持つ人はその動画にコメントできます。自動runnerを使う場合 リンクを渡す相手は 制作フォルダへの書き込みを許す相手と同じ扱いにしてください（[SECURITY.md](SECURITY.ja.md)）。上限は 指摘が1レビューあたり500件 返信が1指摘あたり30件（1件1000文字まで）です。

差分は制作側が報告した時間対応を表示します。ピクセル差分や意味的な自動検出ではありません。対応が分からない区間を同じ時刻と決めつけません。ピンは停止フレーム上の位置で、物体を追跡しません。

## Claude Code / Codex につなぐ

Dockerではなく、ソースから起動したサーバーで使います。通知は「保存した依頼を読んで報告して」と頼むだけで、動画の修正は始めません。最初は他と分けた試験用レビューを `testOnly`（受け取りの確認だけ）で試してください。

**Claude Code**（Channels）:

```sh
npm run build
npm run setup:claude -- --project REVIEW_UUID --data-dir .data --lang ja
# 表示されたコマンドを、制作フォルダで実行:
claude --resume --mcp-config /absolute/path/to/.data/claude-channel.mcp.json --dangerously-load-development-channels server:frame-review-channel
```

**Codex**（`codex queue`）: `.data/notify-codex.json` を作ると、次の依頼からその会話へ届きます。

```json
{
  "version": 1,
  "executable": "/absolute/path/to/codex",
  "bindings": { "REVIEW_UUID": { "threadId": "CODEX_THREAD_UUID", "testOnly": true, "lang": "ja" } }
}
```

詳しい手順・制限・任意の編集ツールは[チャット通知](docs/CHAT_NOTIFICATIONS.ja.md)、MCPとrunnerは[接続手順](docs/INTEGRATION.ja.md)。

## 制作側との接続

[接続手順](docs/INTEGRATION.ja.md)にCodex/ClaudeのMCP設定とrunnerの起動例があります。通常起動ではAIを呼び出しません。

- MCP: 動画登録・依頼の取得と手放し・画像参照・元動画ダウンロード・修正版登録。
- Runner: 明示的に選んだadapterだけを実行。依頼を排他取得し、処理中にリースを更新。
- 同梱の`agent-adapter.mjs`: 固定した制作ディレクトリでCodex／Claude CLIを呼ぶ最小接続。**実AIでの編集品質・個別レンダラーとの接続は未検証**。既存の権限ポリシーで処理できない場合は停止します。
- `example-adapter.mjs`: 生成済み動画を返す接続テスト専用。実編集はしません。
- 元の制作チャットへの通知: Codexは `codex queue`、Claude CodeはChannelsで同じ会話へ知らせます。制作側の接続設定が必要です。通知するだけで動画修正は開始しません。[設定と制限](docs/CHAT_NOTIFICATIONS.ja.md)。

## 自分のサーバーで動かす

[セルフホスト手順](docs/SELF_HOST.ja.md)。Docker Compose構成を同梱しています。初期設定はこのマシンのlocalhostのみです。外部共有には到達可能なホストとHTTPSの設定が必要です。公開SaaSとしての運用機能は含みません。

## 状態

v0.1 / local-first prototype。公開先は [github.com/becky-exists/kokocheck](https://github.com/becky-exists/kokocheck)（MIT License）。ブラウザに動画編集機能はありません。生成元のコード・素材を持つ動画を主対象とし、MP4単体のレビューもできます。編集は制作側のCodex／Claude Codeまたは独自adapterが担当します。

## 構成

| ディレクトリ | 内容 |
|---|---|
| `src` | React UI |
| `server` | Express API、SQLite、FFmpeg、MCP、runner |
| `shared` | データ型・時間範囲処理 |
| `scripts` | デモとadapter |
| `tests` | 状態遷移・HTTP・実動画・MCP・runnerのテスト |

```sh
npm run build
npm test
npm run security-check
```

[計画](docs/PLAN.md) / [検証記録](docs/VERIFICATION.md)

## 関連するプロジェクト

- [Telestrator](https://github.com/itsloukman/telestrator)（MIT）は、書き出した MP4 のコマにメモを付け、メモとコマ画像を MCP でコーディングエージェントに渡します。`npx telestrator video.mp4` の1行で始められます。自分の書き出しを自分のパソコンで確かめる使い方に向いています。
- KokoCheck は共有リンクを中心にしています。開発者ではない人がスマホで開いてコマを指し、その依頼を、動画を作った会話へ返せます。直した版は同じリンクに積み重なり、修正前と修正後を見比べられます。

## 既知の制限

- **AIの編集品質は保証しません。** KokoCheckは依頼をお使いのCodex／Claude Codeへ届けます。編集するかどうか、どこまでできるかは制作側の環境次第です。同梱adapterは最小の接続で、実AIでの編集は未検証です。
- **公開SaaSではありません。** 自分のマシンやサーバーで動かす前提です。localhostの外へ共有するには、到達できるホストとHTTPSを自分で用意します。
- **共有リンク＝権限です。** リンクを持つ人はその動画にコメントできます。自動runnerと使う場合は、制作フォルダへの書き込みを許す相手と同じ扱いにしてください。
- **動作確認の範囲。** macOSとLinux（arm64コンテナ）、Node.js 24、Claude Code CLIで確認。Windows、amd64のDocker、実機のスマホ、ホストのアプリ終了後の通知配信は未確認です。
- 版の比較は制作側が報告した時間対応を表示するもので、ピクセル差分や意味的な自動検出ではありません。

## OSS配布

本アプリのコードはMIT。依存パッケージとFFmpegはそれぞれのライセンスに従います。FFmpegバイナリの再配布条件は使用するビルドに依存するため、配布時に確認してください。ブランド名は仮称です。

独立したフォルダとして配布できます。`npm run release:source`でソース配布用tar.gzとチェックサムを作成できます。lockfileと除外設定も同梱します。`.data/`、`.env`、実案件動画、資格情報を含めません。詳しくは[配布手順](docs/RELEASE.md)を参照してください。`package.json`は意図しないnpm公開を防ぐため`private: true`です。

開発への参加は[CONTRIBUTING.ja.md](CONTRIBUTING.ja.md) セキュリティ情報は[SECURITY.md](SECURITY.ja.md)を参照してください。

## 表示言語

初回はブラウザの言語に合わせます。画面のJP / ENで切り替えると、このブラウザに選択を保存します。日付は選択したロケールで表示し、タイトル・コメント・返信・テロップの入力文は翻訳しません。通知の言語は別設定です。[通知の言語](docs/CHAT_NOTIFICATIONS.ja.md#通知の言語)を参照してください。
