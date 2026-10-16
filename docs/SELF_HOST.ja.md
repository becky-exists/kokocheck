# Self-host

[English](SELF_HOST.md)

## ネイティブ

Node.js 24.14以上、FFmpeg/ffprobeを用意して`npm ci && npm run doctor && npm run build && npm start`。作業ディレクトリはこのプロジェクトのルートです。デフォルトはlocalhost:4391。`PORT`を変える場合は`KOKOCHECK_PUBLIC_URL`も合わせます。

`KOKOCHECK_DATA_DIR`（既定`.data/`）を永続化。SQLiteは単一Nodeサーバー用で、複数インスタンスでの共有運用は対象外です。初回生成の管理キーは`access.json`内にあります。`KOKOCHECK_PUBLIC_URL`がlocalhostの間は このマシンのブラウザーで開くと管理画面へ自動ログインします。公開URLを設定した場合 この自動ログインは既定で閉じ 管理キーでログインします。リバースプロキシ経由やDockerでも同様です。同じマシンの全員を信頼してよい場合だけ `KOKOCHECK_ALLOW_LOCAL_SESSION=1` で再び許可できます。

## Docker Compose

```sh
docker compose up --build -d
```

ホストの127.0.0.1:4391にだけバインドし、名前付きvolumeに保存します。コンテナはnodeユーザーで動き、AI CLIや資格情報は入れません。制作runnerは別途ホスト側で動かします。

管理キーを取得する場合は自身のローカル端末で実行してください（秘密情報なので出力を共有しないこと）。

```sh
docker compose exec review node -e 'console.log(JSON.parse(require("fs").readFileSync("/data/access.json","utf8")).adminToken)'
```

2026-10-16にLinux arm64コンテナのビルド・起動・非root実行・自作MP4取り込み・ピン画像生成・再起動後のデータ保持を確認しました。amd64環境は未確認です。ネイティブNodeもソースアーカイブの新規展開先で導入・ビルド・起動を確認しています。

## 別の端末と共有する場合

- 到達可能なHTTPSのURLを`KOKOCHECK_PUBLIC_URL`に設定して再起動。
- 信頼したプロキシでTLSを終端。元の公開Host/Originを維持し、転送ヘッダーを適切に設定。localhostに書き換えて管理セッションを代理取得させないこと。
- 共有リンクはその動画へのレビュー権限そのものです。自動runnerを使う場合 リンクを渡す相手は 制作フォルダへの書き込みを許す相手と同じ扱いです（[SECURITY.md](../SECURITY.ja.md)）。動画配信のクエリにもトークンを使うので、アクセスログからクエリを除外してください。
- 512MB以上のリクエストをプロキシで拒否し、通信時間は大きな動画に合わせます。

初版は信頼した少人数のレビュー向けです。リンク失効・有効期限、個人別権限、ストレージ割当、公開インターネット向けrate limit、監査ログ、バックアップ自動化は未実装です。公開SaaS運用前に別途設計してください。

アップロード動画はFFmpegで読み取ります。FFmpegを更新し、OS/コンテナのCPU・メモリ制限とストレージ容量を設定してください。UIから任意URLを取得する機能はありません。

## 配布

アプリ本体のMITライセンスを含め、依存関係のライセンスを維持します。秘密のデータを含む`.data/`をソースアーカイブ・Docker contextへ含めません。`npm run release:source`でlockfile・除外設定付きのソースアーカイブと収録manifestを生成できます。DockerのFFmpegはディストリビューション提供のビルドで、再配布条件はその構成を確認してください。

既存環境で日本語通知を維持する場合は、更新前に通知設定の各bindingへ `"lang": "ja"` を追加してください。省略時は英語です。[通知設定](CHAT_NOTIFICATIONS.ja.md)を参照してください。
