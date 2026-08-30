// ===================================================================
// DOM 層。描画とイベント配線のみ。集計・判定は logic.ts に委譲する。
// ===================================================================
import "./style.css";
import {
  BEAD_COLORS,
  DEFAULT_GUARDIAN_LABEL,
  DEFAULT_MASCOT,
  MASCOT_MAX_THRESHOLD,
  PIN_LENGTH,
  UNITS_MAX,
  addRule,
  approvedTotalForDate,
  backupFilename,
  backupText,
  carryOverTotal,
  checkPin,
  clampReward,
  dateKey,
  deleteRule,
  earnedTotalForDate,
  entriesByStatus,
  entriesForDate,
  handedDailyTotals,
  handedTotal,
  makeEntry,
  mascotLine,
  minutesForUnits,
  moveRule,
  normalizeMascot,
  normalizePin,
  parseBackup,
  removeEntry,
  settleDate,
  totalReward,
  unsettledDates,
  updateRule,
} from "./logic.ts";
import { loadState, saveState } from "./storage.ts";
import type { Entry, Rule, State } from "./types.ts";

const CHILD_POLL_MS = 8000;
const PARENT_POLL_MS = 4000;
/** マスコットのグリーティングを最後に出した日付（この端末ローカル・#51）。 */
const GREETED_KEY = "ohajiki-greeted";
// がんばること用の絵文字パレット（親が設定で選ぶ）。20個＝iPad 幅で 2 行 10 個ずつ。
// 学習・身支度・手伝い・運動・生活習慣・画面のルールなど、家庭でよくある項目を広くカバー。
const EMOJI_CHOICES = [
  "📚", // 読書
  "📖", // 宿題
  "✏️", // 学習（プリント・ドリル）
  "📝", // 学習（書き取り）
  "🎒", // 持ち物の準備
  "🌍", // 英語・語学
  "🎹", // 習い事
  "🎨", // おえかき・工作
  "🧹", // お手伝い
  "🧺", // お片付け
  "🦷", // はみがき
  "🚿", // おふろ
  "🍚", // ごはん
  "🤸", // 体を動かす
  "🏃", // 外遊び・運動
  "🌙", // 早寝
  "⏰", // 時間を守る
  "🛏️", // ひとりで寝る
  "📵", // 画面のルールを守る
  "⭐", // 汎用（あたらしいルールの初期値）
];

let state: State = {
  rules: [],
  entries: [],
  pin: "0".repeat(PIN_LENGTH),
  guardianLabel: DEFAULT_GUARDIAN_LABEL,
  mascot: { ...DEFAULT_MASCOT },
};

