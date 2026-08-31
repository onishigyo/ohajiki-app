// ===================================================================
// 純粋ロジック層。DOM も storage も触らない。ここが自動テストの対象。
// ===================================================================
import type { Entry, EntryStatus, MascotConfig, Rule, RuleKind, State } from "./types.ts";

export const PIN_LENGTH = 4;
export const DEFAULT_GUARDIAN_LABEL = "おうちの人";

/** timed ルールの1単位＝15分（表示ラベル用。集計はタップ数で行い時間計算はしない）。 */
export const UNIT_MINUTES = 15;
/** timed の1申請あたりのタップ数の上限（指が詰まった時のガード。実質「上限なし」運用）。 */
export const UNITS_MAX = 40;

export const BEAD_COLORS = ["#f28ba8", "#5fc7ad", "#f5c451", "#b79ae0", "#7cc0e8", "#f2a25c"];

export const DEFAULT_RULES: readonly Rule[] = [
  { id: "r1", emoji: "📚", name: "どくしょ", reward: 2, kind: "timed" },
  { id: "r2", emoji: "🧹", name: "おてつだい", reward: 1, kind: "fixed" },
  { id: "r3", emoji: "🦷", name: "はみがき", reward: 1, kind: "fixed" },
  { id: "r4", emoji: "✏️", name: "べんきょう", reward: 2, kind: "timed" },
];

/** 与えられた日時のローカル日付キー "YYYY-MM-DD"。 */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 与えられた日時のローカル時刻 "HH:MM"。 */
export function timeLabel(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

export function makeDefaultState(): State {
  return {
    rules: DEFAULT_RULES.map((r) => ({ ...r })),
    entries: [],
    pin: "0".repeat(PIN_LENGTH),
    guardianLabel: DEFAULT_GUARDIAN_LABEL,
    mascot: { ...DEFAULT_MASCOT },
  };
}

/** 保存済みデータの欠損・型崩れを補完して State に正規化する。
 *  window.storage 廃止・スキーマ変更に備えた1本の関門。 */
export function normalizeState(raw: unknown): State {
  const base = makeDefaultState();
  if (typeof raw !== "object" || raw === null) return base;
  const obj = raw as Record<string, unknown>;

  const rules = Array.isArray(obj.rules)
    ? obj.rules.filter(isRuleLike).map((r) => ({
        id: String(r.id),
        emoji: String(r.emoji),
        name: String(r.name),
        reward: clampReward(r.reward),
        // 旧データ（kind 無し）は fixed 扱い＝従来挙動を維持。
        kind: normalizeKind(r.kind),
      }))
    : base.rules;

  const entries = Array.isArray(obj.entries)
    ? obj.entries.filter(isEntryLike).map((e) => {
        const units = normalizeUnits(e.units);
        return {
          id: String(e.id),
          ruleId: String(e.ruleId),
          emoji: String(e.emoji),
          name: String(e.name),
          reward: clampReward(e.reward),
          ...(units !== null ? { units } : {}),
          date: String(e.date),
          time: String(e.time),
          status: normalizeStatus(e.status),
        };
      })
    : base.entries;

  return {
    rules: rules.length > 0 ? rules : base.rules,
    entries,
    pin: normalizePin(typeof obj.pin === "string" ? obj.pin : base.pin),
    guardianLabel: normalizeGuardianLabel(obj.guardianLabel),
    mascot: normalizeMascot(obj.mascot),
  };
}

function isRuleLike(v: unknown): v is Record<"id" | "emoji" | "name" | "reward" | "kind", unknown> {
  return typeof v === "object" && v !== null && "id" in v && "name" in v;
}

function isEntryLike(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && "id" in v && "date" in v;
}

function normalizeStatus(v: unknown): EntryStatus {
  // 承認廃止（#48）：旧 pending や未知の値は approved に寄せる。handed / rejected は保持。
  return v === "handed" ? "handed" : v === "rejected" ? "rejected" : "approved";
}

export function normalizeKind(v: unknown): RuleKind {
  return v === "timed" ? "timed" : "fixed";
}

/** units を 1〜UNITS_MAX の整数に。無効なら null（＝fixed 申請）。 */
function normalizeUnits(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(UNITS_MAX, Math.trunc(n));
}

/** タップ数を 1〜UNITS_MAX の整数に収める。 */
export function clampUnits(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(UNITS_MAX, Math.trunc(n)));
}

/** reward を「0以上の整数」に正規化する。数値以外は 0。上限は設けない
 *  （timed は units 倍で伸びるので、単価に上限を付けても意味がない）。 */
