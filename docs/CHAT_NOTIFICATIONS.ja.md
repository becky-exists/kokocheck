# 元の制作チャットへの通知

[English](CHAT_NOTIFICATIONS.md)

Codex CLI の `queue` で既存の会話に知らせます。別セッションの `exec` や有料APIを呼ぶ処理はありません。Codexが作業中なら次のターンで受け取ります。会話を開いているアプリ／CLIが動いていることが必要です。受付成功だけでは着信や修正開始を保証しません。

## Codexの設定

1. 同じユーザーでログイン済みの Codex CLI を用意します。`codex queue --help` で対応を確認します（公式のCodex CLIリファレンスの `queue` の項も参照）。
2. 制作チャットの会話IDと KokoCheck のプロジェクトIDを確認します。
3. データディレクトリに `notify-codex.json` を作成します。ファイルは制作側だけが編集できるようにします。`.data/` は配布対象外です。
4. 次の通知から反映されます。再起動は不要です。確認画面に「元のCodexチャットへ通知」が表示されます。

```json
{
  "version": 1,
  "executable": "/absolute/path/to/codex",
  "bindings": {
    "11111111-1111-4111-8111-111111111111": {
      "threadId": "22222222-2222-4222-8222-222222222222",
      "testOnly": true, "lang": "ja"
    }
  }
}
```

例のUUIDを実際のIDに置き換えます。`executable` は信頼するCodex実行ファイルの絶対パスです。npmラッパーを指定する場合はサービスのPATHでNodeを解決できる必要があります。Nodeに依存しないCodexのネイティブ実行ファイルも指定できます。設定は通知のたびに読み直すので レビューを1行足しても再起動は要りません。

初回は `testOnly: true` の隔離したレビューからテストしてください。着信確認が取れたら対象レビューを `false` にします。どちらの場合も現在の通知文は内容確認までを依頼し 動画修正の開始は求めません。元の会話側が KokoCheck の保存データまたは認証済みAPI/MCPを読める環境が必要です。通知にはプロジェクトID・依頼ID・トークンを含まないレビューURLだけを載せます。

## 保存と表示

- 依頼と指摘のスナップショットをSQLiteに保存してから1回だけ送信します。
- 依頼受付が進行中の連打は409で拒否します。HTTPの切断後も同じ指摘を重複送信しません。
- `queued` はCLIが受け付けた状態です。人やAIが読んだ意味ではありません。
- CLI起動不可は `failed` です。タイムアウト・不明な応答・送信途中のサーバー再起動は `uncertain` とし 自動では再送しません。
- 失敗しても依頼とコメントは残ります。制作側で保存済みの依頼IDを確認して対処します。受信済みか不明なまま `codex queue` を再実行すると重複するため注意してください。
- 通知した依頼は同梱の自動runnerが取得しません。元の会話で内容を確認した後に明示的に修正を進める場合は既存のMCP/APIで取得できます。
- 通知が `failed`（確実に未送信）のときは 確認画面から「もう一度知らせる」または「依頼を取り消す」を選べます。取り消すと依頼は記録として残り 指摘は下書きに戻ります。`uncertain`（届いたか不明）は重複を避けるため この操作を出しません。

通知の設定がないプロジェクトは従来のCodex／Claude向け依頼受付のままです。Claude Codeの設定は次節を参照してください。Docker内にはホストのCodex CLIと会話キューがないため この構成の通知はホストでKokoCheckを動かす場合を対象にしています。

設定を外すと次の通知から止まります。既にCodexが受け付けた通知を取り消す操作ではありません。Codexアプリ／CLIが終了している間の配信再開やWindows環境は未検証です。

参照: 公式のCodex CLIリファレンス（`queue` の項）


## Claude Codeの設定

公式のChannelsを使い 起動中のClaude Codeの会話へ通知します。APIキーは不要で claude.aiのPro／Max認証でも利用できます。AIが応答する分は契約の利用枠を使います。一般のClaude Webチャットへの送信機能ではありません。

1. `npm run build` を実行します。
2. 隔離したテストレビューを作り そのプロジェクトIDで設定を生成します。

```sh
npm run setup:claude -- --project REVIEW_UUID --data-dir .data --lang ja --port 4393
```

`.data/notify-claude.json` と `.data/claude-channel.mcp.json` が作られます。共有トークンはランダム生成しローカルファイルにだけ保存します。Claudeの全体設定は変更しません。初期設定は `testOnly: true` です。動画を編集せず着信確認だけを求めます。

設定は名前付きの「チャンネル」（ポートとトークン）と レビューごとの割り当てで持ちます。

```json
{
  "version": 1,
  "channels": { "review": { "port": 4393, "token": "64桁のランダムhex" } },
  "bindings": { "REVIEW_UUID": { "channel": "review", "testOnly": true, "lang": "ja" } }
}
```

3. 最初のチャンネルは設定を作ったあと KokoCheck の再起動なしで反映されます（通知のたびに読み直します）。
4. 制作していたプロジェクトのターミナルで スクリプトが表示した次の形式のコマンドを実行します。`--resume` で元の会話を選びます。同じ会話を別のプロセスで重ねて起動せず 一度終了してから再開してください。

```sh
claude --resume --mcp-config /absolute/path/to/.data/claude-channel.mcp.json --dangerously-load-development-channels server:frame-review-channel
```

Channelsは試験提供です。この独自接続には起動時の開発用Channels確認画面での承認が必要です。このフラグはチャンネルの許可リスト向けであり ツール実行の許可を省略するものではありません。`--dangerously-skip-permissions` は不要です。Team／Enterpriseでは管理者によるChannels有効化も必要です。`-p` での非対話実行では独自Channelsの開発フラグが無効になるため 対話セッションで接続してください。

