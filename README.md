# supurazako Slide Gallery

Cloudflare Workers Static Assets で配信する静的なスライド一覧です。

## PDF スライドを追加する

PDF を `public/slides/` に置くだけで、`npm run dev` または `npm run deploy` の実行時に一覧を更新します。

- PDF の文書タイトルを一覧タイトルに使います。タイトルがない場合は1ページ目の先頭行、さらに取れない場合はファイル名を使います。
- 先頭5ページから日付を探します。日付が見つからない場合は日付を表示しません。
- 1ページ目からサムネイルを生成します。

PDF のメタデータとテキスト抽出、サムネイル生成には Poppler が必要です。macOS では `brew install poppler` で導入できます。

PDF 以外のスライドは `public/slides.json` に手動登録できます。自動生成時も、`public/slides/` 内の PDF 以外を指す登録は保持されます。

## ローカル表示

```sh
npm run dev
```

## デプロイ

```sh
npm run deploy
```

どちらのコマンドも先に PDF 一覧を生成します。`wrangler.jsonc` には `slide.supurazako.com` の Custom Domain を設定しています。デプロイ前に Cloudflare アカウントで `supurazako.com` zone が有効であることを確認してください。同じホスト名に既存の CNAME レコードがある場合は、Custom Domain を作成する前に Cloudflare DNS から整理してください。
