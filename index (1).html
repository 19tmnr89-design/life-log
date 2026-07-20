"use strict";

/* ================= データ層 ================= */

const STORAGE_KEY = "kintore-log-v1";

// record: { id, date:"YYYY-MM-DD", exercise, bodyPart, sets:[{weight, reps}], memo }
let records = loadRecords();

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function saveRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  // 同期モジュールへローカル変更を通知（読み込んだだけの再描画では発火させない）
  window.dispatchEvent(new CustomEvent("kintore:changed"));
}

// 同期モジュールがリモートのデータを取り込んだときに呼ばれ、画面を最新化する
function reloadFromStorage() {
  records = loadRecords();
  refreshExerciseList();
  renderTodaySummary();
  const active = document.querySelector(".tab-btn.active")?.dataset.tab;
  if (active === "history") renderHistory();
  if (active === "analysis") renderAnalysis();
}
window.addEventListener("kintore:remote", reloadFromStorage);

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ================= 種目マスタ ================= */

const BODY_PARTS = ["胸", "背中", "脚", "肩", "腕", "お尻", "腹筋", "有酸素運動", "その他"];

// 筋トレmemoで使用していた種目を先頭に、一般的な種目を後ろに配置
const PRESET_EXERCISES = {
  "胸": ["ペクトラルフライ", "フライ", "チェストプレス", "スミスマシン・インクラインベンチプレス", "ケーブルクロス", "ディップス", "ダンベルフライ", "ダンベルプレス", "インクラインダンベルプレス", "ベンチプレス", "インクラインベンチプレス", "腕立て伏せ"],
  "背中": ["アシストチンニング", "ダンベルデッドリフト", "シーテッドロー", "ラットプルダウン", "プーリーロー", "チンニング（懸垂）", "デッドリフト", "ベントオーバーロウ", "バックエクステンション"],
  "脚": ["カーフレイズ", "アブダクション", "アダクション", "レッグプレス", "レッグエクステンション", "レッグカール", "スクワット", "ブルガリアンスクワット", "ランジ"],
  "肩": ["リアデルトイド", "ショルダープレス", "サイドレイズ", "フロントレイズ", "リアレイズ", "アップライトロウ", "フェイスプル"],
  "腕": ["キックバック", "ダンベルフレンチプレス", "インクラインアームカール", "アシストディップス", "フレンチプレス", "ダンベルカール", "アームエクステンション", "アームカール", "ハンマーカール", "プレスダウン"],
  "お尻": ["ヒップスラスト", "グルートブリッジ"],
  "腹筋": ["ベントニーシートアップ", "ロータリートルソー", "プランク", "クランチ", "レッグレイズ", "アブローラー"],
  "有酸素運動": ["ランニング", "ウォーキング", "バイク", "トレッドミル", "エアロバイク"],
  "その他": []
};

// 旧バージョンで保存した部位名を新しい名称に揃える
const PART_RENAME = { "腹": "腹筋", "有酸素": "有酸素運動" };
let partMigrated = false;
for (const r of records) {
  if (PART_RENAME[r.bodyPart]) { r.bodyPart = PART_RENAME[r.bodyPart]; partMigrated = true; }
}
if (partMigrated) saveRecords();

// 種目 → 部位の逆引き（インポート時の部位補完に使用）
const EXERCISE_TO_PART = {};
for (const [part, list] of Object.entries(PRESET_EXERCISES)) {
  for (const ex of list) EXERCISE_TO_PART[ex] = part;
}

function guessBodyPart(exercise) {
  if (EXERCISE_TO_PART[exercise]) return EXERCISE_TO_PART[exercise];
  const found = records.find(r => r.exercise === exercise && r.bodyPart);
  return found ? found.bodyPart : "その他";
}

/* ================= ユーティリティ ================= */

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const w = "日月火水木金土"[new Date(y, m - 1, d).getDay()];
  return `${y}/${m}/${d} (${w})`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function recordVolume(r) {
  return r.sets.reduce((s, set) => s + (set.weight || 0) * (set.reps || 0), 0);
}

// Epley式 推定1RM
function e1rm(weight, reps) {
  if (!weight || !reps) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

/* ================= タブ切替 ================= */

$$(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".tab-btn").forEach(b => b.classList.remove("active"));
    $$(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    $("#tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "history") renderHistory();
    if (btn.dataset.tab === "analysis") renderAnalysis();
  });
});

