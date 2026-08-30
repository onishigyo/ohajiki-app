// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// index.html の <body> 内マークアップだけ取り出してテスト DOM に流し込む。
const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const body = html.replace(/[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*/, "");

class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  key(i: number) {
    return Array.from(this.m.keys())[i] ?? null;
  }
}

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
  });
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, "");
});

describe("main.ts の初期化（スモーク）", () => {
  it("例外なく初期描画され、既定ルール分のボタンが並ぶ", async () => {
    await import("./main.ts");
    await Promise.resolve();

    expect(document.getElementById("todayNum")?.textContent).toBe("0");
    const buttons = document.querySelectorAll("#actionsGrid .action-btn");
    expect(buttons.length).toBe(4);
    expect(document.querySelectorAll("#keypad .key").length).toBe(12);
  });

  it("歯車ボタンで PIN シートが開く", async () => {
    await import("./main.ts");
    await Promise.resolve();

    document.getElementById("gearBtn")?.dispatchEvent(new Event("click"));
    expect(document.getElementById("pinOverlay")?.classList.contains("show")).toBe(true);
  });

  it("timed ルール（どくしょ）で時間シートが開き、＋15ふんで枚数が増え、その場で確定＋演出（#48）", async () => {
    await import("./main.ts");
    await new Promise((r) => setTimeout(r, 0));

    const click = (elm: Element | null | undefined) =>
      elm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const doku = [...document.querySelectorAll("#actionsGrid .action-btn")].find((b) =>
      b.textContent?.includes("どくしょ"),
    );
    click(doku);
    expect(document.getElementById("timedOverlay")?.classList.contains("show")).toBe(true);
    // submit は 0 単位では押せない
    expect((document.getElementById("timedSubmit") as HTMLButtonElement).disabled).toBe(true);

    click(document.getElementById("tPlus"));
    click(document.getElementById("tPlus"));
    click(document.getElementById("tPlus")); // 45ふん = 3タップ
    expect(document.getElementById("tMinutes")?.textContent).toBe("45");
    expect(document.getElementById("tReward")?.textContent).toBe("6"); // 3 × 2こ

    click(document.getElementById("timedSubmit"));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.getElementById("timedOverlay")?.classList.contains("show")).toBe(false);
    // 承認を経由せず即確定：カードの数字が 6、演出が出る
    expect(document.getElementById("todayNum")?.textContent).toBe("6");
    expect((document.getElementById("celebrate") as HTMLElement).hidden).toBe(false);
    expect(document.getElementById("celebratePlus")?.textContent).toBe("＋6こ");
    const raw = JSON.parse(localStorage.getItem("ohajiki-state")!);
    expect(raw.entries).toHaveLength(1);
    expect(raw.entries[0]).toMatchObject({ status: "approved", units: 3, reward: 6 });
  });

  it("オーバーレイは外側タップで閉じ、シート本体タップでは閉じない（#8）", async () => {
    await import("./main.ts");
    await new Promise((r) => setTimeout(r, 0));
    const click = (elm: Element | null | undefined) =>
      elm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // 確認シート
    const hami = [...document.querySelectorAll("#actionsGrid .action-btn")].find((b) =>
      b.textContent?.includes("はみがき"),
    );
    click(hami);
    const confirmOv = document.getElementById("confirmOverlay")!;
    expect(confirmOv.classList.contains("show")).toBe(true);
    click(confirmOv.querySelector(".sheet")); // 本体 → 閉じない
    expect(confirmOv.classList.contains("show")).toBe(true);
    click(confirmOv); // 外側 → 閉じる
    expect(confirmOv.classList.contains("show")).toBe(false);

    // PIN シート：子どもが歯車を誤タップしても外タップで戻れる
    click(document.getElementById("gearBtn"));
    const pinOv = document.getElementById("pinOverlay")!;
    expect(pinOv.classList.contains("show")).toBe(true);
    click(pinOv.querySelector(".sheet")); // キーパッド周辺 → 閉じない
    expect(pinOv.classList.contains("show")).toBe(true);
    click(pinOv); // 外側 → 閉じる
    expect(pinOv.classList.contains("show")).toBe(false);
  });

  it("親フロー：今日の集計で記録を1つ消す → 残りを渡した（#20 / #48）", async () => {
    const dk = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    localStorage.setItem(
      "ohajiki-state",
      JSON.stringify({
        entries: [
          {
            id: "a",
            ruleId: "r1",
            emoji: "📚",
            name: "どくしょ",
            reward: 2,
            date: dk,
            time: "10:00",
            status: "approved",
          },
          {
            id: "b",
            ruleId: "r2",
            emoji: "🧹",
            name: "そうじ",
            reward: 1,
            date: dk,
            time: "11:00",
            status: "approved",
          },
        ],
        pin: "0000",
      }),
    );
    await import("./main.ts");
    await new Promise((r) => setTimeout(r, 0));
    const click = (elm: Element | null | undefined) =>
      elm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // PIN 解錠 → 今日の集計タブが初期表示
    click(document.getElementById("gearBtn"));
    for (const d of "0000") {
      click([...document.querySelectorAll("#keypad .key")].find((k) => k.textContent === d));
    }
    await new Promise((r) => setTimeout(r, 200));
    expect(document.getElementById("parentOverlay")?.classList.contains("show")).toBe(true);
    // 承認タブは無い
    expect(
      [...document.querySelectorAll(".ptab")].some((t) => t.textContent?.includes("承認")),
    ).toBe(false);

    // 記録 a を 🗑 → 確認「けす」
    click(document.querySelector('[data-remove="a"]'));
    click(
      [...document.querySelectorAll("#askOverlay button")].find((b) => b.textContent === "けす"),
    );
    await new Promise((r) => setTimeout(r, 0));

    // 残りを渡した → 確認「渡した」
    click(document.querySelector("[data-settle]"));
    click(
      [...document.querySelectorAll("#askOverlay button")].find((b) => b.textContent === "渡した"),
    );
    await new Promise((r) => setTimeout(r, 0));

    const raw = JSON.parse(localStorage.getItem("ohajiki-state")!);
    expect(raw.entries.map((e: { id: string; status: string }) => [e.id, e.status])).toEqual([
      ["b", "handed"],
    ]);
  });

  it("おはじきの粒は今日の枚数と同数（数字と一致）", async () => {
    const dk = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    const entries = Array.from({ length: 13 }, (_, i) => ({
      id: `e${i}`,
      ruleId: "r1",
      emoji: "📚",
      name: "どくしょ",
      reward: 1,
      date: dk,
      time: "10:00",
      status: "approved",
    }));
    localStorage.setItem(
      "ohajiki-state",
      JSON.stringify({ entries, pin: "0000", guardianLabel: "おうちの人" }),
    );

    await import("./main.ts");
    await new Promise((r) => setTimeout(r, 0));

    expect(document.getElementById("todayNum")?.textContent).toBe("13");
    expect(document.querySelectorAll("#beadsRow .bead").length).toBe(13);
    // 今日ぶんが承認済み・かくにんまち無し → 受け取り待ちの状態を出す（累計は出さない）
    expect(document.getElementById("todaySub")?.textContent).toBe("うけとりまち 13こ");
  });

  it("残高カードの下行は常に今日の状態を出す（累計は「これまで」タブ側）", async () => {
    localStorage.setItem(
      "ohajiki-state",
      JSON.stringify({
        entries: [
          {
            id: "h1",
            ruleId: "r1",
            emoji: "📚",
            name: "ほん",
            reward: 5,
            date: "2026-08-20",
            time: "20:00",
            status: "handed",
          },
        ],
        pin: "0000",
        guardianLabel: "パパ",
      }),
    );
    await import("./main.ts");
    await new Promise((r) => setTimeout(r, 0));

    const sub = document.getElementById("todaySub") as HTMLElement;
    expect(sub.hidden).toBe(false);
    // 今日は承認済みも かくにんまちも無い → 「きょうは まだ ないよ」（累計は出さない）
    expect(sub.textContent).toBe("きょうは まだ ないよ");
  });

  it("設定で並び替えると子どものリストにも反映される", async () => {
    localStorage.setItem(
      "ohajiki-state",
      JSON.stringify({
        rules: [
          { id: "r1", emoji: "📚", name: "ほんA", reward: 1, kind: "fixed" },
          { id: "r2", emoji: "🧹", name: "そうじB", reward: 1, kind: "fixed" },
        ],
        entries: [],
        pin: "0000",
        guardianLabel: "おうちの人",
      }),
    );
    await import("./main.ts");
    await new Promise((r) => setTimeout(r, 0));
    const click = (elm: Element | null | undefined) =>
      elm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const firstNameBefore = document.querySelector(
      "#actionsGrid .action-btn .action-name",
    )?.textContent;
    expect(firstNameBefore).toBe("ほんA");

    // 親: PIN → 設定 → r1 を下へ
    click(document.getElementById("gearBtn"));
    for (const d of "0000") {
      click([...document.querySelectorAll("#keypad .key")].find((k) => k.textContent === d));
    }
    await new Promise((r) => setTimeout(r, 200));
    click([...document.querySelectorAll(".ptab")].find((t) => t.textContent?.includes("設定")));
    click(document.querySelector('[data-move-down="r1"]'));
    await new Promise((r) => setTimeout(r, 0));

    // 親を閉じる → 子リストが再描画
    click(document.getElementById("parentClose"));
    const firstNameAfter = document.querySelector(
      "#actionsGrid .action-btn .action-name",
    )?.textContent;
    expect(firstNameAfter).toBe("そうじB");
    expect(
      JSON.parse(localStorage.getItem("ohajiki-state")!).rules.map((r: { id: string }) => r.id),
    ).toEqual(["r2", "r1"]);
  });

  it("「これまで」タブで もらった おはじきの日グラフが見える（#16）", async () => {
    const daysAgo = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    localStorage.setItem(
      "ohajiki-state",
      JSON.stringify({
        entries: [
          {
            id: "h1",
            ruleId: "r1",
            emoji: "📚",
            name: "どくしょ",
            reward: 6,
            units: 3,
            date: daysAgo(2),
            time: "20:00",
            status: "handed",
          },
          {
            id: "h2",
            ruleId: "r3",
            emoji: "🦷",
            name: "はみがき",
            reward: 1,
            date: daysAgo(5),
            time: "08:00",
            status: "handed",
          },
          {
            id: "old",
            ruleId: "r3",
            emoji: "🦷",
            name: "はみがき",
            reward: 8,
            date: daysAgo(30),
            time: "08:00",
            status: "handed",
          },
          {
            id: "a",
            ruleId: "r2",
            emoji: "🧹",
            name: "そうじ",
            reward: 2,
            date: daysAgo(0),
            time: "10:00",
            status: "approved",
          },
        ],
        pin: "0000",
      }),
    );
    await import("./main.ts");
    await new Promise((r) => setTimeout(r, 0));
    const click = (elm: Element | null | undefined) =>
      elm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    click([...document.querySelectorAll(".child-tab")].find((b) => b.textContent === "これまで"));
    expect((document.getElementById("childHistory") as HTMLElement).hidden).toBe(false);
    expect((document.getElementById("childToday") as HTMLElement).hidden).toBe(true);
    // 累計は handed 全部（6 + 1 + 8）
    expect(document.getElementById("childHistoryTotal")?.textContent).toBe("15");
    const bars = [...document.querySelectorAll("#childHistoryChart .chart-bar")];
    expect(bars.length).toBe(10); // 直近10日（空日も0）
    // グラフ上の合計 = 直近10日の handed（30日前は窓の外）
    const sum = bars.reduce((s, b) => s + Number(b.querySelector(".chart-v")?.textContent), 0);
    expect(sum).toBe(7);
    expect(bars.at(-1)?.querySelector(".chart-d")?.textContent).toBe("今日");

    click([...document.querySelectorAll(".child-tab")].find((b) => b.textContent === "今日"));
    expect((document.getElementById("childToday") as HTMLElement).hidden).toBe(false);
  });

  it("バックアップ：保存で日付入りダウンロード、復元で置き換え（#19）", async () => {
    localStorage.setItem(
      "ohajiki-state",
      JSON.stringify({
        rules: [{ id: "r1", emoji: "📚", name: "ほんA", reward: 1, kind: "fixed" }],
        entries: [],
        pin: "0000",
        guardianLabel: "おうちの人",
      }),
    );
    Object.defineProperty(URL, "createObjectURL", { value: () => "blob:fake", configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: () => {}, configurable: true });
    const downloads: string[] = [];
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });

    await import("./main.ts");
    await new Promise((r) => setTimeout(r, 0));
    const click = (elm: Element | null | undefined) =>
      elm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    click(document.getElementById("gearBtn"));
    for (const d of "0000") {
      click([...document.querySelectorAll("#keypad .key")].find((k) => k.textContent === d));
    }
    await new Promise((r) => setTimeout(r, 200));
    click([...document.querySelectorAll(".ptab")].find((t) => t.textContent?.includes("設定")));

    click(document.querySelector("[data-backup-save]"));
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatch(/^ohajiki-backup-\d{4}-\d{2}-\d{2}\.ohajiki\.json$/);

    const backup = JSON.stringify({
      rules: [{ id: "z1", emoji: "🎨", name: "おえかき", reward: 5, kind: "fixed" }],
      entries: [],
      pin: "9999",
      guardianLabel: "パパ",
    });
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      if (this.type !== "file") return;
      Object.defineProperty(this, "files", {
        value: [{ text: () => Promise.resolve(backup) }],
        configurable: true,
      });
      this.dispatchEvent(new Event("change"));
    });
    click(document.querySelector("[data-backup-restore]"));
    await new Promise((r) => setTimeout(r, 0));
    click(
      [...document.querySelectorAll("#askOverlay button")].find((b) => b.textContent === "復元"),
    );
    await new Promise((r) => setTimeout(r, 0));

    const saved = JSON.parse(localStorage.getItem("ohajiki-state")!);
    expect(saved.guardianLabel).toBe("パパ");
    expect(saved.pin).toBe("9999");
    expect(document.querySelector("#actionsGrid .action-btn .action-name")?.textContent).toBe(
      "おえかき",
    );

    anchorClick.mockRestore();
  });

  it("子がメニューをタップするとその場で「＋◯こ」演出が出る（#14 / #48）", async () => {
    await import("./main.ts");
    await new Promise((r) => setTimeout(r, 0));
    const click = (elm: Element | null | undefined) =>
      elm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // 初期表示では演出は出ない
    expect((document.getElementById("celebrate") as HTMLElement).hidden).toBe(true);

    // はみがき（fixed, 1こ）→ 確認シート「できた！」
    click(
      [...document.querySelectorAll("#actionsGrid .action-btn")].find((b) =>
        b.textContent?.includes("はみがき"),
      ),
    );
    expect(document.getElementById("confirmOverlay")?.classList.contains("show")).toBe(true);
    click(document.getElementById("confirmSubmit"));
    await new Promise((r) => setTimeout(r, 0));

    const celebrate = document.getElementById("celebrate") as HTMLElement;
    expect(celebrate.hidden).toBe(false);
    expect(celebrate.classList.contains("show")).toBe(true);
    expect(document.getElementById("celebratePlus")?.textContent).toBe("＋1こ");
    expect(document.getElementById("todayNum")?.textContent).toBe("1");

    // タップで閉じる
    click(celebrate);
    expect(celebrate.classList.contains("show")).toBe(false);

    // 記録は approved で確定している（承認待ちではない）
    const raw = JSON.parse(localStorage.getItem("ohajiki-state")!);
    expect(raw.entries).toHaveLength(1);
    expect(raw.entries[0].status).toBe("approved");
  });

  it("翌日はじめての起動でうさぎが昨日の数を言う → タップで消える（#51）", async () => {
    const yKey = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    const tKey = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    localStorage.setItem(
      "ohajiki-state",
      JSON.stringify({
        entries: [
          {
            id: "y1",
            ruleId: "r1",
            emoji: "📚",
            name: "ほん",
            reward: 5,
            date: yKey,
            time: "20:00",
            status: "handed",
          },
          {
            id: "y2",
            ruleId: "r3",
            emoji: "🦷",
            name: "はみがき",
            reward: 2,
            date: yKey,
            time: "08:00",
            status: "approved",
          },
        ],
        pin: "0000",
      }),
    );
    await import("./main.ts");
    await new Promise((r) => setTimeout(r, 0));
    const click = (elm: Element | null | undefined) =>
      elm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const g = document.getElementById("greeting") as HTMLElement;
    expect(g.hidden).toBe(false);
    expect(g.classList.contains("show")).toBe(true);
    // 昨日 = 5 + 2 = 7 → ふつう
    expect(document.getElementById("greetingLine")?.textContent).toBe("きのうは 7こ です。");
    expect((document.getElementById("greetingImg") as HTMLImageElement).getAttribute("src")).toBe(
      "mascot-ok.png",
    );

    // 画面タップで消える → その日はもう出さない
    click(g);
    expect(g.classList.contains("show")).toBe(false);
    expect(localStorage.getItem("ohajiki-greeted")).toBe(tKey);
  });

  it("設定の境界を反映してグリーティングの表情が変わる（#51）", async () => {
    const yKey = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    localStorage.setItem(
      "ohajiki-state",
      JSON.stringify({
        entries: [
          {
            id: "y1",
            ruleId: "r1",
            emoji: "📚",
            name: "ほん",
            reward: 7,
            date: yKey,
            time: "20:00",
            status: "handed",
          },
        ],
        pin: "0000",
        mascot: { sadMax: 1, okMax: 2 },
      }),
    );
    await import("./main.ts");
    await new Promise((r) => setTimeout(r, 0));
    // 既定なら 7 は「ふつう」だが、境界 1/2 では「うれしい」
    expect(document.getElementById("greetingLine")?.textContent).toBe(
      "きのうは 7こ！ うれしい！！！",
    );
    expect((document.getElementById("greetingImg") as HTMLImageElement).getAttribute("src")).toBe(
      "mascot-happy.png",
    );
  });

  it("今日すでにグリーティング済みなら出さない（#51）", async () => {
    const tKey = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    localStorage.setItem("ohajiki-greeted", tKey);
    await import("./main.ts");
    await new Promise((r) => setTimeout(r, 0));
    expect((document.getElementById("greeting") as HTMLElement).hidden).toBe(true);
  });

  it("昨日データが無ければ「きのうは 0こ… さみしいです。」（#51）", async () => {
    await import("./main.ts");
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById("greetingLine")?.textContent).toBe(
      "きのうは 0こ… さみしいです。",
    );
    expect((document.getElementById("greetingImg") as HTMLImageElement).getAttribute("src")).toBe(
      "mascot-sad.png",
    );
  });
});

