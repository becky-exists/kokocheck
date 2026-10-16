# ソース配布

これはnpm公開用パッケージではなく 独立したソースアーカイブです。GitHubへの公開は別作業です。

```sh
npm ci
npm run doctor -- --demo
npm run build
npm test
npm run security-check
npm run release:source
```

`.data/releases/<日時>/`にtar.gz・SHA256SUMS・ファイル単位のmanifest.jsonが作られます。ソースと必要な設定だけを列挙して収録します。実動画・DB・資格情報・スクリーンショット・生成物・node_modulesは含みません。MITライセンス・lockfile・Docker設定・導入手順を同梱します。ローカルパスなどの検査は補助であり 任意の秘密情報を完全に検出するものではありません。配布前にmanifestを確認してください。

## 配布前の検出リスト

`release:source`は 一般的なローカルのユーザーパス・ボリュームパス・プライベートネットワークのホスト名・共有鍵・APIキーの形を検出します。あなた個人や組織に固有の語（氏名・社名・ホスト名・内部ツール名）はリポジトリに書かず 手元のファイルに置きます。`KOKOCHECK_RELEASE_DENYLIST`でパスを指定するか `~/.config/kokocheck/release-denylist.txt` に置いてください。1行に1つ 大文字小文字を区別しない正規表現です。空行と`#`で始まる行は無視します。

```text
# 例
my-company
my-host\.example
/mnt/my-private-disk/
```

ファイルがなくても生成できますが 一般的な検査だけになります。一致したファイル名だけを表示し 一致した内容は表示しません。

`npm pack`はpackage-lock.jsonを収録しないため このソース配布には使用しません。`.gitignore`や`.dockerignore`も含む上記コマンドを使用してください。

## 受け取った環境での確認

```sh
shasum -a 256 -c SHA256SUMS
tar -xzf kokocheck-0.1.0.tar.gz
cd kokocheck-0.1.0
npm ci
npm run doctor
npm run build
npm start
```

http://localhost:4391 を開きます。FFmpeg / ffprobeはホストへ別途インストールしてください。Dockerの場合はこのフォルダで`docker compose up --build -d`を実行します。

## 公開前

- README・ライセンス・導入・検証記録を読む。
- クリーンな展開先で起動し 同梱の自作素材でレビューを試す。
- privateデータや共有URLを含まないことを確認する。
- リポジトリ名とKokoCheck（旧称Frame Review）の扱いを決める。
- 配布元で非公開の脆弱性報告を有効化する。

FFmpegバイナリはソースアーカイブに含みません。Dockerイメージを再配布する場合はFFmpegとOSパッケージのライセンス・ソース提供条件を別途確認してください。