/* ================= 記録フォーム ================= */

const setsContainer = $("#sets-container");

function addSetRow(weight = "", reps = "") {
  const row = document.createElement("div");
  row.className = "set-row";
  row.innerHTML = `
    <span class="set-no"></span>
    <input type="number" class="in-weight" inputmode="decimal" step="0.5" min="0" placeholder="重量" value="${esc(weight)}">
    <span class="unit">kg ×</span>
    <input type="number" class="in-reps" inputmode="numeric" step="1" min="0" placeholder="回数" value="${esc(reps)}">
    <span class="unit">回</span>
    <button type="button" class="del-set" title="削除">✕</button>
  `;
  row.querySelector(".del-set").addEventListener("click", () => {
    if (setsContainer.children.length > 1) row.remove();
    else { row.querySelector(".in-weight").value = ""; row.querySelector(".in-reps").value = ""; }
    renumberSets();
  });
  setsContainer.appendChild(row);
  renumberSets();
  return row;
}

function renumberSets() {
  [...setsContainer.children].forEach((row, i) => {
    row.querySelector(".set-no").textContent = i + 1;
  });
}

$("#add-set").addEventListener("click", () => addSetRow());

$("#copy-set").addEventListener("click", () => {
  const last = setsContainer.lastElementChild;
  if (!last) { addSetRow(); return; }
  addSetRow(last.querySelector(".in-weight").value, last.querySelector(".in-reps").value);
});

function initBodyPartSelect() {
  $("#f-bodypart").innerHTML = BODY_PARTS.map(p => `<option value="${p}">${p}</option>`).join("");
}

function refreshExerciseList() {
  const part = $("#f-bodypart").value;
  // 選択中の部位の種目一覧：自分が記録したことのある種目を先頭に、プリセットを続ける
  const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date));
  const used = [...new Set(sorted.filter(r => r.bodyPart === part).map(r => r.exercise))];
  const preset = PRESET_EXERCISES[part] || [];
  const all = [...new Set([...used, ...preset])];

  $("#exercise-list").innerHTML = all.map(e => `<option value="${esc(e)}">`).join("");

  $("#recent-exercises").innerHTML = all
    .map(e => `<button type="button" class="chip${used.includes(e) ? " used" : ""}" data-ex="${esc(e)}">${esc(e)}</button>`).join("");
  $$("#recent-exercises .chip").forEach(c => c.addEventListener("click", () => {
    $("#f-exercise").value = c.dataset.ex;
    prefillLastSets(c.dataset.ex);
  }));
}

// その種目の前回セットをプレースホルダとして再現
function prefillLastSets(exercise) {
  const past = records.filter(r => r.exercise === exercise).sort((a, b) => b.date.localeCompare(a.date));
  if (!past.length) return;
  setsContainer.innerHTML = "";
  past[0].sets.forEach(s => addSetRow(s.weight, s.reps));
}

$("#f-bodypart").addEventListener("change", refreshExerciseList);
$("#f-exercise").addEventListener("change", () => {
  const ex = $("#f-exercise").value.trim();
  if (ex && EXERCISE_TO_PART[ex]) $("#f-bodypart").value = EXERCISE_TO_PART[ex];
});

$("#record-form").addEventListener("submit", e => {
  e.preventDefault();
  const sets = [...setsContainer.children].map(row => ({
    weight: parseFloat(row.querySelector(".in-weight").value) || 0,
    reps: parseInt(row.querySelector(".in-reps").value, 10) || 0
  })).filter(s => s.weight > 0 || s.reps > 0);

  if (!sets.length) { alert("セットを1つ以上入力してください"); return; }

  records.push({
    id: newId(),
    date: $("#f-date").value,
    exercise: $("#f-exercise").value.trim(),
    bodyPart: $("#f-bodypart").value,
    sets,
    memo: $("#f-memo").value.trim()
  });
  saveRecords();

  // フォームは日付・部位を保持し、種目・セットのみリセット
  $("#f-exercise").value = "";
  $("#f-memo").value = "";
  setsContainer.innerHTML = "";
  addSetRow();
  refreshExerciseList();
  renderTodaySummary();

  const msg = $("#save-msg");
  msg.hidden = false;
  clearTimeout(msg._t);
  msg._t = setTimeout(() => { msg.hidden = true; }, 2000);
});

