# Contributing

Node.js 24.14以上とFFmpeg / ffprobeを使用します。デモ・テストにはPython 3とPillowも必要です。

```sh
npm ci
npm run doctor -- --demo
npm run build
npm test
npm run security-check
```

開発サーバーは`npm run dev`。実案件と分ける場合は`KOKOCHECK_DATA_DIR=.test-data/manual PORT=4392 KOKOCHECK_PUBLIC_URL=http://localhost:4392 npm run dev`。

- 面を塗る色はIWの青緑ひとつだけです。塗りのボタンは画面に同時に1つで、橙と赤は文字とアイコンだけに使います。
- 読む内容を上 操作を下に配置します。画面の言葉は動詞と名詞だけにし、半角スペースで句を区切りません。ユーザーの原文は変更しません。
- スマホ幅390pxと320px 高さが短い状態 デスクトップで確認します。ソフトウェアキーボード・指のタッチ操作は実機で別途確認してください。
- 動画・共有キー・管理キー・`.data/`・`.env`をコミットやIssueへ添付しないでください。再現用には`scripts/fixture.ts`の自作素材を使います。
- 演出の見本は、あなたのコマに描くイメージです。画像は保存も送信もされません。第三者の動画・テンプレートを同梱しないでください。
- 修正結果の報告と人によるOKは別です。自動テストやエージェントが代わりに承認しないようにします。
- PRには変更する体験・検証結果・未確認事項を記載してください。

配布アーカイブは`npm run release:source`で作成します。外部への送信や公開は行いません。配布前の確認手順は[RELEASE.md](docs/RELEASE.md)を参照してください。
