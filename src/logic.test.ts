import { describe, expect, it } from "vitest";
import {
  DEFAULT_GUARDIAN_LABEL,
  DEFAULT_MASCOT,
  UNITS_MAX,
  addRule,
  approvedTotalForDate,
  backupFilename,
  backupText,
  carryOverTotal,
  checkPin,
  clampReward,
  clampUnits,
  dateKey,
  deleteRule,
  earnedTotalForDate,
  moveRule,
  handedByDate,
  handedDailyTotals,
  handedTotal,
  makeDefaultState,
  makeEntry,
  mascotLine,
  minutesForUnits,
  normalizeGuardianLabel,
  normalizeKind,
  normalizeMascot,
  normalizePin,
  normalizeState,
  parseBackup,
  removeEntry,
  rewardForUnits,
  settleDate,
  timeLabel,
  unsettledDates,
  updateRule,
} from "./logic.ts";
import type { Entry, Rule } from "./types.ts";

const fixedRule: Rule = { id: "r1", emoji: "🦷", name: "はみがき", reward: 1, kind: "fixed" };
const timedRule: Rule = { id: "r2", emoji: "📚", name: "どくしょ", reward: 2, kind: "timed" };

function entry(over: Partial<Entry>): Entry {
  return {
    id: "e1",
    ruleId: "r1",
    emoji: "🦷",
    name: "はみがき",
    reward: 1,
    date: "2026-08-27",
    time: "10:00",
    status: "approved",
    ...over,
  };
}

