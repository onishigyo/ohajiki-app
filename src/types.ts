/** 記録1件の状態。承認工程は廃止（子のタップで即確定・#48）。
 *  - `approved` … 記録済み。まだ物理のおはじきは渡してない（＝子カードに乗る「未受領」）
 *  - `handed`   … 親がその日ぶんを締めて おはじきを渡した。以後は履歴（#16）
 *  - `rejected` … 旧データの却下ぶん（互換のため残置。集計には入れない）
 *  「その日やった作業への報酬は次の日のもの」＝ approved は日付ごとにまとめて締める（#20）。 */
export type EntryStatus = "approved" | "handed" | "rejected";

/** ルールの種別。
 *  - `fixed` … 1タップで固定枚数（はみがき・おてつだい など）
 *  - `timed` … 15分（1単位）ごとにタップし、単位数 × 枚数を稼ぐ（どくしょ・べんきょう など）。#2 */
export type RuleKind = "fixed" | "timed";

/** 稼ぐルール（がんばりメニュー1件）。親が設定画面で編集・追加・削除できる。 */
export interface Rule {
  id: string;
  emoji: string;
  name: string;
  /** fixed: 1タップの枚数 / timed: 15分（1単位）あたりの枚数（0以上の整数）。 */
  reward: number;
  kind: RuleKind;
}

/** 申請1件。ルールのスナップショット（emoji/name/reward）を持つので、
 *  後からルールを編集しても過去の記録は変わらない。 */
export interface Entry {
  id: string;
  ruleId: string;
  emoji: string;
  name: string;
  /** 確定した付与枚数（timed は units × ルールの枚数を申請時に確定）。 */
  reward: number;
  /** timed のときのみ: タップ数（＝15分単位の数）。fixed では持たない。 */
  units?: number;
  /** "YYYY-MM-DD"（ローカル日付）。 */
  date: string;
  /** "HH:MM"（ローカル時刻）。 */
  time: string;
  status: EntryStatus;
}

/** うさぎのグリーティング（#51）の「表情が変わる境界」。親が設定画面で調整する。
 *  - `sadMax` 以下 … さみしい
 *  - `sadMax` 超〜`okMax` 以下 … ふつう
 *  - `okMax` 超 … うれしい
 *  常に 0 ≤ sadMax < okMax。 */
export interface MascotConfig {
  sadMax: number;
  okMax: number;
}

/** アプリ全体の永続状態。storage 層が丸ごと読み書きする。 */
export interface State {
  rules: Rule[];
  entries: Entry[];
  /** 親エリアの4桁 PIN。 */
  pin: string;
  /** 子どもが申請する相手の呼び方（初期値「おうちの人」）。決め打ちしない。 */
  guardianLabel: string;
  /** うさぎの表情が変わる境界（#51）。 */
  mascot: MascotConfig;
}