5. テストレビューにコメントを入れ 「再調整を依頼」→「依頼を保存して知らせる」を押します。Claudeの会話で着信確認を見ます。
6. 実際のレビューをつなぐときは `--live` を付けます。`testOnly: false` は保存済みの指摘を読み内容を報告するモードです。どちらも動画編集の自動開始は求めません。

### レビューを増やす（会話のつなぎ直しなし）

1つのチャンネル（1つのポートと1つの会話）に複数のレビューを割り当てられます。同じチャンネル名で `setup:claude` を実行するだけで `bindings` に追加されます。

```sh
npm run setup:claude -- --project ANOTHER_REVIEW_UUID --data-dir .data --lang ja --channel review --live
```

- 既存の設定は書き換えません（古い形式の `bindings` に `port` と `token` を直接書いた設定もそのまま動きます）。
- 追加後は KokoCheck も チャンネルのプロセスも 次の通知から新しい設定を読みます。会話の再起動や再接続は要りません。
- 新しいチャンネル名（`--channel other --port 4394`）を作った場合だけ 別の会話の接続が必要です。MCPファイルは `claude-channel-other.mcp.json` に作られます。
- 通知文にはレビューのURL（`#key=` の鍵を含まない）を載せます。コメント本文や鍵は載せません。
- トークンを入れ替えるときは `notify-claude.json` を書き換えます。次の通知から新しいトークンが使われ 古いものは拒否されます。ポート番号を変える場合だけチャンネルの再起動が必要です。
- 同じレビューをCodexとClaudeの両方に設定すると 起動時は拒否し 起動後に設定した場合はそのレビューの依頼がエラーになります。チャネル用ポートをVPN・リバースプロキシ・インターネットに公開しないでください。

### 通知を受けた会話から修正まで進める（任意）

既定では 通知を受けた会話に依頼を取ったり修正版を上げる道具はありません（コメントを読んで報告するだけ）。続けて会話から修正を進めたい場合だけ `--with-agent-tools` を付けます。

```sh
npm run setup:claude -- --project REVIEW_UUID --data-dir .data --lang ja --with-agent-tools
```

既存の `frame-review-mcp-server`（依頼の取得・作業権の更新と手放し・動画の取得・修正版の登録）が同じMCP設定に加わります。**これは管理キーの権限をその会話に渡すことと同じです。** 道具はこのチャンネルのレビューに限らず そのデータディレクトリの全レビューを扱えます。自分の動画だけを置いたデータディレクトリで使うか 信頼する会話にだけ付けてください。`KOKOCHECK_MCP_ALLOWED_DIRS` で 動画を読み書きできるフォルダを絞れます（[INTEGRATION.md](INTEGRATION.ja.md)）。

### Claudeへの配送と読み取り

- KokoCheckが依頼を保存した後 localhostの専用受け口にプロジェクトID・依頼ID・KokoCheckのURLを送ります。
- 受け口は固定ポート／トークン／レビューIDを検証します。ブラウザーからの直接送信と任意の通知文は受け付けません。
- 通知文は保存済み依頼から生成します。ユーザーのコメントや鍵を通知文へ埋め込みません。URLはhttp(s)のオリジンと任意のパスだけを受け付け 認証情報・クエリ・フラグメントは拒否します。
- `frame_read_notified_request` はその接続で通知した依頼のコメント・時刻・ピン・演出指定だけを読みます。読んでも仕事の取得や動画変更は発生しません。
- このチャンネルは編集用の管理キーを持ちません。編集に進む場合はユーザーの指示と既存の制作環境が必要です（上の `--with-agent-tools` を使った場合を除く）。
- `queued` はMCP通信への書き込み完了です。Claudeは通知を受信したか自動応答しないため 画面には「着信はまだ未確認」と表示します。Channels未有効・組織設定で無効なら 通信成功でもClaudeが通知を破棄する場合があります。着信確認の返答で検証してください。
- Claude未起動・接続先ポート不在は `failed` です。タイムアウトや不明な結果は `uncertain` です。保存した依頼は残り 自動再送や別のAI起動はしません。`failed` は画面から もう一度知らせる／取り消すができます。`uncertain` は手動でも出しません。
- 同一プロセス内の同じ依頼IDは重複通知しません。チャンネル再起動をまたぐ再送の重複排除や既読確認は提供しません。失敗した依頼は制作側で保存データを確認します。
- 自動runnerは通知付き依頼をスキップします。

停止するにはClaudeをチャンネル指定なしで再開し `notify-claude.json` の対象bindingを外します（次の通知から反映されます）。進行中の依頼は残ります。設定ファイルは`.data`とともに非公開で保管してください。

現時点は同一マシン上のNode.js 24とClaude Code CLIを対象とします。Windows／Android端末の実機とDocker越しの接続は未検証です。閲覧するスマホにはこのチャンネル設定は不要です。

参照: [Claude Channels](https://code.claude.com/docs/en/channels) / [Channels reference](https://code.claude.com/docs/en/channels-reference)

## 通知の言語

各bindingの `lang` に `en` または `ja` を指定します。省略時は `en` です。既存環境で日本語を維持する場合は、更新前にbindingへ `"lang": "ja"` を追加してください。Claudeの名前付きchannelにも既定言語を指定でき、bindingの指定が優先されます。`setup:claude -- --lang ja` で日本語のbindingを作れます。UIのJP / EN切替とは独立し、コメント本文は翻訳しません。通知と演出指示の言語を変えても、テストは着信確認だけ、本番は内容を読んで報告するだけです。動画編集はユーザーの明示的な指示を待ちます。