function renderTodaySummary() {
  const date = $("#f-date").value;
  const todays = records.filter(r => r.date === date);
  const box = $("#today-summary");
  if (!todays.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<h3>${esc(fmtDate(date))} の記録</h3>` + todays.map(recCardHTML).join("");
  bindDeleteButtons(box, renderTodaySummary);
}

/* ================= 履歴 ================= */

function recCardHTML(r) {
  const sets = r.sets.map(s => `<span class="rec-set-item"><b>${s.weight}</b>kg×${s.reps}</span>`).join("");
  return `
    <div class="rec-card" data-id="${r.id}">
      <div class="rec-top">
        <div><span class="rec-name">${esc(r.exercise)}</span><span class="rec-part">${esc(r.bodyPart || "")}</span></div>
        <button type="button" class="rec-del" title="削除">🗑</button>
      </div>
      <div class="rec-sets">${sets}</div>
      ${r.memo ? `<div class="rec-memo">📝 ${esc(r.memo)}</div>` : ""}
    </div>`;
}

function bindDeleteButtons(root, refresh) {
  root.querySelectorAll(".rec-del").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".rec-card").dataset.id;
      const r = records.find(x => x.id === id);
      if (!confirm(`「${r.exercise}」(${r.date}) を削除しますか？`)) return;
      records = records.filter(x => x.id !== id);
      saveRecords();
      refresh();
    });
  });
}

function renderHistory() {
  const q = $("#history-filter").value.trim();
  const list = $("#history-list");
  let filtered = records;
  if (q) {
    filtered = records.filter(r =>
      r.exercise.includes(q) || (r.bodyPart || "").includes(q) || (r.memo || "").includes(q));
  }
  if (!filtered.length) {
    list.innerHTML = `<p class="empty-note">${q ? "該当する記録がありません" : "まだ記録がありません"}</p>`;
    return;
  }
  const byDate = {};
  for (const r of filtered) (byDate[r.date] ??= []).push(r);
  const dates = Object.keys(byDate).sort().reverse();

  list.innerHTML = dates.map(d => {
    const vol = byDate[d].reduce((s, r) => s + recordVolume(r), 0);
    return `
      <div class="day-group">
        <div class="day-head"><span>${esc(fmtDate(d))}</span><span class="day-vol">総量 ${Math.round(vol).toLocaleString()}kg</span></div>
        ${byDate[d].map(recCardHTML).join("")}
      </div>`;
  }).join("");
  bindDeleteButtons(list, renderHistory);
}

$("#history-filter").addEventListener("input", renderHistory);

/* ================= 分析 ================= */

let chartMode = "maxweight";

function renderAnalysis() {
  const empty = !records.length;
  $("#analysis-empty").hidden = !empty;
  $("#analysis-body").style.display = empty ? "none" : "";
  if (empty) return;

  renderStats();
  renderPRTable();
  renderExerciseChartSelect();
  renderExerciseChart();
  renderWeeklyChart();
}

function renderStats() {
  const days = new Set(records.map(r => r.date));
  const totalVol = records.reduce((s, r) => s + recordVolume(r), 0);
  const totalSets = records.reduce((s, r) => s + r.sets.length, 0);

  // 直近30日のトレーニング日数
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const recentDays = new Set(records.filter(r => r.date >= cutoffStr).map(r => r.date));

  $("#stats-grid").innerHTML = `
    <div class="stat"><div class="v">${days.size}</div><div class="l">総トレーニング日数</div></div>
    <div class="stat"><div class="v">${recentDays.size}</div><div class="l">直近30日の日数</div></div>
    <div class="stat"><div class="v">${totalSets.toLocaleString()}</div><div class="l">総セット数</div></div>
    <div class="stat"><div class="v">${Math.round(totalVol / 1000).toLocaleString()}<small>t</small></div><div class="l">総挙上量</div></div>
  `;
}

function renderPRTable() {
  const prs = {}; // exercise -> {weight, reps, date, e1rm}
  for (const r of records) {
    for (const s of r.sets) {
      if (!s.weight) continue;
      const cur = prs[r.exercise];
      if (!cur || s.weight > cur.weight || (s.weight === cur.weight && s.reps > cur.reps)) {
        prs[r.exercise] = { weight: s.weight, reps: s.reps, date: r.date, e1rm: e1rm(s.weight, s.reps) };
      }
    }
  }
  const rows = Object.entries(prs).sort((a, b) => b[1].e1rm - a[1].e1rm);
  if (!rows.length) { $("#pr-table").innerHTML = `<p class="empty-note">重量付きの記録がまだありません</p>`; return; }
  $("#pr-table").innerHTML = `
    <table class="pr">
      <tr><th>種目</th><th class="num">最大</th><th class="num">推定1RM</th><th class="num">日付</th></tr>
      ${rows.map(([ex, p]) => `
        <tr>
          <td>${esc(ex)}</td>
          <td class="num">${p.weight}kg×${p.reps}</td>
          <td class="num">${p.e1rm.toFixed(1)}kg</td>
          <td class="num">${p.date.slice(5).replace("-", "/")}</td>
        </tr>`).join("")}
    </table>`;
}

function renderExerciseChartSelect() {
  const sel = $("#chart-exercise");
  const current = sel.value;
  const counts = {};
  for (const r of records) counts[r.exercise] = (counts[r.exercise] || 0) + 1;
  const exercises = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  sel.innerHTML = exercises.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join("");
  if (exercises.includes(current)) sel.value = current;
}

$("#chart-exercise").addEventListener("change", renderExerciseChart);
$$(".chart-toggle .chip").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".chart-toggle .chip").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    chartMode = btn.dataset.mode;
    renderExerciseChart();
  });
});

function renderExerciseChart() {
  const ex = $("#chart-exercise").value;
  const container = $("#chart-container");
  if (!ex) { container.innerHTML = ""; return; }

  // 日毎に集計
  const byDate = {};
  for (const r of records.filter(r => r.exercise === ex)) {
    (byDate[r.date] ??= []).push(...r.sets);
  }
  const points = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0])).map(([date, sets]) => {
    let v = 0;
    if (chartMode === "maxweight") v = Math.max(...sets.map(s => s.weight || 0));
    else if (chartMode === "volume") v = sets.reduce((s, x) => s + (x.weight || 0) * (x.reps || 0), 0);
    else v = Math.max(...sets.map(s => e1rm(s.weight, s.reps)));
    return { date, v };
  });

  const unit = chartMode === "volume" ? "kg(総量)" : "kg";
  container.innerHTML = lineChartSVG(points, unit);
}

function renderWeeklyChart() {
  // 週（月曜始まり）ごとの総ボリューム
  const byWeek = {};
  for (const r of records) {
    const [y, m, d] = r.date.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const day = (dt.getDay() + 6) % 7; // 月=0
    dt.setDate(dt.getDate() - day);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    byWeek[key] = (byWeek[key] || 0) + recordVolume(r);
  }
  const points = Object.entries(byWeek).sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-16)
    .map(([date, v]) => ({ date, v }));
  $("#weekly-chart").innerHTML = barChartSVG(points) +
    `<p class="chart-note">直近16週の総挙上量（重量×回数の合計）</p>`;
}

/* ---- SVGチャート（依存ライブラリなし） ---- */

function chartFrame(W, H, PAD) {
  return { W, H, PAD, plotW: W - PAD.l - PAD.r, plotH: H - PAD.t - PAD.b };
}

function niceMax(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / mag) * mag;
}

function lineChartSVG(points, unit) {
  if (!points.length) return `<p class="empty-note">データがありません</p>`;
  const f = chartFrame(600, 260, { l: 46, r: 14, t: 14, b: 30 });
  const maxV = niceMax(Math.max(...points.map(p => p.v)));
  const x = i => f.PAD.l + (points.length === 1 ? f.plotW / 2 : (i / (points.length - 1)) * f.plotW);
  const y = v => f.PAD.t + f.plotH - (v / maxV) * f.plotH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(t => {
    const gy = f.PAD.t + f.plotH * (1 - t);
    const label = (maxV * t) % 1 === 0 ? maxV * t : (maxV * t).toFixed(1);
    return `<line x1="${f.PAD.l}" y1="${gy}" x2="${f.W - f.PAD.r}" y2="${gy}" stroke="#34394e" stroke-width="1"/>
      <text x="${f.PAD.l - 6}" y="${gy + 4}" text-anchor="end" font-size="10" fill="#9aa0b4">${label}</text>`;
  }).join("");

  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const dots = points.map((p, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.5" fill="#4dabf7"><title>${p.date}: ${p.v.toFixed(1)}${unit}</title></circle>`).join("");

  // X軸ラベルは最大6個
  const step = Math.max(1, Math.ceil(points.length / 6));
  const xlabels = points.map((p, i) => {
    if (i % step !== 0 && i !== points.length - 1) return "";
    return `<text x="${x(i).toFixed(1)}" y="${f.H - 8}" text-anchor="middle" font-size="10" fill="#9aa0b4">${p.date.slice(5).replace("-", "/")}</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${f.W} ${f.H}" xmlns="http://www.w3.org/2000/svg">
    ${gridLines}
    <path d="${path}" fill="none" stroke="#4dabf7" stroke-width="2.5" stroke-linejoin="round"/>
    ${dots}${xlabels}
  </svg>`;
}

function barChartSVG(points) {
  if (!points.length) return `<p class="empty-note">データがありません</p>`;
  const f = chartFrame(600, 220, { l: 50, r: 14, t: 14, b: 30 });
  const maxV = niceMax(Math.max(...points.map(p => p.v)));
  const bw = f.plotW / points.length;
  const y = v => f.PAD.t + f.plotH - (v / maxV) * f.plotH;

  const gridLines = [0, 0.5, 1].map(t => {
    const gy = f.PAD.t + f.plotH * (1 - t);
    return `<line x1="${f.PAD.l}" y1="${gy}" x2="${f.W - f.PAD.r}" y2="${gy}" stroke="#34394e"/>
      <text x="${f.PAD.l - 6}" y="${gy + 4}" text-anchor="end" font-size="10" fill="#9aa0b4">${Math.round(maxV * t).toLocaleString()}</text>`;
  }).join("");

  const bars = points.map((p, i) => {
    const bx = f.PAD.l + i * bw + bw * 0.15;
    return `<rect x="${bx.toFixed(1)}" y="${y(p.v).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${(f.PAD.t + f.plotH - y(p.v)).toFixed(1)}" rx="3" fill="#ff6b6b"><title>${p.date}週: ${Math.round(p.v).toLocaleString()}kg</title></rect>`;
  }).join("");

  const step = Math.max(1, Math.ceil(points.length / 5));
  const xlabels = points.map((p, i) => {
    if (i % step !== 0) return "";
    return `<text x="${(f.PAD.l + i * bw + bw / 2).toFixed(1)}" y="${f.H - 8}" text-anchor="middle" font-size="10" fill="#9aa0b4">${p.date.slice(5).replace("-", "/")}</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${f.W} ${f.H}" xmlns="http://www.w3.org/2000/svg">${gridLines}${bars}${xlabels}</svg>`;
}

/* ================= CSV / JSON 入出力 ================= */

const CSV_HEADER = "date,exercise,body_part,set_no,weight_kg,reps,memo";

function toCSV() {
  const lines = [CSV_HEADER];
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  for (const r of sorted) {
    r.sets.forEach((s, i) => {
      lines.push([r.date, csvField(r.exercise), csvField(r.bodyPart || ""), i + 1, s.weight, s.reps, csvField(i === 0 ? r.memo || "" : "")].join(","));
    });
  }
  return lines.join("\n");
}

function csvField(s) {
  s = String(s ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseCSV(text) {
  // 単純なCSVパーサ（ダブルクォート対応）
  const rows = [];
  let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some(f => f !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some(f => f !== "")) rows.push(row);
  return rows;
}

function normalizeDate(s) {
  s = s.trim().replace(/[年月]/g, "/").replace(/日/g, "").replace(/[.\-]/g, "/");
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function importCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return { added: 0, skipped: 0, error: "空のファイルです" };

  // ヘッダー行の列位置を特定（無ければ既定の並びとみなす）
  let start = 0;
  let col = { date: 0, exercise: 1, body_part: 2, set_no: 3, weight_kg: 4, reps: 5, memo: 6 };
  const head = rows[0].map(h => h.trim().toLowerCase());
  const alias = {
    date: ["date", "日付"], exercise: ["exercise", "種目"], body_part: ["body_part", "bodypart", "部位"],
    set_no: ["set_no", "set", "セット"], weight_kg: ["weight_kg", "weight", "重量", "重量kg"],
    reps: ["reps", "回数", "レップ"], memo: ["memo", "メモ", "note"]
  };
  const looksLikeHeader = head.some(h => Object.values(alias).flat().includes(h));
  if (looksLikeHeader) {
    start = 1;
    for (const key of Object.keys(alias)) {
      const idx = head.findIndex(h => alias[key].includes(h));
      col[key] = idx; // 見つからなければ -1
    }
  }

  // 行を (date, exercise) 単位でレコードにまとめる
  const grouped = new Map();
  let bad = 0;
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const date = normalizeDate(r[col.date] ?? "");
    const exercise = (r[col.exercise] ?? "").trim();
    if (!date || !exercise) { bad++; continue; }
    const key = `${date} ${exercise}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        date, exercise,
        bodyPart: col.body_part >= 0 && (r[col.body_part] || "").trim() || null,
        sets: [], memo: ""
      });
    }
    const g = grouped.get(key);
    g.sets.push({
      weight: parseFloat(col.weight_kg >= 0 ? r[col.weight_kg] : "") || 0,
      reps: parseInt(col.reps >= 0 ? r[col.reps] : "", 10) || 0
    });
    const memo = col.memo >= 0 ? (r[col.memo] || "").trim() : "";
    if (memo && !g.memo) g.memo = memo;
  }

  const toImport = [...grouped.values()].map(g => ({
    id: newId(),
    date: g.date,
    exercise: g.exercise,
    bodyPart: g.bodyPart || guessBodyPart(g.exercise),
    sets: g.sets,
    memo: g.memo
  }));
  return mergeRecords(toImport, bad);
}

function recordFingerprint(r) {
  return [r.date, r.exercise, r.sets.map(s => `${s.weight}x${s.reps}`).join("|")].join(" ");
}

function mergeRecords(incoming, bad = 0) {
  const existing = new Set(records.map(recordFingerprint));
  let added = 0, skipped = 0;
  for (const r of incoming) {
    if (existing.has(recordFingerprint(r))) { skipped++; continue; }
    existing.add(recordFingerprint(r));
    records.push(r);
    added++;
  }
  if (added) saveRecords();
  return { added, skipped, bad };
}

function download(filename, content, mime) {
  const blob = new Blob(["﻿" + content], { type: mime }); // BOM付きでExcel文字化け対策
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

$("#export-csv").addEventListener("click", () => {
  download(`kintore_${todayStr()}.csv`, toCSV(), "text/csv");
});

$("#export-json").addEventListener("click", () => {
  download(`kintore_${todayStr()}.json`, JSON.stringify(records, null, 2), "application/json");
});

$("#import-file").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  let result;
  try {
    if (file.name.endsWith(".json") || text.trim().startsWith("[")) {
      const data = JSON.parse(text);
      const incoming = data.map(r => ({
        id: newId(),
        date: normalizeDate(r.date) || r.date,
        exercise: r.exercise,
        bodyPart: r.bodyPart || guessBodyPart(r.exercise),
        sets: (r.sets || []).map(s => ({ weight: +s.weight || 0, reps: +s.reps || 0 })),
        memo: r.memo || ""
      })).filter(r => r.date && r.exercise);
      result = mergeRecords(incoming);
    } else {
      result = importCSV(text.replace(/^﻿/, ""));
    }
  } catch (err) {
    result = { error: "読み込みに失敗しました: " + err.message };
  }
  const msg = $("#import-msg");
  msg.hidden = false;
  msg.textContent = result.error
    ? "⚠️ " + result.error
    : `✅ ${result.added}件追加（重複スキップ ${result.skipped}件${result.bad ? `、読めない行 ${result.bad}行` : ""}）`;
  e.target.value = "";
  refreshExerciseList();
  renderTodaySummary();
});

$("#clear-all").addEventListener("click", () => {
  if (!confirm("本当にすべての記録を削除しますか？")) return;
  if (!confirm("最終確認：この操作は元に戻せません。削除しますか？")) return;
  records = [];
  saveRecords();
  refreshExerciseList();
  renderTodaySummary();
  alert("削除しました");
});

/* ================= 初期化 ================= */

initBodyPartSelect();
$("#f-date").value = todayStr();
$("#f-date").addEventListener("change", renderTodaySummary);
addSetRow();
refreshExerciseList();
renderTodaySummary();
