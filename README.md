# supurazako Slide Gallery

Astro で静的生成し、Cloudflare Workers Static Assets から配信するスライドギャラリーです。スライド一覧とPDFビューアーのHTMLはビルド時に生成され、Cloudflare Worker上でのサーバー処理は使いません。

## PDFを追加する

PDFを `public/slides/` に置き、`npm run dev` または `npm run deploy` を実行します。ビルド時に一覧情報と各ページのJPEG画像を生成し、一覧カードからページ送りビューアーを開けるようにします。

- タイトルはPDFの文書メタデータから取得し、ない場合は1ページ目の先頭行、さらに取れない場合はファイル名を使います。
- 先頭5ページから日付を探し、見つかった場合に一覧へ表示します。
- ページ画像は長辺1600px、JPEG品質86で生成します。
- ビューアーは画面全体に近い大きさでスライドを表示し、タイトル・枚数・操作ボタンを重ねます。全画面ボタンから発表向けの全画面表示に切り替えられます。約2.6秒間操作がないとUIが隠れ、ポインター移動やキー入力で再表示します。左右ボタン、キーボードの←/→・Space・Enter、タッチのスワイプで操作でき、`?page=3` のようにページ番号をURLで共有できます。

PDF情報の読み取りと画像生成には Poppler が必要です。macOS では `brew install poppler` で導入できます。

## ローカル表示

```sh
npm install
npm run dev
```

## デプロイ

```sh
npm run deploy
```

`wrangler.jsonc` は `dist/` を配信し、`slide.supurazako.com` を Custom Domain として設定しています。デプロイ前にCloudflareアカウントで `supurazako.com` zone が有効であることを確認してください。同じホスト名に既存のDNSレコードがある場合は、Custom Domainを設定する前に整理してください。

## 今後の形式追加

PDF以外の項目は `src/data/manual-slides.json` に登録できます。現在のページ送りビューアーはPDF向けです。Keynoteや動画の表示・再生方法は、対応形式と公開方法を決めてから追加します。