export function clampReward(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

/** timed ルールで units タップぶんの付与枚数。1日の上限は設けない（#2）。 */
export function rewardForUnits(rule: Rule, units: number): number {
  return clampUnits(units) * clampReward(rule.reward);
}

/** units（タップ数）に対応する目安の分数。表示専用。 */
export function minutesForUnits(units: number): number {
  return units * UNIT_MINUTES;
}

/** PIN 入力を数字のみ・4桁に整える（元実装踏襲：不足分は先頭を "0" 埋め）。 */
export function normalizePin(raw: string): string {
  return (raw || "").replace(/\D/g, "").slice(0, PIN_LENGTH).padStart(PIN_LENGTH, "0");
}

/** 入力 PIN が一致するか。桁不足の途中入力は常に false。 */
export function checkPin(input: string, pin: string): boolean {
  return input.length === PIN_LENGTH && input === pin;
}

/** guardianLabel の空・非文字列を既定値にフォールバック。 */
export function normalizeGuardianLabel(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_GUARDIAN_LABEL;
  return raw.trim() || DEFAULT_GUARDIAN_LABEL;
}

// ---- 集計 ---------------------------------------------------------

export function entriesForDate(entries: Entry[], key: string): Entry[] {
  return entries.filter((e) => e.date === key);
}

export function entriesByStatus(entries: Entry[], status: EntryStatus): Entry[] {
  return entries.filter((e) => e.status === status);
}

export function totalReward(entries: Entry[]): number {
  return entries.reduce((sum, e) => sum + e.reward, 0);
}

/** その日の「記録済み・未受領」の記録そのもの（つけた順のまま）。内訳表示用。 */
export function approvedEntriesForDate(entries: Entry[], key: string): Entry[] {
  return entriesByStatus(entriesForDate(entries, key), "approved");
}

/** その日の「まだ渡してない枚数」＝ status=approved の reward 合計（handed は含まない）。 */
export function approvedTotalForDate(entries: Entry[], key: string): number {
  return totalReward(approvedEntriesForDate(entries, key));
}

/** その日に「もらった数」＝ approved + handed の reward 合計（rejected は除外）。
 *  渡す前でもカウントする（マスコットの昨日コメント用・#51）。 */
export function earnedTotalForDate(entries: Entry[], key: string): number {
  return totalReward(entriesForDate(entries, key).filter((e) => e.status !== "rejected"));
}

/** 記録済み・未受領（approved）の記録が残っている日付の一覧。古い順。 */
export function unsettledDates(entries: Entry[]): string[] {
  const dates = new Set(entriesByStatus(entries, "approved").map((e) => e.date));
  return [...dates].sort();
}

/** key より前の日付に「記録済み・未受領」がある合計（＝締め忘れぶん）。 */
export function carryOverTotal(entries: Entry[], key: string): number {
  return totalReward(entriesByStatus(entries, "approved").filter((e) => e.date < key));
}

// ---- 締め（#20）・記録の取り消し（#48）--------------------------

/** 記録を1件消す（親が「今日の集計」で取り消し。承認廃止で reject の代わり）。 */
export function removeEntry(entries: Entry[], id: string): Entry[] {
  return entries.filter((e) => e.id !== id);
}

/** その日ぶんを締める：approved → handed（おはじきを渡した）。 */
export function settleDate(entries: Entry[], key: string): Entry[] {
  return entries.map((e) =>
    e.date === key && e.status === "approved" ? { ...e, status: "handed" as const } : e,
  );
}

// ---- マスコット（#51）：昨日の数で表情とセリフを決める -----------

export type MascotMood = "sad" | "ok" | "happy";

/** 「さみしい／ふつう／うれしい」の境界の初期値。親が設定画面で変えられる（#51）。 */
export const DEFAULT_MASCOT: MascotConfig = { sadMax: 4, okMax: 9 };
/** 設定画面で入れられる上限（際限ない値を弾く）。 */
export const MASCOT_MAX_THRESHOLD = 99;

/** mascot 設定の欠損・型崩れ・矛盾（sadMax ≥ okMax など）を直して返す。 */
export function normalizeMascot(raw: unknown): MascotConfig {
  const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const clamp = (v: unknown, fallback: number) => {
    if (v === null || v === undefined) return fallback;
    if (typeof v === "string" && v.trim() === "") return fallback;
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, 0), MASCOT_MAX_THRESHOLD);
  };
  const sadMax = clamp(obj.sadMax, DEFAULT_MASCOT.sadMax);
  let okMax = clamp(obj.okMax, DEFAULT_MASCOT.okMax);
  // 「ふつう」の帯が必ず1こぶん以上あるようにする。
  if (okMax <= sadMax) okMax = Math.min(sadMax + 1, MASCOT_MAX_THRESHOLD);
  return { sadMax, okMax };
}

/** 昨日の数 → うさぎの表情とセリフ。null は「昨日データ無し」＝ 0 と同じ扱い。
 *  境界は設定（#51）。口調は です・ます（アプリ本体の砕けた口調と対比）。 */