describe("拡大の抑止（#37）", () => {
  const css = readFileSync(resolve(process.cwd(), "src/style.css"), "utf8");

  it("ダブルタップ拡大を切っている（body に touch-action: manipulation）", () => {
    expect(css).toMatch(/body\s*\{[^}]*touch-action:\s*manipulation/s);
  });

  it("viewport から無視される user-scalable=no を外している", () => {
    const viewport = html.match(/<meta name="viewport"[^>]*content="([^"]*)"/)?.[1] ?? "";
    expect(viewport).toContain("width=device-width");
    expect(viewport).not.toContain("user-scalable");
  });
});

describe("PWA（#18）", () => {
  it("index.html が manifest と apple-touch-icon を参照している", () => {
    expect(html).toMatch(/<link rel="manifest" href="[^"]*manifest\.webmanifest"/);
    expect(html).toMatch(/<link rel="apple-touch-icon" href="[^"]*apple-touch-icon\.png"/);
    expect(html).toMatch(/<meta name="theme-color"/);
  });

  it("manifest は妥当な JSON で必須フィールドを持つ", () => {
    const m = JSON.parse(
      readFileSync(resolve(process.cwd(), "public/manifest.webmanifest"), "utf8"),
    );
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.icons.some((i: { sizes: string }) => i.sizes === "512x512")).toBe(true);
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  });

  it("参照しているアイコンファイルが存在する", () => {
    for (const f of ["icon-192.png", "icon-512.png", "apple-touch-icon.png"]) {
      expect(existsSync(resolve(process.cwd(), "public", f))).toBe(true);
    }
  });
});
