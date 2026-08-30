# CLAUDE.md

このリポジトリで作業する Claude Code / claude.ai への指針。

## これは何か

小学生の子どものための「がんばり記録アプリ」。家庭内の「時間通貨（おはじき）」を、
読書・お手伝いなどで稼いだ**記録だけ**を扱う。通貨そのもの（物理のおはじき）の
管理と消費はアプリ外の運用。

**主体の分担**: 記録は子どものタップで**その場で確定**する（承認工程は廃止・#48）。
子どもは「＋◯こ もらった！」演出でその場の手応えを得る。親は「今日の集計」で
その日の内訳を見て、変な記録があれば 🗑 で消し、1日の終わりに「渡した」で締める
（最終判断＝物理のおはじきを配るのは親、という前提なので事前承認は不要）。
親の最重要ニーズは「1日の終わりに今日何枚配ればいいか」の自動集計。

## コマンド

パッケージマネージャは **pnpm**。

```bash
pnpm dev           # Vite dev サーバ
pnpm build         # 型チェック(tsc -b) → Vite バンドル（単一 HTML を dist/ へ）
pnpm lint          # ESLint
pnpm format        # Prettier で整形
pnpm format:check  # 整形チェック（CI と同じ）
pnpm test          # Vitest 一回実行
pnpm preview       # ビルド結果のプレビュー
```

テストは **Vitest**。`src/*.test.ts` に置く。単体で流すなら `pnpm test <path>`、
watch は `pnpm exec vitest`。

デプロイは **Cloudflare Workers 静的アセット**。`main` への push で
[GitHub Actions](.github/workflows/deploy.yml) が `wrangler deploy` する（`dist/` を配信、全部無料枠）。
設定は [wrangler.jsonc](wrangler.jsonc)、手順とデータの所在は [docs/DEPLOY.md](docs/DEPLOY.md)。

## 開発ワークフロー

- 作業は必ず **feature ブランチ**。`main` へ直接コミットしない。1 Issue = 1 ブランチ。
- 変更は **PR 経由**。マージは merge commit、**マージ後はブランチ削除**
  （`gh pr merge --merge --delete-branch`）。
- マージ後は `main` を fetch + fast-forward で同期してから次の作業へ。
- 各 PR で `pnpm lint` / `pnpm format:check` / `pnpm build`（`tsc -b` 込み）/ `pnpm test`
  を必ず通す（CI = [.github/workflows/ci.yml](.github/workflows/ci.yml) が enforce）。
- UI に影響する変更は iPad 実機（Safari）でも確認する。子どもが一人で操作できる
  タップ領域・文言かを見る。

## アーキテクチャ

単一 HTML アプリ。フレームワークなし。TypeScript + Vite。
`vite-plugin-singlefile` で全部を1つの HTML にバンドルする（iPad のホーム画面運用のため）。

### レイヤー（新規コードはその責務の層へ置く）

| ファイル                         | 責務                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| [src/types.ts](src/types.ts)     | ドメイン型（`State` / `Rule` / `Entry`）だけ                                                    |
| [src/logic.ts](src/logic.ts)     | **純粋ロジック**。集計・正規化・判定・CRUD。DOM も storage も触らない。**ここがテストの主対象** |
| [src/storage.ts](src/storage.ts) | 永続化の **seam（唯一の関門）**。現状 localStorage。読み込み時に必ず `normalizeState` を通す    |
| [src/main.ts](src/main.ts)       | DOM 描画とイベント配線のみ。集計・判定は `logic.ts` に委譲                                      |
| [src/style.css](src/style.css)   | 全スタイル                                                                                      |
| [index.html](index.html)         | 静的シェル（要素の骨組みだけ。ロジックは持たない）                                              |

原則:

- **計算・判定・正規化を `main.ts` に書かない。** `logic.ts` の純粋関数にして
  テストを付ける。`main.ts` からはそれを呼ぶだけ。