export function mascotLine(
  count: number | null,
  config: MascotConfig = DEFAULT_MASCOT,
): { mood: MascotMood; text: string } {
  const { sadMax, okMax } = normalizeMascot(config);
  const n = count ?? 0;
  if (n <= sadMax) return { mood: "sad", text: `きのうは ${n}こ… さみしいです。` };
  if (n <= okMax) return { mood: "ok", text: `きのうは ${n}こ です。` };
  return { mood: "happy", text: `きのうは ${n}こ！ うれしい！！！` };
}

// ---- 履歴（#16）：渡しずみ（handed）の振り返り ------------------

/** これまで渡した おはじきの合計。 */
export function handedTotal(entries: Entry[]): number {
  return totalReward(entriesByStatus(entries, "handed"));
}

/** 渡しずみを日付ごとにまとめる。新しい日が先。 */
export function handedByDate(entries: Entry[]): { date: string; total: number; items: Entry[] }[] {
  const handed = entriesByStatus(entries, "handed");
  const byDate = new Map<string, Entry[]>();
  for (const e of handed) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }
  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => ({ date, total: totalReward(items), items }));
}

/** 棒グラフ用：渡しずみ（handed）の数を「日」でまとめる。end を含む日から過去 days 日ぶんを古い順で。
 *  データの無い日も total:0 で埋める。
 *  バケットは「やった日」（`e.date`）＝いつ渡したかは無関係なので、親がまとめて締めても
 *  棒はその作業をやった日に乗る（数日遅れて埋まるだけ・#16）。 */
export function handedDailyTotals(
  entries: Entry[],
  end: Date,
  days = 10,
): { date: string; total: number }[] {
  const byDate = new Map<string, number>();
  for (const e of entriesByStatus(entries, "handed")) {
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.reward);
  }
  const out: { date: string; total: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const k = dateKey(d);
    out.push({ date: k, total: byDate.get(k) ?? 0 });
  }
  return out;
}

// ---- バックアップ（#19）：State 丸ごとの書き出し・読み込み --------

/** State を人が読める JSON テキストに。書き出しファイルの中身。 */
export function backupText(state: State): string {
  return JSON.stringify(state, null, 2);
}

/** バックアップの推奨ファイル名。子どもの記録なので `.ohajiki.json` に寄せる
 *  （.gitignore 済み＝うっかりコミットを防ぐ）。 */
export function backupFilename(now: Date): string {
  return `ohajiki-backup-${dateKey(now)}.ohajiki.json`;
}

/** バックアップ JSON テキストを State に復元する。
 *  パース不能・オブジェクトでない場合は null（＝復元しない）。
 *  中身の欠損・型崩れは normalizeState が補完する。 */
export function parseBackup(text: string): State | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  return normalizeState(raw);
}

// ---- ルール CRUD（新しい配列を返す：破壊的変更しない） -----------

export function addRule(rules: Rule[], id: string): Rule[] {
  return [...rules, { id, emoji: "⭐", name: "あたらしい", reward: 1, kind: "fixed" }];
}

export function deleteRule(rules: Rule[], id: string): Rule[] {
  return rules.filter((r) => r.id !== id);
}

/** ルールを1つ上（dir=-1）／下（dir=1）へ動かす。端なら変化なし。
 *  子ども画面のリストは state.rules の並び順そのまま。 */
export function moveRule(rules: Rule[], id: string, dir: -1 | 1): Rule[] {
  const i = rules.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= rules.length) return rules;
  const next = [...rules];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function updateRule(rules: Rule[], id: string, patch: Partial<Omit<Rule, "id">>): Rule[] {
  return rules.map((r) => {
    if (r.id !== id) return r;
    const next = { ...r, ...patch };
    if (patch.reward !== undefined) next.reward = clampReward(patch.reward);
    if (patch.kind !== undefined) next.kind = normalizeKind(patch.kind);
    return next;
  });
}

// ---- 記録の生成 -------------------------------------------------

/** ルールから記録1件を作る。承認は無いので初期ステータスは approved（#48）。
 *  id と日時は呼び出し側から注入（テスト容易性）。
 *  timed ルールは units（タップ数）を渡す。fixed では units は無視。 */
export function makeEntry(rule: Rule, now: Date, id: string, units?: number): Entry {
  const common = {
    id,
    ruleId: rule.id,
    emoji: rule.emoji,
    name: rule.name,
    date: dateKey(now),
    time: timeLabel(now),
    status: "approved" as const,
  };
  if (rule.kind === "timed") {
    const u = clampUnits(units ?? 1);
    return { ...common, units: u, reward: rewardForUnits(rule, u) };
  }
  return { ...common, reward: clampReward(rule.reward) };
}
