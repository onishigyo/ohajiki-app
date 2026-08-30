# デプロイ（Cloudflare Workers 静的アセット）

`dist/index.html`（画像・CSS・JS を全部インラインした1ファイル）を **Cloudflare Workers**
で配信する。**すべて無料枠**（リクエスト 10 万/日・帯域無制限・自動 HTTPS・カード登録不要）。

リポジトリに [`wrangler.jsonc`](../wrangler.jsonc) を置いてあるので、`wrangler deploy` が
`dist/` を「アセットのみの Worker」として配信する（Worker スクリプトは無し）。

## 仕組み（GitHub Actions からデプロイ）

`main` への push で [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) が
`test → build → wrangler deploy` を実行する。

- 認証は GitHub Secrets の `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`
- Cloudflare 側の Git 連携（Workers Builds）は**使わない**（PR コメントが冗長なため
  Actions に寄せている）
- PR ではデプロイしない（`verify` = lint/format/build/test だけ通す）

### 初回セットアップ（一度きり）

1. Cloudflare ダッシュボード → API Tokens → **Edit Cloudflare Workers** テンプレートで
   トークンを作成
2. GitHub リポジトリ → Settings → Secrets and variables → Actions に登録:
   | Name                    | 値                 |
   | ----------------------- | ------------------ |
   | `CLOUDFLARE_API_TOKEN`  | 1 のトークン文字列 |
   | `CLOUDFLARE_ACCOUNT_ID` | アカウント ID      |
3. `main` に push すれば Deploy ワークフローが走る

## データはどこにある？

サーバにデータを保存する処理は**無い**。アプリが保存するのは各端末のブラウザの
`localStorage`（`ohajiki-state` キー）だけ。つまり:

- 配信されるのは**コードだけ**。公開 URL にアクセスしても見えるのは「まだ誰も使ってない空の UI」
- 記録は**その iPad の Safari の中だけ**にできる。他端末とは同期しない
- 当面は **iPad 1台を共有** して使う（子が日中タップ → 夜に親が同じ iPad で PIN 解錠して集計・締め）
- 複数端末で同じデータを見たくなったら Supabase 等を足す（`src/storage.ts` の 2 関数だけ差し替え・#44）

## ローカルから手動でデプロイしたいとき

```bash
pnpm build
pnpm exec wrangler deploy          # 本番へ
pnpm exec wrangler deploy --dry-run # アップロード内容の確認だけ
```

初回だけ `pnpm exec wrangler login`（ブラウザで Cloudflare 認証）。

## iPad で使う

1. Safari で本番 URL を開く
2. 共有ボタン → **ホーム画面に追加**
3. 以降はアイコンから全画面で起動（`apple-mobile-web-app-capable` 設定済み）

## すぐ試したいだけなら（ホスティング不要）

同じ Wi-Fi で Mac を起動したまま:

```bash
pnpm build && pnpm preview --host
```

表示された `http://<MacのIP>:4173` を iPad の Safari で開く。