// ---- DOM ヘルパ --------------------------------------------------

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} が見つかりません`);
  return node as T;
}

/** innerHTML に差し込むユーザー文字列のエスケープ。 */
function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function todayKey(): string {
  return dateKey(new Date());
}

/** timed 申請の「◯回ぶん（◯分）」表示。fixed 申請なら空文字。 */
function unitsLabel(units?: number): string {
  return units ? `${units}回ぶん（${minutesForUnits(units)}分）` : "";
}

/** 日付キーを「今日 / きのう / M/D」に。 */
function dayLabel(key: string): string {
  const tk = todayKey();
  if (key === tk) return "今日";
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (key === dateKey(y)) return "昨日";
  const [, m, d] = key.split("-");
  return `${Number(m)}/${Number(d)}`;
}

async function persist(): Promise<void> {
  await saveState(state);
}

// ---- 子ども画面 ------------------------------------------------

function renderChild(): void {
  const tk = todayKey();
  const total = approvedTotalForDate(state.entries, tk); // 今日タップしたぶん（未受領）
  const carry = carryOverTotal(state.entries, tk); // 締め忘れた前日以前ぶん（#20）

  el("todayNum").textContent = String(total);
  // 下の行は常に「今日の状態」を1行で出す（声かけ・褒め言葉・累計は出さない）。
  //   繰り越しあり → その内訳
  //   今日ぶんがある（おはじき受け取り前）→ うけとりまち ◯こ
  //   何も無い → きょうは まだ ないよ
  const sub = el("todaySub");
  sub.textContent =
    carry > 0
      ? `前の 分 ${carry}こ も まだ`
      : total > 0
        ? `うけとりまち ${total}こ`
        : "きょうは まだ ないよ";
  sub.hidden = false;

  // 粒：今日ぶんと同数。上限は暴走ガード。
  const beadsRow = el("beadsRow");
  beadsRow.innerHTML = "";
  const beads = Math.min(total, 60);
  for (let i = 0; i < beads; i++) {
    const b = document.createElement("span");
    b.className = "bead";
    b.style.setProperty("--c", BEAD_COLORS[i % BEAD_COLORS.length]);
    beadsRow.appendChild(b);
  }
  // 粒が数字より縦に長くなるぶんだけカードを伸ばす（少数のときは伸びない）。
  const beadRows = Math.ceil(beads / 10);
  const card = document.querySelector<HTMLElement>(".today-card");
  if (card) card.style.minHeight = `${38 + beadRows * 18 + 16}px`;

  const grid = el("actionsGrid");
  grid.innerHTML = "";
  for (const rule of state.rules) {
    const btn = document.createElement("button");
    btn.className = "action-btn";
    btn.dataset.ruleId = rule.id;
    const rewardLabel =
      rule.kind === "timed" ? `⏱️ 15分で ${rule.reward}こ` : `${rule.reward}こ もらえる`;
    btn.innerHTML = `
      <span class="action-emoji">${esc(rule.emoji)}</span>
      <span class="action-name">${esc(rule.name)}</span>
      <span class="action-reward">${rewardLabel}</span>`;
    grid.appendChild(btn);
  }

  renderChildHistory(); // 「これまで」タブの中身も最新に
}

// ---- タップで「＋◯こ」演出（#14 / #48）-------------------

let celebrating = false;
let celebrateTimer: ReturnType<typeof setTimeout> | undefined;

/** 子がメニューをタップした直後に「＋◯こ」を出す。数秒で自動、タップでも消える。 */
function playCelebration(total: number, items: Entry[]): void {
  celebrating = true;
  el("celebratePlus").textContent = `＋${total}こ`;
  const names = [...new Set(items.map((e) => `${e.emoji}${e.name}`))].slice(0, 3);
  el("celebrateItems").textContent = names.join("  ");

  const burst = el("celebrateBurst");
  burst.innerHTML = "";
  const beadCount = Math.min(Math.max(total, 6), 14);
  for (let i = 0; i < beadCount; i++) {
    const b = document.createElement("span");
    b.className = "celebrate-bead";
    b.style.setProperty("--c", BEAD_COLORS[i % BEAD_COLORS.length]);
    b.style.setProperty("--i", String(i));
    b.style.left = `${8 + (84 * i) / Math.max(beadCount - 1, 1)}%`;
    burst.appendChild(b);
  }

  const c = el("celebrate");
  c.hidden = false;
  void c.offsetWidth; // reflow してからクラス付与＝アニメ開始
  c.classList.add("show");
  clearTimeout(celebrateTimer);
  celebrateTimer = setTimeout(dismissCelebration, 3500);
}

function dismissCelebration(): void {
  clearTimeout(celebrateTimer);
  const c = el("celebrate");
  c.classList.remove("show");
  celebrating = false;
  setTimeout(() => {
    if (!celebrating) c.hidden = true;
  }, 250);
}

// ---- デイリー・グリーティング（#51）--------------------------

/** 翌日はじめて開いたら、うさぎが昨日のことを言う全画面。タップで通常画面へ。
 *  1日1回（`GREETED_KEY` に今日の日付を書いて抑制）。起動時と、前面復帰時に呼ぶ。 */
function maybeGreet(): void {
  const today = todayKey();
  let last: string | null = null;
  try {
    last = localStorage.getItem(GREETED_KEY);
  } catch {
    /* 読めなくても続行 */
  }
  if (last === today) return;

  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yKey = dateKey(y);
  const yCount =
    entriesForDate(state.entries, yKey).length === 0
      ? null
      : earnedTotalForDate(state.entries, yKey);
  const { mood, text } = mascotLine(yCount, state.mascot);

  el<HTMLImageElement>("greetingImg").src = `mascot-${mood}.png`;
  el("greetingLine").textContent = text;
  const g = el("greeting");
  g.hidden = false;
  void g.offsetWidth; // reflow → クラスでアニメ開始
  g.classList.add("show");
}

function dismissGreeting(): void {
  const g = el("greeting");
  if (!g.classList.contains("show")) return;
  g.classList.remove("show");
  try {
    localStorage.setItem(GREETED_KEY, todayKey());
  } catch {
    /* 書けなくても続行（次回また出るだけ） */
  }
  setTimeout(() => {
    if (!g.classList.contains("show")) g.hidden = true;
  }, 250);
}

/** ルールをタップしたときの入口。種別でシートを振り分ける。 */
function openRule(rule: Rule): void {
  if (rule.kind === "timed") openTimed(rule);
  else openConfirm(rule);
}

async function submitEntry(rule: Rule, units?: number): Promise<void> {
  const now = new Date();
  const entry = makeEntry(rule, now, `e${now.getTime()}`, units);
  state.entries.push(entry);
  await persist();
  renderChild();
  playCelebration(entry.reward, [entry]);
}

// ---- 確認シート（fixed）--------------------------------------

let pendingRule: Rule | null = null;

function openConfirm(rule: Rule): void {
  pendingRule = rule;
  el("cEmoji").textContent = rule.emoji;
  el("cName").textContent = rule.name;
  el("cReward").textContent = String(rule.reward);
  el("confirmOverlay").classList.add("show");
}

function closeConfirm(): void {
  el("confirmOverlay").classList.remove("show");
  pendingRule = null;
}

async function submitAction(): Promise<void> {
  if (!pendingRule) return;
  const rule = pendingRule;
  closeConfirm();
  await submitEntry(rule);
}

// ---- 時間シート（timed）------------------------------------

let timedRule: Rule | null = null;
let timedUnits = 0;

function openTimed(rule: Rule): void {
  timedRule = rule;
  timedUnits = 0;
  el("tEmoji").textContent = rule.emoji;
  el("tName").textContent = rule.name;
  el("tHint").textContent = `15分 できたら ＋15分 を 押してね`;
  renderTimed();
  el("timedOverlay").classList.add("show");
}

function renderTimed(): void {
  if (!timedRule) return;
  el("tTaps").textContent = String(timedUnits);
  el("tMinutes").textContent = String(minutesForUnits(timedUnits));
  el("tReward").textContent = String(timedUnits * timedRule.reward);
  (el("timedSubmit") as HTMLButtonElement).disabled = timedUnits < 1;
  (el("tMinus") as HTMLButtonElement).disabled = timedUnits < 1;
  (el("tPlus") as HTMLButtonElement).disabled = timedUnits >= UNITS_MAX;
}

function timedAdjust(delta: number): void {
  timedUnits = Math.max(0, Math.min(UNITS_MAX, timedUnits + delta));
  renderTimed();
}

function closeTimed(): void {
  el("timedOverlay").classList.remove("show");
  timedRule = null;
  timedUnits = 0;
}

async function submitTimed(): Promise<void> {
  if (!timedRule || timedUnits < 1) return;
  const rule = timedRule;
  const units = timedUnits;
  closeTimed();
  await submitEntry(rule, units);
}

// ---- 親:PIN -------------------------------------------------

let pinInput = "";

function openPin(): void {
  pinInput = "";
  updatePinDots();
  el("pinOverlay").classList.add("show");
}

function closePin(): void {
  el("pinOverlay").classList.remove("show");
  pinInput = "";
}

function updatePinDots(): void {
  const dots = el("pinDots");
  dots.innerHTML = "";
  for (let i = 0; i < PIN_LENGTH; i++) {
    const d = document.createElement("div");
    d.className = "pin-dot" + (i < pinInput.length ? " filled" : "");
    dots.appendChild(d);
  }
}

function buildKeypad(): void {
  const kp = el("keypad");
  kp.innerHTML = "";
  for (const k of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"]) {
    const b = document.createElement("button");
    b.className = "key";
    if (k === "del") {
      b.classList.add("wide");
      b.textContent = "消す";
      b.addEventListener("click", pinDel);
    } else if (k === "ok") {
      b.classList.add("wide");
      b.textContent = "決定";
      b.addEventListener("click", pinCheck);
    } else {
      b.textContent = k;
      b.addEventListener("click", () => pinPush(k));
    }
    kp.appendChild(b);
  }
}

function pinPush(n: string): void {
  if (pinInput.length < PIN_LENGTH) {
    pinInput += n;
    updatePinDots();
    if (pinInput.length === PIN_LENGTH) setTimeout(pinCheck, 150);
  }
}

function pinDel(): void {
  pinInput = pinInput.slice(0, -1);
  updatePinDots();
}

function pinCheck(): void {
  if (checkPin(pinInput, state.pin)) {
    el("pinOverlay").classList.remove("show");
    openParent();
  } else {
    showToast("ばんごうが ちがいます");
    pinInput = "";
    updatePinDots();
  }
}

// ---- 親:管理 -----------------------------------------------

type ParentTab = "today" | "settings";

function openParent(): void {
  switchPtab("today");
  el("parentOverlay").classList.add("show");
  startPolling();
}

function closeParent(): void {
  el("parentOverlay").classList.remove("show");
  stopPolling();
  renderChild();
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function startPolling(): void {
  stopPolling();
  pollTimer = setInterval(async () => {
    const before = JSON.stringify(state.entries);
    state = await loadState();
    if (JSON.stringify(state.entries) !== before && activePtab() === "today") renderToday();
  }, PARENT_POLL_MS);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function activePtab(): ParentTab {
  const active = document.querySelector<HTMLElement>(".ptab.active");
  return (active?.dataset.ptab as ParentTab | undefined) ?? "today";
}

function switchPtab(tab: ParentTab): void {
  for (const t of document.querySelectorAll<HTMLElement>(".ptab")) {
    t.classList.toggle("active", t.dataset.ptab === tab);
  }
  for (const t of ["today", "settings"] as const) {
    el(`ptab-${t}`).style.display = t === tab ? "block" : "none";
  }
  if (tab === "today") renderToday();
  if (tab === "settings") renderSettings();
}

// 今日の集計タブ ＝ 未受領（approved）の記録がある日付ごとの「締めブロック」。
// 各記録は 🗑 で取り消せる（不正・打ち間違いの受け皿。承認工程は無い・#48）。
function renderToday(): void {
  const tk = todayKey();
  const dates = new Set(unsettledDates(state.entries));
  if (approvedTotalForDate(state.entries, tk) > 0) dates.add(tk);
  const sorted = [...dates].sort();

  let html = "";
  if (sorted.length === 0) {
    html += `<div class="empty"><span class="big">🫙</span>渡す 分は なし</div>`;
  }
  for (const date of sorted) {
    const items = entriesByStatus(entriesForDate(state.entries, date), "approved");
    const total = totalReward(items);
    const old = date !== tk;
    html += `<div class="settle-block${old ? " settle-block--old" : ""}">
      <div class="settle-head">
        <span>${dayLabel(date)}${old ? " の 分" : ""}</span>
        <span class="settle-total">${total}こ</span>
      </div>`;
    for (const e of items) {
      const meta = e.units ? unitsLabel(e.units) : esc(e.time);
      html += `<div class="log-item">
        <span class="log-emoji">${esc(e.emoji)}</span>
        <div class="log-info"><div class="log-name">${esc(e.name)}</div><div class="log-time">${meta}</div></div>
        <span class="log-reward">+${e.reward}こ</span>
        <button class="log-del" data-remove="${esc(e.id)}" aria-label="けす">🗑</button>
      </div>`;
    }
    if (items.length > 0) {
      html += `<button class="full-btn" data-settle="${esc(date)}">${dayLabel(date)}の 分を 渡した</button>`;
    }
    html += `</div>`;
  }
  el("ptab-today").innerHTML = html;
}

/** 子ども画面「これまで」タブ：渡しずみの数の日ごと棒グラフ（直近10日・#16）。 */
function renderChildHistory(): void {
  el("childHistoryTotal").textContent = String(handedTotal(state.entries));
  const days = handedDailyTotals(state.entries, new Date(), 10);
  if (days.every((d) => d.total === 0)) {
    el("childHistoryChart").innerHTML =
      `<div class="empty"><span class="big">🫙</span>まだ ないよ</div>`;
    return;
  }
  const max = Math.max(...days.map((d) => d.total), 1);
  let html = "";
  for (const [i, d] of days.entries()) {
    const pct = Math.round((d.total / max) * 100);
    const color = BEAD_COLORS[i % BEAD_COLORS.length];
    html += `<div class="chart-bar">
      <span class="chart-v">${d.total}</span>
      <span class="chart-track"><span class="chart-fill" style="height:${pct}%;--c:${color}"></span></span>
      <span class="chart-d">${dayLabel(d.date)}</span>
    </div>`;
  }
  el("childHistoryChart").innerHTML = html;
}

function switchChildTab(tab: "today" | "history"): void {
  for (const b of document.querySelectorAll<HTMLElement>(".child-tab")) {
    b.classList.toggle("active", b.dataset.childTab === tab);
  }
  el("childToday").hidden = tab !== "today";
  el("childHistory").hidden = tab !== "history";
  if (tab === "history") renderChildHistory();
}

/** 記録を1件取り消す（打ち間違い・やってないのにタップ 等）。 */
async function removeLogEntry(id: string): Promise<void> {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  if (!(await askConfirm(`${e.name}（${e.reward}こ）を けす？`, "けす"))) return;
  state.entries = removeEntry(state.entries, id);
  await persist();
  renderToday();
  showToast("けしました");
}

// その日ぶんを締める：approved → handed（おはじきを渡した）。
async function settle(date: string): Promise<void> {
  const total = approvedTotalForDate(state.entries, date);
  if (total === 0) return;
  if (!(await askConfirm(`${dayLabel(date)}の 分 ${total}こ を 渡した？`, "渡した"))) return;
  state.entries = settleDate(state.entries, date);
  await persist();
  renderToday();
  showToast("おはじきを 渡しました");
}

// ---- 設定 --------------------------------------------------

let editingEmojiFor: string | null = null;

function renderSettings(): void {
  let html = `<div class="sec-title" style="margin-top:0;"><span class="dot"></span>がんばること</div>`;
  html += `<div class="rule-legend"><span>👆 1回で もらえる</span><span>⏱️ 15分ごとに もらえる</span></div>`;
  state.rules.forEach((rule, i) => {
    const timed = rule.kind === "timed";
    const last = i === state.rules.length - 1;
    html += `<div class="rule-edit">
      <div class="rule-move">
        <button data-move-up="${esc(rule.id)}" aria-label="上へ"${i === 0 ? " disabled" : ""}>▲</button>
        <button data-move-down="${esc(rule.id)}" aria-label="下へ"${last ? " disabled" : ""}>▼</button>
      </div>
      <button class="rule-emoji-btn" data-pick-emoji="${esc(rule.id)}">${esc(rule.emoji)}</button>
      <input class="rule-name-input" value="${esc(rule.name)}" data-rule-name="${esc(rule.id)}">
      <button class="rule-kind-btn" data-toggle-kind="${esc(rule.id)}" title="${
        timed ? "15分ごと（押すと 1回に なる）" : "1回（押すと 15分ごとに なる）"
      }">${timed ? "⏱️" : "👆"}</button>
      <div class="rule-reward-box">
        <input class="rule-reward-input" type="number" min="0" value="${rule.reward}" data-rule-reward="${esc(rule.id)}">
        <span style="font-size:12px; color:var(--ink-soft);">こ</span>
      </div>
      <button class="rule-del" data-del-rule="${esc(rule.id)}">🗑</button>
    </div>`;
  });
  html += `<button class="add-rule" data-add-rule>＋ がんばることを 増やす</button>`;
  html += `<div id="emojiPicker"></div>`;
  html += `<div class="sec-title" style="margin-top:24px;"><span class="dot" style="background:var(--purple);"></span>暗証番号</div>
    <div class="rule-edit">
      <span style="font-size:13px; color:var(--ink-soft); flex:1;">4けたの 数字</span>
      <input class="rule-reward-input" style="width:80px; letter-spacing:3px;" maxlength="4" value="${esc(state.pin)}" data-pin>
    </div>`;
  const m = state.mascot;
  html += `<div class="sec-title" style="margin-top:24px;"><span class="dot" style="background:var(--pink);"></span>うさぎの きぶん</div>
    <p class="backup-note">つぎの日、うさぎが「きのうは ◯こ」と 言うときの 顔が 変わる 境目です。</p>
    <div class="rule-edit">
      <span style="font-size:13px; color:var(--ink-soft); flex:1;">😢 さみしい</span>
      <div class="rule-reward-box">
        <input class="rule-reward-input" type="number" min="0" max="${MASCOT_MAX_THRESHOLD}" value="${m.sadMax}" data-mascot-sad>
        <span style="font-size:12px; color:var(--ink-soft);">こ まで</span>
      </div>
    </div>
    <div class="rule-edit">
      <span style="font-size:13px; color:var(--ink-soft); flex:1;">😐 ふつう</span>
      <div class="rule-reward-box">
        <input class="rule-reward-input" type="number" min="1" max="${MASCOT_MAX_THRESHOLD}" value="${m.okMax}" data-mascot-ok>
        <span style="font-size:12px; color:var(--ink-soft);">こ まで</span>
      </div>
    </div>
    <p class="backup-note">それより 多いと 😆 うれしい！</p>`;
  html += `<div class="sec-title" style="margin-top:24px;"><span class="dot" style="background:var(--mint);"></span>バックアップ</div>
    <p class="backup-note">この端末だけに記録が入っています。ときどき保存してください。</p>
    <div class="backup-row">
      <button class="backup-btn" data-backup-save>バックアップを 保存</button>
      <button class="backup-btn" data-backup-restore>バックアップから 復元</button>
    </div>`;
  el("ptab-settings").innerHTML = html;
}

function renderEmojiPicker(): void {
  const picker = el("emojiPicker");
  if (!editingEmojiFor) {
    picker.innerHTML = "";
    return;
  }
  picker.innerHTML =
    `<div class="emoji-picker">` +
    EMOJI_CHOICES.map((e) => `<button class="emoji-opt" data-set-emoji="${e}">${e}</button>`).join(
      "",
    ) +
    `</div>`;
  picker.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---- バックアップ（#19）------------------------------------

/** State を JSON ファイルとしてダウンロードする（iPad Safari は `<a download>`）。 */
function saveBackup(): void {
  const blob = new Blob([backupText(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFilename(new Date());
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("バックアップを 保存しました");
}

/** ファイル選択 → parseBackup → 確認 → 置き換えで復元。 */
function restoreBackup(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    const restored = parseBackup(await file.text());
    if (!restored) {
      showToast("ファイルを 読み込めませんでした");
      return;
    }
    if (!(await askConfirm("バックアップから 復元する？ 今の記録は 消えます", "復元"))) return;
    state = restored;
    await persist();
    renderChild();
    renderSettings();
    renderToday();
    showToast("バックアップから 復元しました");
  });
  input.click();
}

// 設定タブ内のイベント委譲。
function wireSettingsDelegation(): void {
  const root = el("ptab-settings");

  root.addEventListener("input", (ev) => {
    const t = ev.target as HTMLElement;
    if (t instanceof HTMLInputElement && t.dataset.ruleName !== undefined) {
      state.rules = updateRule(state.rules, t.dataset.ruleName, { name: t.value });
      void persist();
    }
  });

  root.addEventListener("change", async (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.dataset.ruleReward !== undefined) {
      const val = clampReward(t.value);
      t.value = String(val);
      state.rules = updateRule(state.rules, t.dataset.ruleReward, { reward: val });
      await persist();
    } else if (t.dataset.pin !== undefined) {
      state.pin = normalizePin(t.value);
      t.value = state.pin;
      await persist();
    } else if (t.dataset.mascotSad !== undefined || t.dataset.mascotOk !== undefined) {
      state.mascot = normalizeMascot({
        sadMax: t.dataset.mascotSad !== undefined ? t.value : state.mascot.sadMax,
        okMax: t.dataset.mascotOk !== undefined ? t.value : state.mascot.okMax,
      });
      await persist();
      renderSettings(); // 矛盾入力（さみしい ≥ ふつう など）は正規化した値に戻して見せる
    }
  });

  root.addEventListener("click", async (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>(
      "[data-add-rule],[data-del-rule],[data-move-up],[data-move-down],[data-toggle-kind],[data-pick-emoji],[data-set-emoji],[data-backup-save],[data-backup-restore]",
    );
    if (!t) return;
    if (t.dataset.backupSave !== undefined) {
      saveBackup();
    } else if (t.dataset.backupRestore !== undefined) {
      restoreBackup();
    } else if (t.dataset.addRule !== undefined) {
      state.rules = addRule(state.rules, `r${Date.now()}`);
      await persist();
      renderSettings();
    } else if (t.dataset.delRule !== undefined) {
      state.rules = deleteRule(state.rules, t.dataset.delRule);
      await persist();
      renderSettings();
    } else if (t.dataset.moveUp !== undefined) {
      state.rules = moveRule(state.rules, t.dataset.moveUp, -1);
      await persist();
      renderSettings();
    } else if (t.dataset.moveDown !== undefined) {
      state.rules = moveRule(state.rules, t.dataset.moveDown, 1);
      await persist();
      renderSettings();
    } else if (t.dataset.toggleKind !== undefined) {
      const rule = state.rules.find((r) => r.id === t.dataset.toggleKind);
      state.rules = updateRule(state.rules, t.dataset.toggleKind, {
        kind: rule?.kind === "timed" ? "fixed" : "timed",
      });
      await persist();
      renderSettings();
    } else if (t.dataset.pickEmoji !== undefined) {
      editingEmojiFor = t.dataset.pickEmoji;
      renderEmojiPicker();
    } else if (t.dataset.setEmoji !== undefined && editingEmojiFor) {
      state.rules = updateRule(state.rules, editingEmojiFor, { emoji: t.dataset.setEmoji });
      editingEmojiFor = null;
      await persist();
      renderSettings();
    }
  });
}

// ---- 共通 --------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(msg: string): void {
  const t = el("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2000);
}

// はい/やめる の確認ダイアログ（親の操作用）。外タップ・やめるで false。
let askResolve: ((v: boolean) => void) | null = null;

function askConfirm(text: string, okLabel = "はい"): Promise<boolean> {
  el("askText").textContent = text;
  el("askOk").textContent = okLabel;
  el("askOverlay").classList.add("show");
  return new Promise((resolve) => {
    askResolve = resolve;
  });
}

function closeAsk(result: boolean): void {
  el("askOverlay").classList.remove("show");
  const r = askResolve;
  askResolve = null;
  r?.(result);
}

// ---- 初期化 ------------------------------------------------

function wireStaticEvents(): void {
  el("gearBtn").addEventListener("click", openPin);
  el("confirmCancel").addEventListener("click", closeConfirm);
  el("confirmSubmit").addEventListener("click", () => void submitAction());
  el("timedCancel").addEventListener("click", closeTimed);
  el("timedSubmit").addEventListener("click", () => void submitTimed());
  el("tPlus").addEventListener("click", () => timedAdjust(1));
  el("tMinus").addEventListener("click", () => timedAdjust(-1));
  el("parentClose").addEventListener("click", closeParent);

  el("askCancel").addEventListener("click", () => closeAsk(false));
  el("askOk").addEventListener("click", () => closeAsk(true));

  // 「＋◯こ」演出はタップでも消せる（自動でも数秒で消える）。
  el("celebrate").addEventListener("click", dismissCelebration);

  // うさぎのグリーティングは画面のどこをタップしても閉じる（#51）。
  el("greeting").addEventListener("click", dismissGreeting);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") maybeGreet();
  });

  // 子ども画面「今日 / これまで」の切り替え（#16）
  for (const tabBtn of document.querySelectorAll<HTMLElement>(".child-tab")) {
    tabBtn.addEventListener("click", () =>
      switchChildTab(tabBtn.dataset.childTab as "today" | "history"),
    );
  }

  // すべてのオーバーレイは外側（暗い部分）タップで閉じる（#8）。
  // 子どもが歯車を誤タップしても、更新なしで元に戻れるようにする。
  // 親パネルは再 PIN 入力が要るが、詰み回避と挙動の一貫性を優先。
  for (const [id, close] of [
    ["confirmOverlay", closeConfirm],
    ["timedOverlay", closeTimed],
    ["pinOverlay", closePin],
    ["parentOverlay", closeParent],
    ["askOverlay", () => closeAsk(false)],
  ] as const) {
    el(id).addEventListener("click", (ev) => {
      if (ev.target === ev.currentTarget) close();
    });
  }

  el("actionsGrid").addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-rule-id]");
    if (!btn) return;
    const rule = state.rules.find((r) => r.id === btn.dataset.ruleId);
    if (rule) openRule(rule);
  });

  for (const tabBtn of document.querySelectorAll<HTMLElement>(".ptab")) {
    tabBtn.addEventListener("click", () => switchPtab(tabBtn.dataset.ptab as ParentTab));
  }

  el("ptab-today").addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const rm = t.closest<HTMLElement>("[data-remove]");
    if (rm?.dataset.remove) {
      void removeLogEntry(rm.dataset.remove);
      return;
    }
    const st = t.closest<HTMLElement>("[data-settle]");
    if (st?.dataset.settle) void settle(st.dataset.settle);
  });
}

async function init(): Promise<void> {
  state = await loadState();
  buildKeypad();
  wireStaticEvents();
  wireSettingsDelegation();
  renderChild();
  maybeGreet(); // 翌日はじめての起動ならうさぎが昨日のことを言う（#51）

  // 親のルール編集・記録の取り消しを子ども画面に緩やかに反映。
  setInterval(async () => {
    if (el("parentOverlay").classList.contains("show")) return;
    const before = JSON.stringify(state);
    state = await loadState();
    if (JSON.stringify(state) !== before) renderChild();
  }, CHILD_POLL_MS);
}

void init();
