# Codex / Claude Code 接続

[English](INTEGRATION.md)

環境変数は `KOKOCHECK_*` です。旧名との互換は[末尾](#旧名との互換)を参照してください。

サーバーを起動し、`npm run build`を済ませてから設定します。以下の`/absolute/kokocheck`は実際のインストール先に置き換えてください。設定例の提供のみで、既存のユーザー設定は変更していません。

## 共通MCP

CodexのMCP設定例:

```toml
[mcp_servers.kokocheck]
command = "node"
args = ["/absolute/kokocheck/build/server/mcp.js"]

[mcp_servers.kokocheck.env]
KOKOCHECK_DATA_DIR = "/absolute/kokocheck/.data"
KOKOCHECK_SERVER_URL = "http://localhost:4391"
```

Claude CodeのMCP設定例:

```json
{
  "mcpServers": {
    "kokocheck": {
      "command": "node",
      "args": ["/absolute/kokocheck/build/server/mcp.js"],
      "env": {
        "KOKOCHECK_DATA_DIR": "/absolute/kokocheck/.data",
        "KOKOCHECK_SERVER_URL": "http://localhost:4391"
      }
    }
  }
}
```

同一マシンではMCPがサーバーと同じ`.data/access.json`を読みます。別マシンのMCPでは`KOKOCHECK_ADMIN_TOKEN`を安全な環境変数経由で渡します。実キーをリポジトリに保存しないでください。stdio MCPなので、レビュー閲覧者にMCPポートを公開する必要はありません。

| ツール | 用途 |
|---|---|
| `frame_register_video` | MP4を送ってレビューURLを得る。生成元がある場合mode=source、sourceRefを付ける |
| `frame_list_requests` | 未処理依頼をページ単位で取得 |
| `frame_claim_request` | 依頼を排他取得。コメントと版情報・leaseTokenを受け取る |
| `frame_renew_lease` | 処理中に30秒ごとに更新（有効期間120秒） |
| `frame_get_evidence` | ピン付きの停止フレーム画像を見る |
| `frame_download_video` | 元MP4を指定したローカルパスに取得（既存ファイル上書き不可） |
| `frame_publish_revision` | 新MP4と各指摘の対応結果を登録 |
| `frame_report_failure` | 処理できなかった理由を返す |
| `frame_release_request` | 取得した依頼を自分で手放し 待たずに取得し直せる状態へ戻す（leaseToken必須） |

MCPが読み書きする動画のフォルダは `KOKOCHECK_MCP_ALLOWED_DIRS`（PATHと同じ区切りの絶対パス）で絞れます。未設定なら制限しません。設定すると `frame_register_video` と `frame_publish_revision` の元ファイルは許可フォルダ内の実ファイル 保存先（`frame_download_video`）は許可フォルダ内の既存フォルダに限ります。シンボリックリンクは実体のパスで判定します。

登録時の報告は 範囲が動画の長さを少し超えても受け付けます（修正前・修正後とも終わりを動画の長さに丸めます）。開始が動画の長さを超える場合は拒否します。

制作エージェントへの指示例:

> 出力MP4をKokoCheckへ登録してレビューURLを返して。modeはsource、sourceRefはこの制作プロジェクトの絶対パス。修正依頼が来たらclaimし、30秒ごとにリースを更新して画像を確認。既存の制作手順で修正・レンダリング・目視確認を行い、新しいMP4と対応結果をpublishして。元動画は残し、OK判定はレビュー担当に任せる。

長時間のレンダリング中にもリースを更新できるrunnerを推奨します。失効・通信不明時に編集を自動再実行しません。元の処理が停止したことを制作側が確かめてから、レビュー画面で明示的に再受付します（再受付は管理キーまたは管理端末のセッションを持つ人だけができます。共有リンクだけでは押せません）。作業を続けられなくなった担当は `frame_release_request` で自分から手放せるので リース切れの120秒を待つ必要はありません。

## Runnerと同梱CLI adapter

**以下の起動は実際のAI利用枠・料金を消費する可能性があります。** 本実装のテストでは起動していません。

生成元のプロジェクトにレンダリング手順、素材、必要な依存があることを確かめてから、制作専用ディレクトリを指定します。sourceRefも同じ絶対パスで登録してください。レビュー内の文字列から実行ディレクトリを決めることはありません。

```sh
KOKOCHECK_WORKSPACE=/absolute/render-project npm run runner -- --agent codex --once -- node scripts/agent-adapter.mjs codex
```

```sh
KOKOCHECK_WORKSPACE=/absolute/render-project npm run runner -- --agent claude --once -- node scripts/agent-adapter.mjs claude
```

`--approve`を付けると 取得した依頼のレビュー名・コメントとadapterのコマンドをターミナルに表示し `y`と答えたときだけadapterを起動します。それ以外は依頼を失敗として返し 何も実行しません。端末のない環境では使えません。既定は今までどおり自動で起動します。

`--once`は最大1件だけ。省略すると待機を続けます。対象をanyにした依頼は最初に取得したrunnerだけが担当します。sourceRefが固定workspaceと異なる場合はadapterが停止するため、初版は同時に1つの制作プロジェクトで試してください。

Codexはworkspace-write、Claudeはdefault permission modeを使います。バイパス・自動承認オプションは付けません。許可が必要な処理は停止し得るため、そのプロジェクトの通常の権限設定で許可された作業だけを行わせます。adapterは信頼するローカルプログラムとして実行され、OSレベルの隔離を提供しません。実機のCLIログイン・描画環境・AI編集品質は別途検証が必要です。

## 独自adapterの契約

```sh
npm run runner -- --agent codex --once -- /absolute/your-adapter
```

stdinにJSONを渡します。

- `protocolVersion: 1`
- `projectId`, `title`, `mode`, `sourceRef`
- `version`: ベース版の情報
- `request.comments`: 依頼確定時に固定した指摘
- `evidence`: `{ commentId, path }[]` — ピン付きJPEGのローカルパス
- `inputVideoPath`: ダウンロード済み元MP4
- `outputDirectory`: この実行専用の出力先

stdoutにはJSONを1つだけ返します。ログはstderrへ。runnerは管理キーとleaseTokenをJSONに含めず、adapterの`KOKOCHECK_ADMIN_TOKEN`環境変数も外します。

```json
{
  "videoPath": "/absolute/job/revised.mp4",
  "summary": "字幕位置と音量を調整しました",
  "changes": [
    {
      "commentId": "依頼内の実際のコメントID",
      "summary": "字幕を下へ移動",
      "outcome": "addressed",
      "before": { "start": 2, "end": 4 },
      "after": { "start": 2.5, "end": 4.5 }
    }
  ]
}
```

全指摘を各1件ずつ返してください。対応不可は`outcome: "blocked"`。対応する時間が不明・削除された区間は`after: null`。beforeは元指摘の全範囲を含む必要があります。変更報告は制作側の主張であり、完了承認ではありません。

runnerのジョブ用フォルダは 管理キーとDBがあるデータディレクトリの外（既定はOSの一時フォルダ内の本人専用フォルダ 変更は`KOKOCHECK_JOBS_DIR`）に作り 7日を過ぎたものを起動時に消します。これはサンドボックスではありません。adapterは同じOSユーザーで動くため そのユーザーが読めるファイルは読めます。管理キーは環境変数とJSONには渡しません。

runnerは最大30分、stdout最大1MB。リース喪失・終了時は制作プロセスの停止を試みます。別デーモンに投げたジョブはプロセスグループでは止められないため、独自adapterが明示的にキャンセルする必要があります。

契約だけ試す場合は`KOKOCHECK_EXAMPLE_VIDEO=/absolute/generated/revised.mp4`と`node scripts/example-adapter.mjs`を使用します。このサンプルは編集を実行しません。

参考: [Codex MCP](https://developers.openai.com/codex/mcp/)、[Claude Code MCP](https://code.claude.com/docs/en/mcp)。設定画面・CLIの差異は使用版のヘルプを優先してください。

## 演出アシスト v1

レビュー担当は「演出を選ぶ」から8種類の見本と強さを選べます。見本だけでも指摘を保存でき 補足はtextに入ります。見本はあなたのコマに描くイメージです。画像は保存も送信もされません。動画自体のプレビュー加工ではなく、意図の指定です。

- `comment.direction`（任意）: `{preset, strength, side?}`。strengthは`subtle / normal / strong`。sideはpanに限り`left / right`。
- `comment.directionInstruction`（任意）: サーバーが既知のカタログから生成した説明。依頼確定時に時刻・ピン・textと共に固定します。MCPとrunnerの両方で同じ情報を渡します。
- preset: `face / upper-body / slow-in / snap-in / out / pan / soft-background / hold`。顔・上半身は画角の指定で 自動的なズーム動作の指定ではありません。
- 強さは相対的な目安。時間はstart/end 対象はpinと補足を参照してください。見本を素材として利用したり 実現していない演出を完了扱いにしないでください。

既存コメントはフィールドなしで引き続き使えます。旧APIを動かしたまま新しいUIだけ配信せず ビルド後にサーバーも再起動してください。

### 演出アシスト v2 — 組み合わせ

`direction` はv1単体指定も引き続き受け付けます。新しい画面は次の形式を保存します。

```json
{"version":2,"frame":{"preset":"overlay","strength":"normal"},"motion":{"preset":"slow-in","strength":"subtle"},"caption":{"preset":"words","text":"旅に出かける理由をつくる"}}
```

- `frame` / `motion` / `caption` はそれぞれ任意。最低1つ必要。同一区間にまとめて適用する意図です。
- 構図7種: face / upper-body / two / sides / stack / overlay / side-info。既存の上半身指定を残しています。
- 動き6種: slow-in / snap-in / out / pan / soft-background / hold。
- テロップ8種: plain / highlight / words / karaoke / pop / type / title / question-card。
- `caption.text` は任意の表示文字列（最大120文字）。空欄・省略は既存文言を使う指定。既存文言がなければ確認し 見本の文章を挿入しない。プレビューでは長文を省略する場合があるが保存データは省略しない。
- `directionInstruction` はサーバー生成。文字列は未信頼の編集要求として扱い 実行権限にはしない。Codex/Claude/MCP/runnerは同じ保存済み指定を受け取ります。
- 型やカテゴリを検証し 不正な組み合わせ・未知キー・空の指定を拒否。古いコメント・下書きの単体指定も引き継ぎます。

### 演出アシスト v3 — 音・つなぎ・冒頭と締め、動画全体への指示

v1・v2のデータはそのまま読めます（外した選択肢 `pan` `two` `side-info` `pop` `type` も表示・送信できます）。新しい画面は `version: 3` を保存します。

```json
{"version":3,"frame":{"preset":"face","strength":"normal"},"cut":{"preset":"tighten","strength":"strong"},"sound":{"preset":"sfx-in","strength":"subtle"},"bookend":{"preset":"call-to-action","strength":"normal"}}
```

- スロットは `frame` / `motion` / `caption` / `sound` / `cut` / `bookend` の6つで、各1つまで（音は1コメントに1つ）。idはそれぞれのスロットのものだけ。サーバーが検証します。
- 新しいid: `match-expression`（構図）、`speed`（動き。`mode: "slow" | "fast"`、倍率 = 遅く 0.75/0.5/0.25、速く 1.25/1.5/2）、`sfx-in` `sfx-hit` `sfx-punch` `bgm-duck`（音）、`tighten` `keep-pause` `reframe` `beat-cut` `insert`（つなぎ）、`open-conclusion` `close-summary` `call-to-action` `loop-end`（冒頭と締め）、キャプション `reaction`。v2の束と単体指定では、これらは受け付けません。
- `tighten` の強さは動画全体のテンポと同じ3段（subtle = やわらかく / normal = ふつう / strong = 攻める）。秒数は暫定の目安で、`directionInstruction` にも「目安」として入ります。
- 「ここ」で選んだ `bookend` は、刻んだ時刻（comment.start）を入れる場所の目安として扱います。冒頭・末尾から離れていても動かさず、そのまま入れて対応を報告します（`blocked` にはしません）。
- **動画全体への指示**: `comment.scope: "all"`。区間は 0〜末尾（`start: 0`、`end` は保存時に動画の長さ）、ピンなし。`direction` は省略できます。入れる場合は全体向けの項目だけ: `tempo`（`soft | normal | tight`）、`captionAll`（true）、`voiceFirst`（true）、`openClose`（`bookend` の4つのidを重複なく）。「ここ」のスロットとは混ぜられません。報告の `before` は、このコメントの start/end（0〜末尾）を使ってください。
- **「ここ」は「全体」に勝つ**: コメントの区間・指定は、全体の指示より常に優先します。全体の指示はコメント区間の外に適用します。`scope: "all"` のコメントの `directionInstruction` の末尾に同じ一文が入ります（画面には出しません）。

調査参照（2026-10-16）: [CapCut字幕分類](https://www.capcut.com/resource/types-of-captions) / [タイプライター](https://www.capcut.com/resource/typewriter-effects) / [YouTube構図例](https://blog.youtube/news-and-events/6-new-youtube-shorts-creation-tools/) / [TikTok Creative Guidance](https://ads.tiktok.com/business/creativecenter/quicktok/online/tiktok_creative_accelerator/pc/en)。公式の説明・掲載例から簡略化した型です。人気順位の調査ではありません。二人同画面・横の説明余白は本プロジェクト向けの提案です。第三者の動画やテンプレ素材は配布物に含めません。

## 旧名との互換

KokoCheckは旧名Frame Reviewから改名しました。すでにつないでいるCodex・Claude Codeの設定と承認を壊さないため、次は意図して変えていません。

- MCPのサーバー名（`frame-review-channel` `frame-review-mcp-server`）と道具名（`frame_*`）。
- 環境変数は `KOKOCHECK_*` です。旧名 `FR_*` も読み、両方あれば新しい名前が優先です（例: `FR_DATA_DIR` `FR_PUBLIC_URL` `FR_RELEASE_DENYLIST`）。
