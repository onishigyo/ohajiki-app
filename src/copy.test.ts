// 文言仕様（docs/copy-spec.html）のガード。
// 揃えたはずの語がコード編集でこっそり戻るのを防ぐ、ソース走査型のチェック。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// logic.ts も対象（mascotLine などユーザー向け文字列を組み立てる）
const src = ["index.html", "src/main.ts", "src/logic.ts"]
  .map((p) => readFileSync(resolve(process.cwd(), p), "utf8"))
  .join("\n");

describe("文言仕様ガード", () => {
  it.each([
    ["ちがうよ", "→ PIN エラーは「ばんごうが ちがいます」"],
    ["がんばりメニュー", "→「がんばること」に統一"],
    ["15ふん", "→ 「15分」（漢字ポリシー v2）"],
    ["かいぶん", "→ 「回ぶん」"],
    ["わたした", "→ 親画面は「渡した」（漢字ポリシー v2）"],
    ["おねがい する", "→ 承認は廃止。子は「できた！」（#48）"],
    ["お願い する", "→ 承認は廃止。子は「できた！」（#48）"],
    ["かくにんまち", "→ 承認は廃止（#17 撤去・#48）"],
    ["承認しました", "→ 承認工程は廃止（#48）"],
  ])("使わない語が残っていない: %s", (banned) => {
    expect(src).not.toContain(banned);
  });

  it.each([
    "できた！", // fixed / timed 送信ボタン 共通
    "がんばること",
    "渡した", // ◯◯の 分を 渡した（#20）
    "けす", // 今日の集計で記録を消す（#48）
    "きのうは", // マスコットのグリーティング（#51・口調は です・ます）
    "タッチ してね", // グリーティングのヒント（#51）
    "うさぎの きぶん", // 設定：表情が変わる境界（#51）
    "きょう やったこと", // 今日の内訳（見出し＋導線ボタン）
  ])("あるべき語がある: %s", (needed) => {
    expect(src).toContain(needed);
  });

  it("送信ボタンは fixed / timed で同じ文言", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    const labels = [...html.matchAll(/id="(confirmSubmit|timedSubmit)">([^<]+)</g)].map(
      (m) => m[2],
    );
    expect(labels).toHaveLength(2);
    expect(new Set(labels).size).toBe(1);
  });
});
