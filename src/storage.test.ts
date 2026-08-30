import { beforeEach, describe, expect, it } from "vitest";
import { loadState, saveState } from "./storage.ts";
import { makeDefaultState } from "./logic.ts";

// Node 25 / jsdom いずれの localStorage も挙動が安定しないため、
// テストでは Map ベースの最小実装に差し替える。
class MemoryStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  clear(): void {
    this.m.clear();
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  key(i: number): string | null {
    return Array.from(this.m.keys())[i] ?? null;
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
  });
});

describe("storage（localStorage seam）", () => {
  it("未保存なら既定状態を返す", async () => {
    expect(await loadState()).toEqual(makeDefaultState());
  });

  it("保存 → 読み込みでラウンドトリップする", async () => {
    const s = makeDefaultState();
    s.guardianLabel = "パパ";
    s.pin = "1234";
    await saveState(s);
    const loaded = await loadState();
    expect(loaded.guardianLabel).toBe("パパ");
    expect(loaded.pin).toBe("1234");
  });

  it("壊れた JSON なら既定状態にフォールバックする", async () => {
    localStorage.setItem("ohajiki-state", "{ not json");
    expect(await loadState()).toEqual(makeDefaultState());
  });

  it("読み込み時にスキーマを正規化する", async () => {
    localStorage.setItem("ohajiki-state", JSON.stringify({ pin: "9", rules: [] }));
    const loaded = await loadState();
    expect(loaded.pin).toBe("0009");
    expect(loaded.rules.length).toBeGreaterThan(0);
  });
});