describe("dateKey / timeLabel", () => {
  it("1桁の月日を0埋めする", () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
  it("時刻を HH:MM で0埋めする", () => {
    expect(timeLabel(new Date(2026, 0, 5, 9, 3))).toBe("09:03");
  });
});

describe("clampReward", () => {
  it("0以上の整数に正規化する（上限なし）", () => {
    expect(clampReward(-3)).toBe(0);
    expect(clampReward(999)).toBe(999);
    expect(clampReward(3000)).toBe(3000);
    expect(clampReward(7)).toBe(7);
  });
  it("小数は切り捨て、非数値は0", () => {
    expect(clampReward(3.9)).toBe(3);
    expect(clampReward("abc")).toBe(0);
    expect(clampReward(undefined)).toBe(0);
  });
});

describe("時間型（timed）ロジック #2", () => {
  it("clampUnits は 1〜UNITS_MAX の整数", () => {
    expect(clampUnits(0)).toBe(1);
    expect(clampUnits(-5)).toBe(1);
    expect(clampUnits(3.9)).toBe(3);
    expect(clampUnits(999)).toBe(UNITS_MAX);
    expect(clampUnits("x")).toBe(1);
  });
  it("rewardForUnits = units × ルールの枚数（1日の上限なし）", () => {
    expect(rewardForUnits(timedRule, 4)).toBe(8); // 読書1時間 = 4回分 = 8こ
    expect(rewardForUnits(timedRule, 12)).toBe(24); // 3時間でも頭打ちしない
  });
  it("minutesForUnits は 15分刻みの目安", () => {
    expect(minutesForUnits(6)).toBe(90);
  });
  it("normalizeKind は timed 以外すべて fixed", () => {
    expect(normalizeKind("timed")).toBe("timed");
    expect(normalizeKind("fixed")).toBe("fixed");
    expect(normalizeKind(undefined)).toBe("fixed");
    expect(normalizeKind("bogus")).toBe("fixed");
  });
});

describe("normalizePin / checkPin", () => {
  it("数字以外を除去し4桁に整える（不足は先頭0埋め）", () => {
    expect(normalizePin("12a3")).toBe("0123");
    expect(normalizePin("123456")).toBe("1234");
    expect(normalizePin("")).toBe("0000");
  });
  it("4桁一致のみ true。途中入力は false", () => {
    expect(checkPin("0000", "0000")).toBe(true);
    expect(checkPin("000", "0000")).toBe(false);
    expect(checkPin("0001", "0000")).toBe(false);
  });
});

describe("normalizeGuardianLabel", () => {
  it("空・空白・非文字列は既定値", () => {
    expect(normalizeGuardianLabel("")).toBe(DEFAULT_GUARDIAN_LABEL);
    expect(normalizeGuardianLabel("   ")).toBe(DEFAULT_GUARDIAN_LABEL);
    expect(normalizeGuardianLabel(null)).toBe(DEFAULT_GUARDIAN_LABEL);
  });
  it("前後空白を落として保持", () => {
    expect(normalizeGuardianLabel("  パパ ")).toBe("パパ");
  });
});

describe("normalizeState", () => {
  it("null は既定状態", () => {
    expect(normalizeState(null)).toEqual(makeDefaultState());
  });
  it("欠損フィールドを補完する", () => {
    const s = normalizeState({ entries: [] });
    expect(s.rules.length).toBeGreaterThan(0);
    expect(s.pin).toBe("0000");
    expect(s.guardianLabel).toBe(DEFAULT_GUARDIAN_LABEL);
    expect(s.mascot).toEqual(DEFAULT_MASCOT);
  });
  it("mascot の矛盾入力を正規化して保持する", () => {
    const s = normalizeState({ mascot: { sadMax: 6, okMax: 1 } });
    expect(s.mascot).toEqual({ sadMax: 6, okMax: 7 });
  });
  it("旧データ（kind 無しルール）は fixed に移行する", () => {
    const s = normalizeState({
      rules: [{ id: "old", emoji: "🧹", name: "そうじ", reward: 1 }],
    });
    expect(s.rules[0].kind).toBe("fixed");
  });
  it("timed ルールと units 付き申請を保持する", () => {
    const s = normalizeState({
      rules: [{ id: "r2", emoji: "📚", name: "どくしょ", reward: 2, kind: "timed" }],
      entries: [
        {
          id: "e",
          ruleId: "r2",
          emoji: "📚",
          name: "どくしょ",
          reward: 8,
          units: 4,
          date: "2026-08-27",
          time: "10:00",
          status: "approved",
        },
      ],
    });
    expect(s.rules[0].kind).toBe("timed");
    expect(s.entries[0].units).toBe(4);
  });
  it("壊れた units（0・負・非数値）は落とす", () => {
    const s = normalizeState({
      entries: [{ id: "e", date: "2026-08-27", reward: 1, units: 0, status: "approved" }],
    });
    expect(s.entries[0].units).toBeUndefined();
  });
  it("壊れた reward / status を正規化する", () => {
    const s = normalizeState({
      rules: [{ id: "x", emoji: "🎨", name: "え", reward: "500", kind: "timed" }],
      entries: [{ id: "e", date: "2026-08-27", reward: -1, status: "bogus" }],
    });
    expect(s.rules[0].reward).toBe(500);
    expect(s.entries[0].reward).toBe(0);
    expect(s.entries[0].status).toBe("approved"); // 未知の値は approved（#48）
  });
  it("旧 pending は approved に移行する（承認廃止・#48）", () => {
    const s = normalizeState({
      entries: [
        { id: "p", date: "2026-08-27", reward: 2, status: "pending" },
        { id: "h", date: "2026-08-20", reward: 1, status: "handed" },
        { id: "r", date: "2026-08-20", reward: 9, status: "rejected" },
      ],
    });
    expect(s.entries.map((e) => e.status)).toEqual(["approved", "handed", "rejected"]);
  });
});

describe("集計", () => {
  const entries: Entry[] = [
    entry({ id: "a", date: "2026-08-27", status: "approved", reward: 2 }),
    entry({ id: "b", date: "2026-08-27", status: "approved", reward: 1 }),
    entry({ id: "d", date: "2026-08-27", status: "rejected", reward: 3 }),
    entry({ id: "e", date: "2026-08-26", status: "approved", reward: 9 }),
  ];
  it("その日の未受領（approved）reward だけ合計する", () => {
    expect(approvedTotalForDate(entries, "2026-08-27")).toBe(3);
  });
  it("他の日を混ぜない", () => {
    expect(approvedTotalForDate(entries, "2026-08-26")).toBe(9);
  });
  it("rejected は集計に入れない", () => {
    expect(
      approvedTotalForDate(
        entries.concat(entry({ id: "z", date: "2026-08-26", status: "rejected", reward: 100 })),
        "2026-08-26",
      ),
    ).toBe(9);
  });
  it("earnedTotalForDate は approved + handed（rejected 除外）", () => {
    const list = [
      entry({ id: "a", date: "2026-08-27", status: "approved", reward: 2 }),
      entry({ id: "b", date: "2026-08-27", status: "handed", reward: 3 }),
      entry({ id: "c", date: "2026-08-27", status: "rejected", reward: 5 }),
    ];
    expect(earnedTotalForDate(list, "2026-08-27")).toBe(5);
    expect(earnedTotalForDate(list, "2026-08-25")).toBe(0);
  });
});

describe("マスコット #51", () => {
  it("昨日の数で表情とセリフが3段階（既定の境界 4/9）", () => {
    expect(mascotLine(null)).toEqual({ mood: "sad", text: "きのうは 0こ… さみしいです。" });
    expect(mascotLine(0)).toEqual({ mood: "sad", text: "きのうは 0こ… さみしいです。" });
    expect(mascotLine(4).mood).toBe("sad");
    expect(mascotLine(5)).toEqual({ mood: "ok", text: "きのうは 5こ です。" });
    expect(mascotLine(9).mood).toBe("ok");
    expect(mascotLine(10)).toEqual({ mood: "happy", text: "きのうは 10こ！ うれしい！！！" });
  });

  it("境界は設定で変えられる", () => {
    const config = { sadMax: 2, okMax: 3 };
    expect(mascotLine(2, config).mood).toBe("sad");
    expect(mascotLine(3, config).mood).toBe("ok");
    expect(mascotLine(4, config).mood).toBe("happy");
  });

  it("normalizeMascot: 欠損・非数値は既定値", () => {
    expect(normalizeMascot(undefined)).toEqual(DEFAULT_MASCOT);
    expect(normalizeMascot({})).toEqual(DEFAULT_MASCOT);
    expect(normalizeMascot({ sadMax: "x", okMax: null })).toEqual(DEFAULT_MASCOT);
  });

  it("normalizeMascot: 小数は切り捨て・範囲外はクランプ・矛盾は補正", () => {
    expect(normalizeMascot({ sadMax: 3.9, okMax: 7.2 })).toEqual({ sadMax: 3, okMax: 7 });
    expect(normalizeMascot({ sadMax: -5, okMax: 999 })).toEqual({ sadMax: 0, okMax: 99 });
    // さみしい ≥ ふつう の入力は ふつうの帯を1こ空ける
    expect(normalizeMascot({ sadMax: 8, okMax: 8 })).toEqual({ sadMax: 8, okMax: 9 });
    expect(normalizeMascot({ sadMax: 10, okMax: 2 })).toEqual({ sadMax: 10, okMax: 11 });
  });
});

describe("ルール CRUD（非破壊）", () => {
  it("addRule は fixed の新ルールを追加し元を変えない", () => {
    const rules = [fixedRule];
    const next = addRule(rules, "r9");
    expect(next).toHaveLength(2);
    expect(next[1].kind).toBe("fixed");
    expect(rules).toHaveLength(1);
  });
  it("deleteRule は該当を除く", () => {
    expect(deleteRule([fixedRule], "r1")).toHaveLength(0);
  });
  it("moveRule は上下に入れ替え、端では変化なし（非破壊）", () => {
    const rules = [fixedRule, timedRule, { ...fixedRule, id: "r3", name: "そうじ" }];
    expect(moveRule(rules, "r1", 1).map((r) => r.id)).toEqual(["r2", "r1", "r3"]);
    expect(moveRule(rules, "r3", -1).map((r) => r.id)).toEqual(["r1", "r3", "r2"]);
    expect(moveRule(rules, "r1", -1)).toBe(rules); // 先頭を上は変化なし（同一参照）
    expect(moveRule(rules, "r3", 1)).toBe(rules); // 末尾を下も同様
    expect(rules.map((r) => r.id)).toEqual(["r1", "r2", "r3"]); // 元配列は不変
  });
  it("updateRule は reward を整数・非負に正規化する", () => {
    const next = updateRule([fixedRule], "r1", { reward: 999 });
    expect(next[0].reward).toBe(999);
    expect(next[0].name).toBe("はみがき");
  });
  it("updateRule は kind を切り替えられる", () => {
    const next = updateRule([fixedRule], "r1", { kind: "timed" });
    expect(next[0].kind).toBe("timed");
  });
  it("updateRule は他のルールに触らない", () => {
    const next = updateRule([fixedRule, timedRule], "r1", { name: "は" });
    expect(next[1].name).toBe("どくしょ");
    expect(next[1].kind).toBe("timed");
  });
});

describe("記録の生成・取り消し", () => {
  it("fixed: ルールのスナップショットを approved で作る（承認廃止・units なし）", () => {
    const e = makeEntry(fixedRule, new Date(2026, 7, 27, 10, 5), "e99");
    expect(e).toMatchObject({ id: "e99", ruleId: "r1", reward: 1, status: "approved" });
    expect(e.units).toBeUndefined();
  });
  it("timed: units を持ち reward = units × ルールの枚数", () => {
    const e = makeEntry(timedRule, new Date(2026, 7, 27, 18, 0), "e100", 6);
    expect(e.units).toBe(6); // 90分 = 6タップ
    expect(e.reward).toBe(12);
  });
  it("timed: units 未指定なら 1 単位", () => {
    const e = makeEntry(timedRule, new Date(2026, 7, 27, 18, 0), "e101");
    expect(e.units).toBe(1);
    expect(e.reward).toBe(2);
  });
  it("removeEntry は対象だけ消す（親の取り消し・#48）", () => {
    const list = [entry({ id: "a" }), entry({ id: "b" }), entry({ id: "c" })];
    expect(removeEntry(list, "b").map((e) => e.id)).toEqual(["a", "c"]);
    expect(removeEntry(list, "zzz")).toHaveLength(3);
    expect(list).toHaveLength(3); // 非破壊
  });
});

describe("1日を締めるワークフロー #20", () => {
  const list: Entry[] = [
    entry({ id: "m1", date: "2026-08-27", status: "approved", reward: 5 }),
    entry({ id: "t1", date: "2026-08-28", status: "approved", reward: 3 }),
    entry({ id: "t2", date: "2026-08-28", status: "handed", reward: 1 }),
    entry({ id: "t3", date: "2026-08-28", status: "rejected", reward: 9 }),
  ];

  it("normalizeStatus は handed を保持する", () => {
    const s = normalizeState({
      entries: [{ id: "e", date: "2026-08-28", reward: 1, status: "handed" }],
    });
    expect(s.entries[0].status).toBe("handed");
  });

  it("approvedTotalForDate は handed を含めない", () => {
    expect(approvedTotalForDate(list, "2026-08-28")).toBe(3); // t1 のみ。t2(handed)/t3(rejected) は除外
  });

  it("unsettledDates は approved が残る日付を古い順で返す", () => {
    expect(unsettledDates(list)).toEqual(["2026-08-27", "2026-08-28"]);
  });

  it("carryOverTotal は key より前の approved 合計（締め忘れぶん）", () => {
    expect(carryOverTotal(list, "2026-08-28")).toBe(5); // m1
    expect(carryOverTotal(list, "2026-08-27")).toBe(0);
  });

  it("settleDate はその日の approved を handed に（他日・他ステータスは不変）", () => {
    const next = settleDate(list, "2026-08-28");
    expect(next.find((e) => e.id === "t1")?.status).toBe("handed");
    expect(next.find((e) => e.id === "m1")?.status).toBe("approved"); // 27日は不変
    expect(next.find((e) => e.id === "t3")?.status).toBe("rejected");
  });
});

describe("履歴 #16", () => {
  const list: Entry[] = [
    entry({ id: "a", date: "2026-08-26", status: "handed", reward: 4 }),
    entry({ id: "b", date: "2026-08-26", status: "handed", reward: 1 }),
    entry({ id: "c", date: "2026-08-28", status: "handed", reward: 6 }),
    entry({ id: "d", date: "2026-08-28", status: "approved", reward: 9 }), // 未受領は履歴外
  ];
  it("handedTotal は handed だけの合計", () => {
    expect(handedTotal(list)).toBe(11);
  });
  it("handedByDate は日付ごと・新しい日が先", () => {
    const days = handedByDate(list);
    expect(days.map((d) => d.date)).toEqual(["2026-08-28", "2026-08-26"]);
    expect(days[0].total).toBe(6);
    expect(days[1].total).toBe(5);
    expect(days[1].items).toHaveLength(2);
  });
  it("handedDailyTotals は日ごと・古い順・空日も0で埋める・やった日でバケット", () => {
    const many: Entry[] = [
      entry({ id: "e1", date: "2026-08-25", status: "handed", reward: 3 }),
      entry({ id: "e2", date: "2026-08-25", status: "handed", reward: 2 }), // 同じ日にまとめて
      entry({ id: "e3", date: "2026-08-27", status: "handed", reward: 5 }),
      entry({ id: "e4", date: "2026-08-27", status: "approved", reward: 9 }), // 未受領は対象外
    ];
    // end=8/28、5日ぶん → 8/24〜8/28
    expect(handedDailyTotals(many, new Date(2026, 7, 28), 5)).toEqual([
      { date: "2026-08-24", total: 0 },
      { date: "2026-08-25", total: 5 },
      { date: "2026-08-26", total: 0 },
      { date: "2026-08-27", total: 5 },
      { date: "2026-08-28", total: 0 },
    ]);
  });
});

describe("バックアップ #19", () => {
  it("backupText → parseBackup で往復できる", () => {
    const s = makeDefaultState();
    s.entries = [entry({ id: "x", date: "2026-08-26", status: "handed", reward: 3 })];
    s.pin = "1234";
    s.guardianLabel = "ママ";
    expect(parseBackup(backupText(s))).toEqual(s);
  });

  it("backupFilename は日付入り・.ohajiki.json（.gitignore 済み）", () => {
    expect(backupFilename(new Date(2026, 7, 28))).toBe("ohajiki-backup-2026-08-28.ohajiki.json");
  });

  it("parseBackup: 壊れた JSON / 非オブジェクトは null", () => {
    expect(parseBackup("not json")).toBeNull();
    expect(parseBackup("123")).toBeNull();
    expect(parseBackup("[1,2,3]")).toBeNull();
    expect(parseBackup('"str"')).toBeNull();
  });

  it("parseBackup: 欠損フィールドは normalizeState が補完", () => {
    const restored = parseBackup('{"entries":[]}');
    expect(restored).not.toBeNull();
    expect(restored?.rules.length).toBeGreaterThan(0);
    expect(restored?.guardianLabel).toBe(DEFAULT_GUARDIAN_LABEL);
  });
});