- **保存方式の切り替えは `storage.ts` の中だけで完結させる。** 呼び出し側は
  `loadState()` / `saveState()` のインターフェースにのみ依存する。
- 時刻・乱数・ID など非決定な値は**呼び出し側から注入**する（`makeEntry(rule, now, id, units?)`）。
  テスト容易性のため。
- ユーザー文字列（ルール名など）を `innerHTML` に差し込むときは `esc()` を通す。

### ルールの種別（#2）

- `Rule.kind = "fixed" | "timed"`
  - **fixed** … 1タップで固定枚数（はみがき・おてつだい）。確認シート → 「できた！」
  - **timed** … 15分（1単位）ごとに「＋15分」をタップ。`units`（タップ数）× ルールの枚数を
    タップ時に `Entry.reward` として確定。時間シートで枚数をライブ表示
- `UNIT_MINUTES = 15` は**表示ラベル専用**。集計は分ではなく `units` で行い、丸め計算はしない
  （子どもが完了した15分ブロックの数だけタップする運用）
- 1日の上限は設けない（親の要望）
- 旧データ（`kind` 無し）は `normalizeState` で `fixed` に移行＝従来挙動を維持

### Entry の状態（承認廃止・#48）

`EntryStatus = "approved" | "handed" | "rejected"`。

- **approved** … 記録済み・未受領（子カードに乗る／今日の集計に出る）。`makeEntry` の初期値
- **handed** … 親が締めて渡した。以後は履歴（#16）
- **rejected** … 旧データの却下ぶんのみ（集計対象外）。現行 UI では `removeEntry` で物理削除
- 旧 `pending` は `normalizeState` で `approved` に移行

### データフロー

```
子どもがメニューをタップ
  fixed → 確認シート「できた！」→ makeEntry(rule, now, id)         → push(approved) → saveState() → 演出
  timed → 時間シートで ＋15分 選択 → makeEntry(rule, now, id, units) → push(approved) → saveState() → 演出
親が PIN 解錠 → 今日の集計:
  変な記録は 🗑 → removeEntry(id) → saveState()
  1日の終わり → 「渡した」 → settleDate(dateKey) で approved→handed → saveState()
今日の集計 = approvedTotalForDate(entries, todayKey)  ← 親の最重要ビュー
```

他端末の変更はポーリング（子ども画面 / 親画面それぞれ `loadState()` を定期実行）で
緩やかに反映する。リアルタイム同期ではない。

## 未確定事項（着手前に確認）

- **データ保存先**: 現状は localStorage の1台完結。iOS の PWA ストレージは脆く
  （インストール削除で消える等）、Supabase 化 or 運用ルール整備を検討中（#44）。
  対応するときは `storage.ts` の2関数だけを差し替える。あわせて認証・アクセス制御
  （家族以外が URL を知っても入れない）も要検討。
- **本番**: Cloudflare（Workers 静的アセット、`main` push で自動デプロイ）。手順は [docs/DEPLOY.md](docs/DEPLOY.md)。
- **複数の子ども対応**: 現状1人前提。

## テストデータ・機微情報

- **子どもの記録データ（記録ログ、書き出した JSON 等）をリポジトリにコミットしない。**
  git 履歴にも残さない。子どもの生活パターンが分かる個人情報。
  `.gitignore` で `*.ohajiki.json` / `private-data/` を除外済み。
- 自動テストに置くのは、構造だけを再現した**合成データ**（中身はダミー）。
- Issue / PR 本文にも、実際の記録内容・子どもの名前・特定の生活パターンを書かない。
  「がんばること」の一覧を実際の家庭のものそのままで載せない（一般的な例に置き換える）。

## このドキュメントの原則

揮発的な実測値（ファイル行数・テスト件数など）を手書きしない（必ず陳腐化する）。
役割・責務・原則・不変の構造だけを書く。数値で縛りたいものは prose ではなく
テスト側にデータとして置く。
