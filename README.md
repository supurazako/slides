# supurazako Slide Gallery

Cloudflare Workers Static Assets で配信する静的なスライド一覧です。

## スライドを追加する

1. PDF や HTML のスライドを `public/slides/` に置きます。
2. `public/slides.json` の `slides` 配列に情報を追加します。
3. サムネイルを表示する場合は画像を `public/previews/` に置き、`preview` にパスを指定します。

```json
{
  "title": "発表タイトル",
  "date": "2026-10-08",
  "format": "PDF",
  "href": "/slides/example.pdf",
  "preview": "/previews/example.webp"
}
```

`date` と `preview` は省略できます。日付が新しいスライドから表示します。`href` はサイト内のファイルパスか `https://` URL を指定できます。

## ローカル表示

```sh
npx wrangler dev
```

## デプロイ

```sh
npx wrangler deploy
```

`wrangler.jsonc` には `slide.supurazako.com` の Custom Domain を設定しています。デプロイ前に Cloudflare アカウントで `supurazako.com` zone が有効であることを確認してください。同じホスト名に既存の CNAME レコードがある場合は、Custom Domain を作成する前に Cloudflare DNS から整理してください。
