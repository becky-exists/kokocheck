<h1 align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/brand/kokocheck-lockup-dark.svg"/><img src="docs/brand/kokocheck-lockup-light.svg" alt="KokoCheck" width="360"/></picture></h1>

[English](README.md)

見て、伝えて、確かめる。動画の修正依頼を、ひとつのリンクで。

> 公開先: [github.com/becky-exists/kokocheck](https://github.com/becky-exists/kokocheck)（MIT License）

動画を登録 → 時刻・時間範囲・画面上のピンで指摘 → まとめて再調整依頼 → 修正版を比較 → レビュー担当がOK。

**v0.1 / local-first prototype**。ブラウザに動画編集機能はありません。生成元のコード・素材を持つ動画を主対象とし、MP4単体のレビューもできます。編集は制作側のCodex／Claude Codeまたは独自adapterが担当します。

## 起動

必要: Node.js 24.14以上、FFmpeg / ffprobe（PATH上）。デモと自動テストにはPython 3 + Pillowも必要です。

```sh
npm ci
npm run doctor
npm run dev
```

http://localhost:4391 を開き、MP4を取り込んでください。H.264映像、AAC/MP3音声または無音、最大512MB・2時間。ほかのコーデックは事前変換してください。

デモは別ターミナルで `npm run demo`。黒地にタイムコードと目盛りを描いた試験映像と音から動画を作り、修正前後・ピン・音量変更のサンプルを登録します。外部AI呼び出しはありません。

ビルドして起動:

```sh
npm run build
npm start
```

環境変数は`KOKOCHECK_*`です（`.env.example`参照）。旧名`FR_*`も読み、両方あれば新しい名前が優先です。MCPのサーバー名（`frame-review-channel` `frame-review-mcp-server`）と道具名（`frame_*`）は、すでにつないでいるCodex・Claude Codeの設定を壊さないため意図して変えていません。

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

## 制作側との接続

[接続手順](docs/INTEGRATION.md)にCodex/ClaudeのMCP設定とrunnerの起動例があります。通常起動ではAIを呼び出しません。

- MCP: 動画登録・依頼の取得と手放し・画像参照・元動画ダウンロード・修正版登録。
- Runner: 明示的に選んだadapterだけを実行。依頼を排他取得し、処理中にリースを更新。
- 同梱の`agent-adapter.mjs`: 固定した制作ディレクトリでCodex／Claude CLIを呼ぶ最小接続。**実AIでの編集品質・個別レンダラーとの接続は未検証**。既存の権限ポリシーで処理できない場合は停止します。
- `example-adapter.mjs`: 生成済み動画を返す接続テスト専用。実編集はしません。
- 元の制作チャットへの通知: Codexは `codex queue`、Claude CodeはChannelsで同じ会話へ知らせます。制作側の接続設定が必要です。通知するだけで動画修正は開始しません。[設定と制限](docs/CHAT_NOTIFICATIONS.ja.md)。

## 自分のサーバーで動かす

[セルフホスト手順](docs/SELF_HOST.ja.md)。Docker Compose構成を同梱しています。初期設定はこのマシンのlocalhostのみです。外部共有には到達可能なホストとHTTPSの設定が必要です。公開SaaSとしての運用機能は含みません。

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

## OSS配布

本アプリのコードはMIT。依存パッケージとFFmpegはそれぞれのライセンスに従います。FFmpegバイナリの再配布条件は使用するビルドに依存するため、配布時に確認してください。ブランド名は仮称です。

独立したフォルダとして配布できます。`npm run release:source`でソース配布用tar.gzとチェックサムを作成できます。lockfileと除外設定も同梱します。`.data/`、`.env`、実案件動画、資格情報を含めません。詳しくは[配布手順](docs/RELEASE.md)を参照してください。`package.json`は意図しないnpm公開を防ぐため`private: true`です。

開発への参加は[CONTRIBUTING.md](CONTRIBUTING.md) セキュリティ情報は[SECURITY.md](SECURITY.ja.md)を参照してください。

## 表示言語

初回はブラウザの言語に合わせます。画面のJP / ENで切り替えると、このブラウザに選択を保存します。日付は選択したロケールで表示し、タイトル・コメント・返信・テロップの入力文は翻訳しません。通知の言語は別設定です。[通知の言語](docs/CHAT_NOTIFICATIONS.ja.md#通知の言語)を参照してください。
