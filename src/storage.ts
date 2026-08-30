// ===================================================================
// 永続化の seam（唯一の関門）。
//
// 現状: localStorage の1台完結。window.storage（Claude 専用 API）は撤去済み。
// 将来: 複数端末対応が必要になったら、この2関数の中身だけを
//       Supabase / Firebase 等に差し替える（HANDOFF.md 参照）。
//       呼び出し側（main.ts）はこのインターフェースにのみ依存する。
// ===================================================================
import { normalizeState } from "./logic.ts";
import type { State } from "./types.ts";

const STORAGE_KEY = "ohajiki-state";

export async function loadState(): Promise<State> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return normalizeState(null);
    return normalizeState(JSON.parse(raw));
  } catch (e) {
    console.error("状態の読み込みに失敗。初期状態で続行します。", e);
    return normalizeState(null);
  }
}

export async function saveState(state: State): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("状態の保存に失敗しました。", e);
  }
}
