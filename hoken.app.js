/* もしもシート — 画面とデータ操作
 *
 * データの唯一の出所は localStorage["hoken-log-v1"]。
 * 金額はすべて「円」で保存し、入力欄では項目に応じて万円で受け取る。
 * 同期は life-log 共通の sync.js（hoken.html で window.SYNC_APP="hoken",
 * window.SYNC_MODE="replace" を指定して読み込む）と hoken:changed / hoken:remote の
 * イベントで連携する。SYNC_MODE="replace" は、このアプリのデータが
 * 筋トレ/お金ログのような「レコードの配列」ではなく「1つのオブジェクト」であるため、
 * 和集合マージではなく「新しい方で丸ごと置き換え」の同期モードを使うことを sync.js に伝える。
 *
 * このファイルに実際の契約データ（保険会社名・保険料・保障額など）は一切含めない。
 * このリポジトリは公開のため、money.app.js と同じ方針で「個人の実データはコードに置かない」。
 * 実データは「設定」タブの JSON 読み込みから入れる（Gitには入らない）。
 */

const STORAGE_KEY = "hoken-log-v1";
const D = HOKEN_DATA;
const S = HOKEN_SIM;

let DATA = null;
let viewMode = false;
let simOverride = null;   // スライダーで一時的に動かした前提

/* ================= ユーティリティ ================= */

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
function n(v, fb) {
  const x = Number(v);
  return Number.isFinite(x) ? x : (fb === undefined ? 0 : fb);
}
/* 円 → 万円の表示 */
function man(yen) {
  const v = n(yen) / 10000;
  const rounded = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return rounded.toLocaleString("ja-JP");
}
function manYen(yen) { return man(yen) + "万円"; }
/* 1億以上は「1億2,000万円」の形にする */
function moneyStr(yen) {
  const v = n(yen);
  const abs = Math.abs(v);
  if (abs < 100000000) return manYen(v);
  const oku = Math.floor(abs / 100000000);
  const rest = abs % 100000000;
  return (v < 0 ? "-" : "") + oku + "億" + (rest ? man(rest) + "万" : "") + "円";
}
function yenStr(v) { return n(v).toLocaleString("ja-JP") + "円"; }

/* 入力欄の単位。日額だけ円、それ以外は万円で受け取る */
function covUnit(kind) {
  const k = D.COVERAGE_KINDS.find(c => c.key === kind);
  if (!k) return { unit: "万円", scale: 10000 };
  if (k.payout === "none") return { unit: "", scale: 1 };
  if (k.payout === "daily") return { unit: "円/日", scale: 1 };
  if (k.payout === "monthly") return { unit: "万円/月", scale: 10000 };
  return { unit: "万円", scale: 10000 };
}

function label(list, key, fb) {
  const f = list.find(x => x.key === key);
  return f ? f.label : (fb || key || "");
}

/* ================= データ ================= */

function defaultData() {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    profile: { birthYear: null, pensionType: "kosei", annualIncome: null, retirementAge: 65 },
    household: {
      monthlyLivingCost: 0,
      reduceRateWithChildren: 70,
      reduceRateAfterChildren: 50,
      funeralCost: 2000000,
      educationCostOverrides: {},
      housing: { type: "loan", monthlyPayment: 0, remainingYears: 0, hasGroupCredit: true, otherMonthlyCost: 0 },
      spouse: { birthYear: null, currentAnnualIncome: 0, incomeAfterEvent: 0, workUntilAge: 65 },
    },
    children: [],
    policies: [],
    companyBenefits: [],
    publicBenefits: D.PUBLIC_BENEFIT_TEMPLATES.map(t => Object.assign({ id: uid() }, t)),
    assets: [],
    assumptions: { inflationRate: 1, investmentReturn: 1, simulationYears: null, baseYear: new Date().getFullYear() },
    handover: { generalNote: "" },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.warn("データの読み込みに失敗しました", e);
    return defaultData();
  }
}

/* 足りないキーを既定値で埋める（古い保存データや手で編集したJSON向け） */
function migrate(d) {
  const base = defaultData();
  const out = Object.assign({}, base, d);
  out.profile = Object.assign({}, base.profile, d.profile);
  out.household = Object.assign({}, base.household, d.household);
  out.household.housing = Object.assign({}, base.household.housing, (d.household || {}).housing);
  out.household.spouse = Object.assign({}, base.household.spouse, (d.household || {}).spouse);
  out.household.educationCostOverrides = (d.household || {}).educationCostOverrides || {};
  out.assumptions = Object.assign({}, base.assumptions, d.assumptions);
  ["children", "policies", "companyBenefits", "publicBenefits", "assets"].forEach(k => {
    out[k] = Array.isArray(d[k]) ? d[k] : [];
    out[k].forEach(x => { if (!x.id) x.id = uid(); });
  });
  out.schemaVersion = 1;
  return out;
}

function persist() {
  DATA.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DATA));
  window.dispatchEvent(new CustomEvent("hoken:changed"));
}

function save() {
  persist();
  renderAll();
}

function isSetUp() {
  const hh = DATA.household;
  return n(hh.monthlyLivingCost) > 0 && !!(hh.spouse && hh.spouse.birthYear);
}

/* ================= 画面切り替え ================= */

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b === btn));
      const id = "tab-" + btn.dataset.tab;
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === id));
      window.scrollTo(0, 0);
    });
  });
}

function applyViewMode() {
  viewMode = location.hash.indexOf("view") >= 0;
  $("view-banner").hidden = !viewMode;
  document.querySelectorAll("[data-edit-only]").forEach(el => { el.hidden = viewMode; });
  if (viewMode) {
    const active = document.querySelector(".tab-btn.active");
    if (active && active.hidden) document.querySelector(".tab-btn:not([hidden])").click();
  }
}

/* ================= もしもタブ ================= */

function currentSimData() {
  if (!simOverride) return DATA;
  const d = Object.assign({}, DATA);
  d.assumptions = Object.assign({}, DATA.assumptions, {
    inflationRate: simOverride.inflationRate,
    investmentReturn: simOverride.investmentReturn,
  });
  d.household = Object.assign({}, DATA.household);
  d.household.spouse = Object.assign({}, DATA.household.spouse, {
    incomeAfterEvent: simOverride.spouseIncome,
  });
  return d;
}

function renderSim() {
  const ready = isSetUp();
  $("sim-empty").hidden = ready;
  $("sim-body").hidden = !ready;
  if (!ready) return;

  const result = S.simulate(currentSimData());
  const sm = result.summary;

  $("summary-grid").innerHTML = [
    box("一時金として入るお金", man(sm.lumpSum), "万円", "死亡保険金・死亡退職金・弔慰金など", "good"),
    box("毎月入ってくるお金", man(sm.monthlyRecurring), "万円", "遺族年金・収入保障・配偶者の収入", "good"),
    box("いまの貯金・投資", man(result.initialBalance), "万円", "シミュレーションの元手", ""),
  ].join("");

  const v = $("verdict");
  if (sm.depletionIndex === null) {
    v.className = "verdict";
    v.innerHTML = "配偶者が" + result.rows[result.rows.length - 1].spouseAge + "歳になる" +
      sm.finalYear + "年まで、お金は尽きない見込みです。" +
      "<br><strong>最後に残るお金は約" + manYen(sm.finalBalance) + "</strong>です。";
  } else {
    v.className = "verdict bad";
    v.innerHTML = "<strong>" + sm.depletionIndex + "年後（" + sm.depletionYear + "年・配偶者" +
      sm.depletionSpouseAge + "歳）にお金が尽きる</strong>見込みです。" +
      "<br>保障を足すか、支出の前提を見直す必要がありそうです。";
  }

  $("chart-balance").innerHTML = balanceChart(result);
  $("chart-flow").innerHTML = flowChart(result);
  $("flow-legend").innerHTML = FLOW_SERIES.map(s =>
    '<span><i style="background:' + s.color + '"></i>' + s.label + "</span>").join("");

  if (!simOverride) syncSliders();
}

function box(labelText, value, unit, hint, cls) {
  return '<div class="summary-box ' + cls + '">' +
    '<div class="label">' + esc(labelText) + "</div>" +
    '<div class="value">' + esc(value) + '<span class="unit">' + esc(unit) + "</span></div>" +
    '<div class="hint">' + esc(hint) + "</div></div>";
}

/* ---- グラフ ---- */

const FLOW_SERIES = [
  { key: "insurance", label: "保険金", color: "#4d9fd6", side: "in" },
  { key: "company",   label: "会社の制度", color: "#6fb7e0", side: "in" },
  { key: "pension",   label: "公的年金", color: "#5bbfa5", side: "in" },
  { key: "spouse",    label: "配偶者の収入", color: "#8ed3bf", side: "in" },
  { key: "asset",     label: "資産の受取", color: "#a9c9d8", side: "in" },
  { key: "living",    label: "生活費", color: "#d98b5f", side: "out" },
  { key: "housing",   label: "住居費", color: "#c97a6a", side: "out" },
  { key: "education", label: "教育費", color: "#b06a86", side: "out" },
  { key: "oneTime",   label: "一時的な支出", color: "#8a6a9b", side: "out" },
];

function niceStep(max, targetLines) {
  const raw = max / (targetLines || 5);
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const cands = [1, 2, 2.5, 5, 10].map(m => m * mag);
  return cands.find(c => c >= raw) || mag * 10;
}

function balanceChart(result) {
  const W = 920, H = 312, L = 66, R = 16, T = 28, B = 40;
  const rows = result.rows;
  if (!rows.length) return "";
  const innerW = W - L - R, innerH = H - T - B;

  const vals = rows.map(r => r.balance);
  const maxV = Math.max.apply(null, vals.concat([0]));
  const minV = Math.min.apply(null, vals.concat([0]));
  const step = niceStep(Math.max(maxV - minV, 1), 5);
  const top = Math.ceil(maxV / step) * step || step;
  const bottom = Math.floor(minV / step) * step;
  const span = Math.max(top - bottom, 1);

  const x = i => L + (rows.length === 1 ? innerW / 2 : (i / (rows.length - 1)) * innerW);
  const y = v => T + innerH - ((v - bottom) / span) * innerH;

  let g = "";
  for (let v = bottom; v <= top + 0.5; v += step) {
    const yy = y(v);
    g += '<line x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy +
      '" stroke="' + (v === 0 ? "#5a6678" : "#2e3645") + '" stroke-width="1"/>';
    g += '<text x="' + (L - 8) + '" y="' + (yy + 4) + '" text-anchor="end" fill="#8e97a8" font-size="11">' +
      man(v) + "</text>";
  }
  g += '<text x="' + (L - 8) + '" y="12" text-anchor="end" fill="#8e97a8" font-size="10">万円</text>';

  const labelEvery = Math.max(1, Math.ceil(rows.length / 10));
  rows.forEach((r, i) => {
    if (i % labelEvery !== 0 && i !== rows.length - 1) return;
    g += '<text x="' + x(i) + '" y="' + (H - B + 16) + '" text-anchor="middle" fill="#8e97a8" font-size="11">' +
      r.year + "</text>";
    g += '<text x="' + x(i) + '" y="' + (H - B + 30) + '" text-anchor="middle" fill="#5d6678" font-size="10">' +
      r.spouseAge + "歳</text>";
  });

  const pts = rows.map((r, i) => x(i) + "," + y(r.balance)).join(" ");
  const area = "M" + x(0) + "," + y(0) + " L" + rows.map((r, i) => x(i) + "," + y(r.balance)).join(" L") +
    " L" + x(rows.length - 1) + "," + y(0) + " Z";
  g += '<path d="' + area + '" fill="#4d9fd6" opacity="0.14"/>';
  g += '<polyline points="' + pts + '" fill="none" stroke="#4d9fd6" stroke-width="2.5"/>';

  const di = result.summary.depletionIndex;
  if (di !== null) {
    g += '<line x1="' + x(di) + '" y1="' + T + '" x2="' + x(di) + '" y2="' + (T + innerH) +
      '" stroke="#d98b5f" stroke-width="1.5" stroke-dasharray="4 3"/>';
    g += '<circle cx="' + x(di) + '" cy="' + y(rows[di].balance) + '" r="4" fill="#d98b5f"/>';
    g += '<text x="' + Math.min(x(di) + 8, W - R - 90) + '" y="' + (T + 16) +
      '" fill="#d98b5f" font-size="11">ここで尽きる</text>';
  }

  return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="残高の推移">' + g + "</svg>";
}

function flowChart(result) {
  const W = 920, H = 292, L = 66, R = 16, T = 26, B = 34;
  const rows = result.rows;
  if (!rows.length) return "";
  const innerW = W - L - R, innerH = H - T - B;

  // 発生年の一時金だけが突出すると他の年が潰れるので、その場合は2年目以降に軸を合わせる
  const ins = rows.map(r => r.incomeTotal);
  const outs = rows.map(r => r.expenseTotal);
  const restInMax = rows.length > 1 ? Math.max.apply(null, ins.slice(1)) : ins[0];
  const restOutMax = rows.length > 1 ? Math.max.apply(null, outs.slice(1)) : outs[0];
  const clipIn = rows.length > 1 && ins[0] > restInMax * 2.5;
  const clipOut = rows.length > 1 && outs[0] > restOutMax * 2.5;
  const maxIn = Math.max(clipIn ? restInMax : Math.max.apply(null, ins), 1);
  const maxOut = Math.max(clipOut ? restOutMax : Math.max.apply(null, outs), 1);
  const step = niceStep(Math.max(maxIn, maxOut), 3);
  const top = Math.ceil(maxIn / step) * step || step;
  const bot = Math.ceil(maxOut / step) * step || step;
  const total = top + bot;
  const zeroY = T + (top / total) * innerH;
  const scale = innerH / total;

  const bw = Math.max(1.5, (innerW / rows.length) * 0.72);
  const x = i => L + (i + 0.5) * (innerW / rows.length);

  let g = "";
  for (let v = -bot; v <= top + 0.5; v += step) {
    const yy = zeroY - v * scale;
    g += '<line x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy +
      '" stroke="' + (v === 0 ? "#5a6678" : "#2e3645") + '" stroke-width="1"/>';
    g += '<text x="' + (L - 8) + '" y="' + (yy + 4) + '" text-anchor="end" fill="#8e97a8" font-size="11">' +
      man(Math.abs(v)) + "</text>";
  }
  g += '<text x="' + (L - 8) + '" y="12" text-anchor="end" fill="#8e97a8" font-size="10">万円</text>';

  // 描画領域からはみ出す分は頭を切る
  const topEdge = T, bottomEdge = T + innerH;
  function bar(xc, yTop, yBottom, color, title) {
    const y0 = Math.max(yTop, topEdge), y1 = Math.min(yBottom, bottomEdge);
    if (y1 - y0 <= 0.2) return "";
    return '<rect x="' + (xc - bw / 2) + '" y="' + y0 + '" width="' + bw +
      '" height="' + (y1 - y0) + '" fill="' + color + '"><title>' + title + "</title></rect>";
  }

  rows.forEach((r, i) => {
    let acc = 0;
    FLOW_SERIES.filter(s => s.side === "in").forEach(s => {
      const v = r.income[s.key] || 0;
      if (v <= 0) return;
      g += bar(x(i), zeroY - (acc + v) * scale, zeroY - acc * scale, s.color,
        r.year + " " + s.label + " " + manYen(v));
      acc += v;
    });
    acc = 0;
    FLOW_SERIES.filter(s => s.side === "out").forEach(s => {
      const v = r.expense[s.key] || 0;
      if (v <= 0) return;
      g += bar(x(i), zeroY + acc * scale, zeroY + (acc + v) * scale, s.color,
        r.year + " " + s.label + " " + manYen(v));
      acc += v;
    });
  });

  // 頭を切った棒には実際の金額を添える
  if (clipIn) {
    g += '<text x="' + Math.min(x(0) + 6, W - R - 140) + '" y="' + (T + 11) +
      '" fill="#8ed3bf" font-size="11">' + rows[0].year + "年は" + manYen(ins[0]) + "（グラフは上限まで）</text>";
  }
  if (clipOut) {
    g += '<text x="' + Math.min(x(0) + 6, W - R - 140) + '" y="' + (bottomEdge - 4) +
      '" fill="#d98b5f" font-size="11">' + rows[0].year + "年は" + manYen(outs[0]) + "（グラフは下限まで）</text>";
  }

  const labelEvery = Math.max(1, Math.ceil(rows.length / 10));
  rows.forEach((r, i) => {
    if (i % labelEvery !== 0 && i !== rows.length - 1) return;
    g += '<text x="' + x(i) + '" y="' + (H - B + 18) + '" text-anchor="middle" fill="#8e97a8" font-size="11">' +
      r.year + "</text>";
  });

  return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="年ごとの収入と支出">' + g + "</svg>";
}

/* ---- スライダー ---- */

function syncSliders() {
  const a = DATA.assumptions, sp = DATA.household.spouse;
  setSlider("sl-inflation", n(a.inflationRate, 1), v => v.toFixed(1) + "%");
  setSlider("sl-return", n(a.investmentReturn, 1), v => v.toFixed(1) + "%");
  setSlider("sl-spouse", Math.round(n(sp.incomeAfterEvent) / 10000), v => v + "万円");
}
function setSlider(id, value, fmt) {
  const el = $(id);
  if (!el) return;
  el.value = value;
  $(id + "-val").textContent = fmt(Number(value));
}

function setupSliders() {
  const onInput = () => {
    simOverride = {
      inflationRate: Number($("sl-inflation").value),
      investmentReturn: Number($("sl-return").value),
      spouseIncome: Number($("sl-spouse").value) * 10000,
    };
    $("sl-inflation-val").textContent = simOverride.inflationRate.toFixed(1) + "%";
    $("sl-return-val").textContent = simOverride.investmentReturn.toFixed(1) + "%";
    $("sl-spouse-val").textContent = Math.round(simOverride.spouseIncome / 10000) + "万円";
    renderSim();
  };
  ["sl-inflation", "sl-return", "sl-spouse"].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener("input", onInput);
  });
  $("sl-reset").addEventListener("click", () => { simOverride = null; renderSim(); });
  $("sl-save").addEventListener("click", () => {
    if (!simOverride) return;
    DATA.assumptions.inflationRate = simOverride.inflationRate;
    DATA.assumptions.investmentReturn = simOverride.investmentReturn;
    DATA.household.spouse.incomeAfterEvent = simOverride.spouseIncome;
    simOverride = null;
    save();
  });
}

/* ================= 共通フォーム部品 ================= */

function fld(labelText, inner, sub) {
  return '<div class="field"><label>' + esc(labelText) + "</label>" + inner +
    (sub ? '<p class="sublabel">' + esc(sub) + "</p>" : "") + "</div>";
}
function inp(id, type, value, placeholder, extra) {
  return '<input type="' + type + '" id="' + id + '" value="' + esc(value == null ? "" : value) +
    '" placeholder="' + esc(placeholder || "") + '" ' + (extra || "") + ">";
}
function unitInp(id, value, unit, placeholder, step) {
  return '<div class="input-unit">' +
    inp(id, "number", value, placeholder, step ? 'step="' + step + '"' : "") +
    '<span class="unit">' + esc(unit) + "</span></div>";
}
function sel(id, options, value) {
  return '<select id="' + id + '">' + options.map(o =>
    '<option value="' + esc(o.key) + '"' + (o.key === value ? " selected" : "") + ">" +
    esc(o.label) + "</option>").join("") + "</select>";
}
function val(id) { const el = $(id); return el ? el.value : ""; }
function numVal(id, scale) { return Math.round(n(val(id)) * (scale || 1)); }

/* ================= ダイアログ ================= */

let dialogSave = null, dialogDelete = null;

function openDialog(opts) {
  const ro = !!opts.readOnly;
  $("dialog-title").textContent = opts.title;
  $("dialog-body").innerHTML = opts.body;
  $("dialog-delete").hidden = ro || !opts.onDelete;
  $("dialog-save").hidden = ro && !opts.onEdit;
  $("dialog-save").textContent = ro ? "編集する" : "保存";
  $("dialog-cancel").textContent = ro ? "閉じる" : "キャンセル";
  dialogSave = ro ? opts.onEdit : opts.onSave;
  dialogDelete = ro ? null : opts.onDelete;
  $("dialog-overlay").hidden = false;
  if (opts.after) opts.after();
}
function closeDialog() {
  $("dialog-overlay").hidden = true;
  dialogSave = null; dialogDelete = null;
}

/* ================= 契約タブ ================= */

const STATUSES = [
  { key: "active",  label: "有効" },
  { key: "paid_up", label: "払込済" },
  { key: "lapsed",  label: "解約・失効" },
];

function renderPolicies() {
  /* 保険料の集計 */
  const ps = S.premiumSummary(DATA);
  const maxAnnual = Math.max.apply(null, ps.byPolicy.map(p => p.annual).concat([1]));
  let html = "";
  if (!ps.count) {
    html = '<p class="empty-note">有効な契約がまだありません。</p>';
  } else {
    html = '<div class="summary-grid" style="margin-bottom:16px;">' +
      box("年間の保険料", n(ps.total).toLocaleString("ja-JP"), "円", "約" + manYen(ps.total), "") +
      box("月あたり", Math.round(ps.total / 12).toLocaleString("ja-JP"), "円", "有効な契約の合計", "") +
      box("一時払で払った額", n(ps.lumpTotal).toLocaleString("ja-JP"), "円", "年額には含めていません", "") +
      "</div>";
    const noPremium = DATA.policies.filter(p =>
      p.status === "active" && !n((p.premium || {}).amount)).length;
    if (noPremium) {
      html += '<p class="note">保険料が未登録の契約が' + noPremium +
        "件あります。合計にはその分が入っていません。</p>";
    }
    html += ps.byPolicy.filter(p => p.annual > 0).map(p =>
      '<div class="bar-line"><span class="bl-name">' + esc(p.name) + "</span>" +
      '<span class="bl-bar"><i style="width:' + Math.round((p.annual / maxAnnual) * 100) + '%"></i></span>' +
      '<span class="bl-val">' + yenStr(p.annual) + "/年</span></div>").join("");
    const cats = D.CATEGORIES.filter(c => ps.byCategory[c.key]);
    if (cats.length) {
      html += '<table style="margin-top:14px;"><thead><tr><th>種類別</th><th class="num">年額</th></tr></thead><tbody>' +
        cats.map(c => "<tr><td>" + esc(c.label) + '</td><td class="num">' + yenStr(ps.byCategory[c.key]) +
          "</td></tr>").join("") +
        '</tbody><tfoot><tr><td>合計</td><td class="num">' + yenStr(ps.total) + "</td></tr></tfoot></table>";
    }
  }
  $("premium-summary").innerHTML = html;

  /* 契約一覧 */
  const list = $("policy-list");
  if (!DATA.policies.length) {
    list.innerHTML = '<p class="empty-note">まだ保険が登録されていません。</p>';
  } else {
    list.innerHTML = DATA.policies.map(p => {
      const covs = (p.coverages || []).map(covSummary).join(" ／ ") || "保障が未入力";
      const statusBadge = p.status === "active" ? "" :
        '<span class="badge off">' + label(STATUSES, p.status) + "</span>";
      const prem = !n((p.premium || {}).amount) ? "保険料未登録"
        : p.premium.cycle === "lump" ? "一時払 " + yenStr(p.premium.amount)
        : yenStr(S.annualPremium(p)) + "/年";
      return '<div class="item"><div class="item-head">' +
        '<span class="name">' + esc(S.policyLabel(p)) + "</span>" +
        '<span class="badge">' + esc(label(D.PRODUCT_TYPES, p.productType)) + "</span>" +
        statusBadge +
        '<span class="meta">' + esc(prem) + "</span></div>" +
        '<div class="item-body">' + esc(covs) +
        (p.storageNote ? "<br>証券のありか: " + esc(p.storageNote) : "") +
        (p.contactNote ? "<br>連絡先: " + esc(p.contactNote) : "") +
        (p.beneficiary ? "<br>受取人: " + esc(p.beneficiary) : "") +
        "</div>" +
        '<div class="item-actions">' +
        '<button type="button" class="btn-sub" data-detail-policy="' + p.id + '">詳しく見る</button>' +
        (viewMode ? "" : '<button type="button" class="btn-sub" data-edit-policy="' + p.id + '">編集</button>') +
        "</div></div>";
    }).join("");
  }

  /* 会社の制度 */
  const clist = $("company-list");
  if (!DATA.companyBenefits.length) {
    clist.innerHTML = '<p class="empty-note">まだ登録されていません。</p>';
  } else {
    clist.innerHTML = DATA.companyBenefits.map(b => {
      const kind = D.COMPANY_BENEFIT_KINDS.find(k => k.key === b.kind) || {};
      const amt = b.payoutType === "monthly" ? moneyStr(b.amount) + "/月"
        : b.payoutType === "annual" ? moneyStr(b.amount) + "/年" : moneyStr(b.amount);
      return '<div class="item"><div class="item-head">' +
        '<span class="name">' + esc(b.name || kind.label || "") + "</span>" +
        '<span class="badge">' + esc(kind.label || "") + "</span>" +
        (kind.expiresOnRetirement ? '<span class="badge warn">退職で失効</span>' : "") +
        '<span class="meta">' + esc(amt) + "</span></div>" +
        (b.storageNote ? '<div class="item-body">手続き先: ' + esc(b.storageNote) + "</div>" : "") +
        (viewMode ? "" : '<div class="item-actions"><button type="button" class="btn-sub" data-edit-company="' +
          b.id + '">編集</button></div>') +
        "</div>";
    }).join("");
  }
}

/* 保障1行分の要約。金額が入っていないもの（サービスや限度額が幅のあるもの）は名前だけ出す。 */
function covSummary(c) {
  const name = c.title || label(D.COVERAGE_KINDS, c.kind);
  if (!n(c.amount)) return name;
  const u = covUnit(c.kind);
  const amt = u.scale === 1 ? yenStr(c.amount) : moneyStr(c.amount);
  const suffix = u.unit.indexOf("/月") >= 0 ? "/月" : u.unit.indexOf("/日") >= 0 ? "/日" : "";
  const term = c.kind === "death_monthly" && c.termYears ? "（" + c.termYears + "年間）" : "";
  return name + " " + amt + suffix + term;
}

/* ---- 保険の詳細 ---- */

function openPolicyDetail(p) {
  if (!p) return;
  const rows = [];
  const add = (k, v) => { if (v) rows.push([k, v]); };
  add("区分", label(D.CATEGORIES, p.category));
  add("種類", label(D.PRODUCT_TYPES, p.productType));
  add("引受・提供元", p.insurer);
  add("プラン名", p.productName);
  add("状態", label(STATUSES, p.status));
  add("対象になる人", p.coveredPersons);
  const cycle = D.PREMIUM_CYCLES.find(c => c.key === (p.premium || {}).cycle);
  if (p.premium && p.premium.amount) {
    const annual = S.annualPremium(p);
    add("保険料", yenStr(p.premium.amount) + "（" + (cycle ? cycle.label : "") + "）" +
      (annual ? "　年間 " + yenStr(annual) : ""));
  }
  add("支払方法", p.paymentMethod);
  const ct = p.contractTerms || {};
  add("契約期間", ct.termType);
  add("次回の更新", ct.renewalPeriod);
  add("受取人", p.beneficiary);
  add("証券のありか", p.storageNote);
  add("連絡先", p.contactNote);
  add("メモ", p.memo);

  let body = '<dl class="detail-dl">' +
    rows.map(r => "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>").join("") + "</dl>";

  if (ct.clauses && ct.clauses.length) {
    body += '<h3 class="detail-h">適用される特約</h3><ul class="detail-ul">' +
      ct.clauses.map(c => "<li>" + esc(c) + "</li>").join("") + "</ul>";
  }

  const covs = p.coverages || [];
  if (covs.length) {
    body += '<h3 class="detail-h">補償・サービスの内容</h3>';
    body += covs.map(c => {
      let h = '<div class="detail-cov">';
      h += '<div class="detail-cov-head">' +
        (c.group ? '<span class="badge">' + esc(c.group) + "</span>" : "") +
        '<span class="name">' + esc(c.title || label(D.COVERAGE_KINDS, c.kind)) + "</span>" +
        (n(c.amount) ? '<span class="meta">' + esc(covAmountText(c)) + "</span>" : "") +
        (c.settlementService ? '<span class="badge ok">示談交渉サービスあり</span>' : "") +
        "</div>";
      if (c.details) h += "<p>" + esc(c.details) + "</p>";
      const meta = [];
      if (c.limitText) meta.push("限度額: " + c.limitText);
      if (n(c.deductible)) meta.push("免責: " + yenStr(c.deductible));
      if (c.note) meta.push(c.note);
      if (meta.length) h += '<p class="sub">' + esc(meta.join("　／　")) + "</p>";
      if (c.conditions && c.conditions.length) {
        h += '<p class="sub">支払いの条件:</p><ul class="detail-ul">' +
          c.conditions.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>";
      }
      if (c.exclusions && c.exclusions.length) {
        h += '<p class="sub">対象外:</p><ul class="detail-ul">' +
          c.exclusions.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>";
      }
      return h + "</div>";
    }).join("");
  }

  openDialog({
    title: S.policyLabel(p),
    body: body,
    readOnly: true,
    onEdit: viewMode ? null : () => { closeDialog(); openPolicyDialog(p); },
  });
}

function covAmountText(c) {
  const u = covUnit(c.kind);
  const amt = u.scale === 1 ? yenStr(c.amount) : moneyStr(c.amount);
  return amt + (u.unit.indexOf("/月") >= 0 ? "/月" : u.unit.indexOf("/日") >= 0 ? "/日" : "");
}

/* ---- 保険の追加・編集 ---- */

function suggestCoverages(productType) {
  const pt = D.PRODUCT_TYPES.find(p => p.key === productType);
  if (!pt) return [];
  return pt.suggest.map(k => ({ kind: k, amount: 0, termYears: null, minGuaranteeYears: null, note: "" }));
}

function covRowsHtml(covs) {
  if (!covs.length) return '<p class="note">「＋ 保障を追加」で、死亡保険金や入院日額などを足してください。</p>';
  return covs.map((c, i) => {
    const u = covUnit(c.kind);
    const isMonthly = c.kind === "death_monthly" || c.kind === "disability_monthly" || c.kind === "nursing_monthly";
    return '<div class="cov-row">' +
      '<div>' + (i === 0 ? '<label style="font-size:11px;color:#8e97a8;">保障の種類</label>' : "") +
      sel("cov-kind-" + i, D.COVERAGE_KINDS, c.kind) +
      (c.title ? '<p class="sublabel">' + esc(c.title) + "</p>" : "") + "</div>" +
      '<div>' + (i === 0 ? '<label style="font-size:11px;color:#8e97a8;">金額</label>' : "") +
      unitInp("cov-amt-" + i, c.amount ? c.amount / u.scale : "", u.unit, "") + "</div>" +
      '<div>' + (i === 0 ? '<label style="font-size:11px;color:#8e97a8;">支払期間</label>' : "") +
      (isMonthly ? unitInp("cov-term-" + i, c.termYears, "年", "終身なら空欄")
        : '<span class="unit" style="font-size:12px;color:#5d6678;">—</span>') + "</div>" +
      '<button type="button" class="del" data-del-cov="' + i + '" title="削除">×</button>' +
      "</div>";
  }).join("");
}

/* 画面の入力を既存の保障オブジェクトに上書きする。
   台帳から取り込んだ説明・限度額・対象外などは画面に出していないので、消さないように残す。 */
function collectCovs(existing) {
  const out = [];
  for (let i = 0; i < existing.length; i++) {
    const kindEl = $("cov-kind-" + i);
    if (!kindEl) { out.push(existing[i]); continue; }
    const kind = kindEl.value;
    const u = covUnit(kind);
    const amt = val("cov-amt-" + i) === "" ? null : numVal("cov-amt-" + i, u.scale);
    out.push(Object.assign({}, existing[i], {
      kind: kind,
      amount: amt,
      termYears: $("cov-term-" + i) ? (val("cov-term-" + i) === "" ? null : n(val("cov-term-" + i))) : null,
    }));
  }
  return out;
}

function openPolicyDialog(existing) {
  const p = existing ? JSON.parse(JSON.stringify(existing)) : {
    id: uid(), category: "life", productType: "term_life", insurer: "", productName: "",
    status: "active", startDate: "", endDate: "", isWholeLife: false,
    premium: { amount: 0, cycle: "monthly", payUntilAge: null },
    paymentMethod: "", coveredPersons: "",
    coverages: suggestCoverages("term_life"),
    beneficiary: "", storageNote: "", contactNote: "", memo: "",
  };
  let covs = p.coverages || [];

  const body =
    '<div class="field-row">' +
    fld("保険の種類", sel("po-type", D.PRODUCT_TYPES, p.productType)) +
    fld("状態", sel("po-status", STATUSES, p.status)) +
    "</div>" +
    '<div class="field-row">' +
    fld("保険会社", inp("po-insurer", "text", p.insurer, "例: ○○生命")) +
    fld("商品名", inp("po-name", "text", p.productName, "例: 収入保障プラン")) +
    "</div>" +
    '<div class="field-row three">' +
    fld("保険料", unitInp("po-prem", p.premium.amount || "", "円", "4000")) +
    fld("支払サイクル", sel("po-cycle", D.PREMIUM_CYCLES, p.premium.cycle)) +
    fld("払込満了年齢", unitInp("po-until", p.premium.payUntilAge, "歳", "終身払なら空欄")) +
    "</div>" +
    '<div class="field"><label>保障の内容</label><div id="cov-rows">' + covRowsHtml(covs) + "</div>" +
    '<div class="btn-row"><button type="button" class="btn-sub" id="add-cov">＋ 保障を追加</button></div></div>' +
    '<div class="field-row">' +
    fld("対象になる人", inp("po-covered", "text", p.coveredPersons, "例: 契約者本人および同居の親族")) +
    fld("支払方法", inp("po-method", "text", p.paymentMethod, "例: 口座振替／クレジットカード")) +
    "</div>" +
    '<div class="field-row">' +
    fld("受取人", inp("po-bene", "text", p.beneficiary, "例: 妻")) +
    fld("証券のありか", inp("po-storage", "text", p.storageNote, "例: 自宅の金庫"),
      "番号は書かないでください。置き場所だけを書きます。") +
    "</div>" +
    fld("連絡先のメモ", inp("po-contact", "text", p.contactNote, "例: ○○生命 コールセンター／担当の△△さん")) +
    fld("メモ", inp("po-memo", "text", p.memo, "自由記入"));

  openDialog({
    title: existing ? "保険を編集" : "保険を追加",
    body: body,
    onSave: () => {
      covs = collectCovs(covs);
      const productType = val("po-type");
      const pt = D.PRODUCT_TYPES.find(x => x.key === productType);
      /* 画面に出していない項目（台帳由来の overlapNotes など）を落とさないよう、元の契約に重ねる */
      const saved = Object.assign({}, p, {
        id: p.id, category: pt ? pt.category : "life", productType: productType,
        insurer: val("po-insurer"), productName: val("po-name"), status: val("po-status"),
        premium: {
          amount: numVal("po-prem"), cycle: val("po-cycle"),
          payUntilAge: val("po-until") === "" ? null : n(val("po-until")),
        },
        coverages: covs,
        coveredPersons: val("po-covered"), paymentMethod: val("po-method"),
        beneficiary: val("po-bene"), storageNote: val("po-storage"),
        contactNote: val("po-contact"), memo: val("po-memo"),
      });
      const i = DATA.policies.findIndex(x => x.id === p.id);
      if (i >= 0) DATA.policies[i] = saved; else DATA.policies.push(saved);
      closeDialog(); save();
    },
    onDelete: existing ? () => {
      if (!confirm("この保険を削除します。よろしいですか？")) return;
      DATA.policies = DATA.policies.filter(x => x.id !== p.id);
      closeDialog(); save();
    } : null,
    after: () => {
      const rerender = () => { $("cov-rows").innerHTML = covRowsHtml(covs); };
      $("po-type").addEventListener("change", () => {
        covs = collectCovs(covs);
        if (covs.every(c => !n(c.amount) && !c.title)) covs = suggestCoverages(val("po-type"));
        rerender();
      });
      $("add-cov").addEventListener("click", () => {
        covs = collectCovs(covs);
        covs.push({ kind: "death_lump", amount: 0, termYears: null, minGuaranteeYears: null, note: "" });
        rerender();
      });
      $("cov-rows").addEventListener("click", e => {
        const btn = e.target.closest("[data-del-cov]");
        if (!btn) return;
        covs = collectCovs(covs);
        covs.splice(Number(btn.dataset.delCov), 1);
        rerender();
      });
      $("cov-rows").addEventListener("change", e => {
        if (!e.target.id || e.target.id.indexOf("cov-kind-") !== 0) return;
        covs = collectCovs(covs);
        rerender();
      });
    },
  });
}

/* ---- 会社の制度 ---- */

const PAYOUT_TYPES = [
  { key: "lump",    label: "一時金" },
  { key: "monthly", label: "毎月" },
  { key: "annual",  label: "毎年" },
];

function openCompanyDialog(existing) {
  const b = existing ? Object.assign({}, existing) : {
    id: uid(), kind: "death_retirement", name: "", amount: 0,
    payoutType: "lump", years: null, storageNote: "",
  };
  const body =
    '<div class="field-row">' +
    fld("制度の種類", sel("cb-kind", D.COMPANY_BENEFIT_KINDS, b.kind)) +
    fld("名称", inp("cb-name", "text", b.name, "例: 団体定期保険")) +
    "</div>" +
    '<div class="field-row three">' +
    fld("金額", unitInp("cb-amount", b.amount ? b.amount / 10000 : "", "万円", "1000")) +
    fld("受け取り方", sel("cb-payout", PAYOUT_TYPES, b.payoutType)) +
    fld("支給年数", unitInp("cb-years", b.years, "年", "終身なら空欄")) +
    "</div>" +
    fld("手続き先のメモ", inp("cb-storage", "text", b.storageNote, "例: 社内ポータルの福利厚生ページ／総務部"));

  openDialog({
    title: existing ? "会社の制度を編集" : "会社の制度を追加",
    body: body,
    onSave: () => {
      const saved = {
        id: b.id, kind: val("cb-kind"), name: val("cb-name"),
        amount: numVal("cb-amount", 10000), payoutType: val("cb-payout"),
        years: val("cb-years") === "" ? null : n(val("cb-years")),
        storageNote: val("cb-storage"),
      };
      const i = DATA.companyBenefits.findIndex(x => x.id === b.id);
      if (i >= 0) DATA.companyBenefits[i] = saved; else DATA.companyBenefits.push(saved);
      closeDialog(); save();
    },
    onDelete: existing ? () => {
      DATA.companyBenefits = DATA.companyBenefits.filter(x => x.id !== b.id);
      closeDialog(); save();
    } : null,
  });
}

/* ================= 前提タブ ================= */

function renderAssumptions() {
  const p = DATA.profile, hh = DATA.household, sp = hh.spouse, ho = hh.housing, a = DATA.assumptions;
  setVal("p-birth", p.birthYear);
  setVal("p-pension", p.pensionType);
  setVal("p-retire", p.retirementAge);
  setVal("s-birth", sp.birthYear);
  setVal("s-income", sp.currentAnnualIncome ? sp.currentAnnualIncome / 10000 : "");
  setVal("s-after", sp.incomeAfterEvent ? sp.incomeAfterEvent / 10000 : "");
  setVal("s-until", sp.workUntilAge);
  setVal("h-type", ho.type);
  setVal("h-payment", ho.monthlyPayment ? ho.monthlyPayment / 10000 : "");
  setVal("h-years", ho.remainingYears);
  setVal("h-other", ho.otherMonthlyCost ? ho.otherMonthlyCost / 10000 : "");
  $("h-gc").checked = !!ho.hasGroupCredit;
  setVal("l-living", hh.monthlyLivingCost ? hh.monthlyLivingCost / 10000 : "");
  setVal("l-rate1", hh.reduceRateWithChildren);
  setVal("l-rate2", hh.reduceRateAfterChildren);
  setVal("l-funeral", hh.funeralCost ? hh.funeralCost / 10000 : "");
  setVal("a-infl", a.inflationRate);
  setVal("a-ret", a.investmentReturn);
  setVal("a-years", a.simulationYears || "");

  renderChildren();
  renderAssets();
  renderPublic();
  renderEduTable();
}

function setVal(id, v) {
  const el = $(id);
  if (el) el.value = (v == null ? "" : v);
}

function bindAssumptionInputs() {
  const ids = ["p-birth", "p-pension", "p-retire", "s-birth", "s-income", "s-after", "s-until",
    "h-type", "h-payment", "h-years", "h-other", "h-gc",
    "l-living", "l-rate1", "l-rate2", "l-funeral", "a-infl", "a-ret", "a-years"];
  ids.forEach(id => {
    const el = $(id);
    if (el) el.addEventListener("change", pullAssumptions);
  });
}

function pullAssumptions() {
  const p = DATA.profile, hh = DATA.household, sp = hh.spouse, ho = hh.housing, a = DATA.assumptions;
  p.birthYear = val("p-birth") === "" ? null : n(val("p-birth"));
  p.pensionType = val("p-pension");
  p.retirementAge = n(val("p-retire"), 65);
  sp.birthYear = val("s-birth") === "" ? null : n(val("s-birth"));
  sp.currentAnnualIncome = numVal("s-income", 10000);
  sp.incomeAfterEvent = numVal("s-after", 10000);
  sp.workUntilAge = n(val("s-until"), 65);
  ho.type = val("h-type");
  ho.monthlyPayment = numVal("h-payment", 10000);
  ho.remainingYears = n(val("h-years"));
  ho.otherMonthlyCost = numVal("h-other", 10000);
  ho.hasGroupCredit = $("h-gc").checked;
  hh.monthlyLivingCost = numVal("l-living", 10000);
  hh.reduceRateWithChildren = n(val("l-rate1"), 70);
  hh.reduceRateAfterChildren = n(val("l-rate2"), 50);
  hh.funeralCost = numVal("l-funeral", 10000);
  a.inflationRate = n(val("a-infl"), 1);
  a.investmentReturn = n(val("a-ret"), 1);
  a.simulationYears = val("a-years") === "" ? null : n(val("a-years"));
  simOverride = null;
  save();
}

/* ---- 子ども ---- */

function renderChildren() {
  const el = $("child-list");
  if (!DATA.children.length) {
    el.innerHTML = '<p class="empty-note">子どもが登録されていません。いない場合はそのままで大丈夫です。</p>';
    return;
  }
  const thisYear = new Date().getFullYear();
  el.innerHTML = DATA.children.map(c => {
    const age = thisYear - n(c.birthYear, thisYear);
    const plan = D.EDUCATION_STAGES.map(s => {
      const opt = S.coursePlanFor(c, s.key);
      const o = s.options.find(x => x.key === opt);
      return s.label + ":" + (o ? o.label : opt);
    }).join(" / ");
    return '<div class="item"><div class="item-head">' +
      '<span class="name">' + esc(c.name || "子ども") + "</span>" +
      '<span class="meta">' + c.birthYear + "年生まれ・今年" + age + "歳／" +
      n(c.independenceAge, 22) + "歳で独立</span></div>" +
      '<div class="item-body">' + esc(plan) + "</div>" +
      '<div class="item-actions"><button type="button" class="btn-sub" data-edit-child="' +
      c.id + '">編集</button></div></div>';
  }).join("");
}

function openChildDialog(existing) {
  const c = existing ? JSON.parse(JSON.stringify(existing)) : {
    id: uid(), name: "", birthYear: new Date().getFullYear(), independenceAge: 22, coursePlan: {},
  };
  const body =
    '<div class="field-row three">' +
    fld("名前", inp("ch-name", "text", c.name, "例: 長男")) +
    fld("生まれた年", unitInp("ch-birth", c.birthYear, "年", "2020")) +
    fld("独立する年齢", unitInp("ch-indep", n(c.independenceAge, 22), "歳", "22")) +
    "</div>" +
    '<div class="field"><label>進路の想定</label><div class="field-row three">' +
    D.EDUCATION_STAGES.map(s =>
      fld(s.label, sel("ch-" + s.key, s.options, S.coursePlanFor(c, s.key)))).join("") +
    "</div></div>";

  openDialog({
    title: existing ? "子どもを編集" : "子どもを追加",
    body: body,
    onSave: () => {
      const plan = {};
      D.EDUCATION_STAGES.forEach(s => { plan[s.key] = val("ch-" + s.key); });
      const saved = {
        id: c.id, name: val("ch-name"), birthYear: n(val("ch-birth")),
        independenceAge: n(val("ch-indep"), 22), coursePlan: plan,
      };
      const i = DATA.children.findIndex(x => x.id === c.id);
      if (i >= 0) DATA.children[i] = saved; else DATA.children.push(saved);
      closeDialog(); save();
    },
    onDelete: existing ? () => {
      DATA.children = DATA.children.filter(x => x.id !== c.id);
      closeDialog(); save();
    } : null,
  });
}

/* ---- 資産 ---- */

const AVAILABLE_AT = [
  { key: "now",    label: "今すぐ使える" },
  { key: "at_age", label: "配偶者が◯歳の年に入る" },
];

function renderAssets() {
  const el = $("asset-list");
  if (!DATA.assets.length) {
    el.innerHTML = '<p class="empty-note">まだ登録されていません。</p>';
    return;
  }
  el.innerHTML = DATA.assets.map(a =>
    '<div class="item"><div class="item-head">' +
    '<span class="name">' + esc(label(D.ASSET_KINDS, a.kind)) + "</span>" +
    '<span class="meta">' + manYen(a.amount) + "</span>" +
    '<span class="badge">' + (a.availableAt === "at_age" ? "配偶者" + n(a.ageValue) + "歳" : "今すぐ") +
    "</span></div>" +
    (a.memo ? '<div class="item-body">' + esc(a.memo) + "</div>" : "") +
    '<div class="item-actions"><button type="button" class="btn-sub" data-edit-asset="' +
    a.id + '">編集</button></div></div>').join("");
}

function openAssetDialog(existing) {
  const a = existing ? Object.assign({}, existing) : {
    id: uid(), kind: "savings", amount: 0, availableAt: "now", ageValue: null, memo: "",
  };
  const body =
    '<div class="field-row three">' +
    fld("種類", sel("as-kind", D.ASSET_KINDS, a.kind)) +
    fld("金額", unitInp("as-amount", a.amount ? a.amount / 10000 : "", "万円", "800")) +
    fld("いつ使えるか", sel("as-when", AVAILABLE_AT, a.availableAt)) +
    "</div>" +
    fld("配偶者の年齢", unitInp("as-age", a.ageValue, "歳", "65"),
      "「配偶者が◯歳の年に入る」を選んだ場合だけ使います。") +
    fld("メモ", inp("as-memo", "text", a.memo, "自由記入"));

  openDialog({
    title: existing ? "資産を編集" : "資産を追加",
    body: body,
    onSave: () => {
      const saved = {
        id: a.id, kind: val("as-kind"), amount: numVal("as-amount", 10000),
        availableAt: val("as-when"),
        ageValue: val("as-age") === "" ? null : n(val("as-age")),
        memo: val("as-memo"),
      };
      const i = DATA.assets.findIndex(x => x.id === a.id);
      if (i >= 0) DATA.assets[i] = saved; else DATA.assets.push(saved);
      closeDialog(); save();
    },
    onDelete: existing ? () => {
      DATA.assets = DATA.assets.filter(x => x.id !== a.id);
      closeDialog(); save();
    } : null,
  });
}

/* ---- 公的給付 ---- */

function periodText(pb) {
  const start = pb.startCondition === "at_age" ? "配偶者が" + n(pb.startValue) + "歳から"
    : pb.startCondition === "after_years" ? n(pb.startValue) + "年後から" : "すぐに";
  const end = pb.endCondition === "at_age" ? "配偶者が" + n(pb.endValue) + "歳まで"
    : pb.endCondition === "youngest_child_18" ? "末子が" + n(pb.endValue, 18) + "歳になる年まで"
    : "終身";
  return start + "〜" + end;
}

function renderPublic() {
  const el = $("public-list");
  if (!DATA.publicBenefits.length) {
    el.innerHTML = '<p class="empty-note">まだ登録されていません。</p>';
    return;
  }
  el.innerHTML = DATA.publicBenefits.map(pb =>
    '<div class="item"><div class="item-head">' +
    '<span class="name">' + esc(label(D.PUBLIC_BENEFIT_KINDS, pb.kind)) + "</span>" +
    '<span class="meta">' + (n(pb.annualAmount) > 0 ? manYen(pb.annualAmount) + "/年" : "") + "</span>" +
    (n(pb.annualAmount) > 0 ? "" : '<span class="badge warn">未入力</span>') +
    "</div>" +
    '<div class="item-body">' + esc(periodText(pb)) +
    (pb.memo ? "<br>" + esc(pb.memo) : "") + "</div>" +
    '<div class="item-actions"><button type="button" class="btn-sub" data-edit-public="' +
    pb.id + '">編集</button></div></div>').join("");
}

function openPublicDialog(existing) {
  const pb = existing ? Object.assign({}, existing) : {
    id: uid(), kind: "survivor_basic", scenario: "death", annualAmount: 0,
    startCondition: "immediately", startValue: 0,
    endCondition: "lifetime", endValue: 0, memo: "",
  };
  const body =
    '<div class="field-row">' +
    fld("種類", sel("pb-kind", D.PUBLIC_BENEFIT_KINDS, pb.kind)) +
    fld("年額", unitInp("pb-amount", pb.annualAmount ? pb.annualAmount / 10000 : "", "万円/年", "105"),
      "ねんきんネットなどで調べた金額を入れてください。") +
    "</div>" +
    '<div class="field-row">' +
    fld("いつから", sel("pb-start", D.START_CONDITIONS, pb.startCondition)) +
    fld("その数値", unitInp("pb-startv", pb.startValue, "歳 / 年", "40")) +
    "</div>" +
    '<div class="field-row">' +
    fld("いつまで", sel("pb-end", D.END_CONDITIONS, pb.endCondition)) +
    fld("その数値", unitInp("pb-endv", pb.endValue, "歳", "18")) +
    "</div>" +
    fld("メモ", inp("pb-memo", "text", pb.memo, "いつ・どこで調べたか"));

  openDialog({
    title: existing ? "公的給付を編集" : "公的給付を追加",
    body: body,
    onSave: () => {
      const kind = D.PUBLIC_BENEFIT_KINDS.find(k => k.key === val("pb-kind"));
      const saved = {
        id: pb.id, kind: val("pb-kind"), scenario: kind ? kind.scenario : "death",
        annualAmount: numVal("pb-amount", 10000),
        startCondition: val("pb-start"), startValue: n(val("pb-startv")),
        endCondition: val("pb-end"), endValue: n(val("pb-endv")),
        memo: val("pb-memo"),
      };
      const i = DATA.publicBenefits.findIndex(x => x.id === pb.id);
      if (i >= 0) DATA.publicBenefits[i] = saved; else DATA.publicBenefits.push(saved);
      closeDialog(); save();
    },
    onDelete: existing ? () => {
      DATA.publicBenefits = DATA.publicBenefits.filter(x => x.id !== pb.id);
      closeDialog(); save();
    } : null,
  });
}

/* ---- 教育費の補正 ---- */

function renderEduTable() {
  const ov = DATA.household.educationCostOverrides || {};
  let html = '<table><thead><tr><th>段階</th><th>進路</th><th class="num">年額（円）</th>' +
    '<th class="num">入学時（円）</th><th></th></tr></thead><tbody>';
  D.EDUCATION_STAGES.forEach(s => {
    s.options.forEach(o => {
      if (o.key === "none") return;
      const aKey = D.eduKey(s.key, o.key, "annual");
      const eKey = D.eduKey(s.key, o.key, "entry");
      const hasEntry = o.entry != null;
      const edited = (ov[aKey] != null && ov[aKey] !== "") || (hasEntry && ov[eKey] != null && ov[eKey] !== "");
      html += "<tr><td>" + esc(s.label) + "</td><td>" + esc(o.label) + "</td>" +
        '<td class="num"><input type="number" data-edu="' + aKey + '" value="' +
        (ov[aKey] != null ? esc(ov[aKey]) : "") + '" placeholder="' + o.annual + '" style="max-width:130px;text-align:right;"></td>' +
        '<td class="num">' + (hasEntry
          ? '<input type="number" data-edu="' + eKey + '" value="' + (ov[eKey] != null ? esc(ov[eKey]) : "") +
            '" placeholder="' + o.entry + '" style="max-width:130px;text-align:right;">'
          : '<span style="color:#5d6678">—</span>') + "</td>" +
        '<td data-edu-badge="' + s.key + ":" + o.key + '">' +
        (edited ? '<span class="badge ok">補正済み</span>' : '<span class="badge off">概算のまま</span>') +
        "</td></tr>";
    });
  });
  html += "</tbody></table>";
  $("edu-table").innerHTML = html;
}

function refreshEduBadge(changedKey) {
  const rowKey = changedKey.split(":").slice(0, 2).join(":");
  const cell = document.querySelector('[data-edu-badge="' + rowKey + '"]');
  if (!cell) return;
  const ov = DATA.household.educationCostOverrides || {};
  const edited = Object.keys(ov).some(k => k.indexOf(rowKey + ":") === 0 && ov[k] !== "" && ov[k] != null);
  cell.innerHTML = edited
    ? '<span class="badge ok">補正済み</span>'
    : '<span class="badge off">概算のまま</span>';
}

/* ================= 設定タブ ================= */

function renderSettings() {
  const url = location.origin + location.pathname + "#view";
  $("view-url").textContent = url;
}

function setupSettings() {
  $("copy-view-url").addEventListener("click", () => {
    const url = $("view-url").textContent;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => showIoMsg("リンクをコピーしました"));
    } else {
      showIoMsg("コピーできませんでした。上のリンクを手で選択してください。");
    }
  });
  $("open-view").addEventListener("click", () => {
    location.hash = "view";
    location.reload();
  });

  $("export-json").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hoken-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    showIoMsg("書き出しました");
  });

  $("import-file").addEventListener("change", e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!confirm("今の内容をすべて置き換えます。よろしいですか？")) { e.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        DATA = migrate(JSON.parse(reader.result));
        save();
        showIoMsg("読み込みました");
      } catch (err) {
        showIoMsg("読み込みに失敗しました: " + err.message);
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  $("clear-all").addEventListener("click", () => {
    if (!confirm("この端末に保存された内容をすべて削除します。元に戻せません。よろしいですか？")) return;
    localStorage.removeItem(STORAGE_KEY);
    DATA = defaultData();
    save();
    showIoMsg("削除しました");
  });
}

function showIoMsg(text) {
  const el = $("io-msg");
  el.textContent = text;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 4000);
}

/* ================= 入力ウィザード ================= */

let wizStep = 0;
let wizChildren = [];

const WIZ_STEPS = [
  {
    title: "あなたのこと",
    note: "年齢と加入している年金制度を教えてください。",
    render: () => '<div class="field-row three">' +
      fld("生まれた年", unitInp("w-birth", DATA.profile.birthYear, "年", "1988")) +
      fld("加入している年金", sel("w-pension", [
        { key: "kosei", label: "厚生年金（会社員・公務員）" },
        { key: "kokumin", label: "国民年金（自営業など）" }], DATA.profile.pensionType)) +
      fld("定年の予定", unitInp("w-retire", n(DATA.profile.retirementAge, 65), "歳", "65")) +
      "</div>",
    collect: () => {
      DATA.profile.birthYear = val("w-birth") === "" ? null : n(val("w-birth"));
      DATA.profile.pensionType = val("w-pension");
      DATA.profile.retirementAge = n(val("w-retire"), 65);
    },
  },
  {
    title: "配偶者のこと",
    note: "もしもの後に働き方を変える想定なら、その年収を入れてください。",
    render: () => {
      const sp = DATA.household.spouse;
      return '<div class="field-row">' +
        fld("生まれた年", unitInp("w-sbirth", sp.birthYear, "年", "1990")) +
        fld("今の年収", unitInp("w-sincome", sp.currentAnnualIncome ? sp.currentAnnualIncome / 10000 : "", "万円", "150")) +
        fld("もしもの後の年収", unitInp("w-safter", sp.incomeAfterEvent ? sp.incomeAfterEvent / 10000 : "", "万円", "300")) +
        fld("何歳まで働くか", unitInp("w-suntil", n(sp.workUntilAge, 65), "歳", "65")) +
        "</div>";
    },
    collect: () => {
      const sp = DATA.household.spouse;
      sp.birthYear = val("w-sbirth") === "" ? null : n(val("w-sbirth"));
      sp.currentAnnualIncome = numVal("w-sincome", 10000);
      sp.incomeAfterEvent = numVal("w-safter", 10000);
      sp.workUntilAge = n(val("w-suntil"), 65);
    },
  },
  {
    title: "子どものこと",
    note: "生まれた年と大学の進路から、教育費を自動で計算します。いない場合はそのまま次へ。",
    render: () => wizChildrenHtml(),
    collect: () => {
      collectWizChildren();
      DATA.children = wizChildren.map(c => ({
        id: c.id, name: c.name, birthYear: c.birthYear,
        independenceAge: 22,
        coursePlan: Object.assign({}, c.coursePlan, { university: c.university }),
      }));
    },
  },
  {
    title: "住まいのこと",
    note: "団信に入っていると、自分が亡くなったときにローンの返済がなくなります。",
    render: () => {
      const ho = DATA.household.housing;
      return '<div class="field-row">' +
        fld("住まいの種類", sel("w-htype", [
          { key: "loan", label: "持ち家（住宅ローンあり）" },
          { key: "owned", label: "持ち家（ローン完済）" },
          { key: "rent", label: "賃貸" }], ho.type)) +
        fld("毎月の返済額・家賃", unitInp("w-hpay", ho.monthlyPayment ? ho.monthlyPayment / 10000 : "", "万円/月", "12")) +
        fld("残りの返済年数", unitInp("w-hyears", ho.remainingYears, "年", "28")) +
        fld("管理費・固定資産税など", unitInp("w-hother", ho.otherMonthlyCost ? ho.otherMonthlyCost / 10000 : "", "万円/月", "2.5")) +
        "</div>" +
        '<div class="field"><label class="check-row"><input type="checkbox" id="w-hgc"' +
        (ho.hasGroupCredit ? " checked" : "") + "><span>団体信用生命保険（団信）に入っている</span></label></div>";
    },
    collect: () => {
      const ho = DATA.household.housing;
      ho.type = val("w-htype");
      ho.monthlyPayment = numVal("w-hpay", 10000);
      ho.remainingYears = n(val("w-hyears"));
      ho.otherMonthlyCost = numVal("w-hother", 10000);
      ho.hasGroupCredit = $("w-hgc").checked;
    },
  },
  {
    title: "暮らしのお金",
    note: "生活費は住居費・教育費を除いた金額です。削減率は目安のままでも構いません。",
    render: () => {
      const hh = DATA.household;
      const savings = DATA.assets.find(a => a.kind === "savings" && a.availableAt === "now");
      return '<div class="field-row three">' +
        fld("今の生活費", unitInp("w-living", hh.monthlyLivingCost ? hh.monthlyLivingCost / 10000 : "", "万円/月", "30")) +
        fld("子どもがいる間", unitInp("w-rate1", n(hh.reduceRateWithChildren, 70), "%", "70")) +
        fld("子どもの独立後", unitInp("w-rate2", n(hh.reduceRateAfterChildren, 50), "%", "50")) +
        "</div>" +
        '<div class="field-row">' +
        fld("貯金・投資の現在高", unitInp("w-savings", savings ? savings.amount / 10000 : "", "万円", "800")) +
        fld("葬儀・お墓などの費用", unitInp("w-funeral", hh.funeralCost ? hh.funeralCost / 10000 : "", "万円", "200")) +
        "</div>";
    },
    collect: () => {
      const hh = DATA.household;
      hh.monthlyLivingCost = numVal("w-living", 10000);
      hh.reduceRateWithChildren = n(val("w-rate1"), 70);
      hh.reduceRateAfterChildren = n(val("w-rate2"), 50);
      hh.funeralCost = numVal("w-funeral", 10000);
      const amount = numVal("w-savings", 10000);
      let savings = DATA.assets.find(a => a.kind === "savings" && a.availableAt === "now");
      if (!savings && amount > 0) {
        savings = { id: uid(), kind: "savings", amount: 0, availableAt: "now", ageValue: null, memo: "" };
        DATA.assets.push(savings);
      }
      if (savings) savings.amount = amount;
    },
  },
  {
    title: "公的年金",
    note: "自動計算はしません。ねんきんネットなどで調べた年額を入れてください。分からなければ空欄のままで構いません（0として計算します）。",
    render: () => DATA.publicBenefits.map((pb, i) =>
      fld(label(D.PUBLIC_BENEFIT_KINDS, pb.kind) + "（" + periodText(pb) + "）",
        unitInp("w-pb-" + i, pb.annualAmount ? pb.annualAmount / 10000 : "", "万円/年", ""))).join(""),
    collect: () => {
      DATA.publicBenefits.forEach((pb, i) => {
        if ($("w-pb-" + i)) pb.annualAmount = numVal("w-pb-" + i, 10000);
      });
    },
  },
  {
    title: "ここまでで計算できます",
    note: "",
    render: () => {
      const todo = [];
      if (!DATA.policies.length) todo.push("入っている保険を「契約」タブで登録する");
      if (!DATA.companyBenefits.length) todo.push("会社の制度（団体保険・死亡退職金など）を登録する");
      if (DATA.publicBenefits.every(pb => !n(pb.annualAmount))) todo.push("公的年金の金額を調べて入れる");
      return "<p>入力ありがとうございました。「もしも」タブでグラフが見られます。</p>" +
        (todo.length
          ? '<p class="note" style="margin-top:14px;">まだ入っていないもの:</p><ul class="todo-list">' +
            todo.map(t => "<li>" + esc(t) + "</li>").join("") + "</ul>"
          : '<p class="note" style="margin-top:14px;">必要なものはひととおり入っています。</p>');
    },
    collect: () => {},
  },
];

function wizChildrenHtml() {
  let html = "";
  if (!wizChildren.length) {
    html += '<p class="note">子どもがいる場合は追加してください。</p>';
  }
  html += wizChildren.map((c, i) =>
    '<div class="field-row three" style="border-bottom:1px solid #2e3645;padding-bottom:6px;margin-bottom:10px;">' +
    fld("名前", inp("wc-name-" + i, "text", c.name, "例: 長男")) +
    fld("生まれた年", unitInp("wc-birth-" + i, c.birthYear, "年", "2020")) +
    fld("大学の進路", sel("wc-univ-" + i,
      D.EDUCATION_STAGES.find(s => s.key === "university").options, c.university)) +
    "</div>").join("");
  html += '<div class="btn-row"><button type="button" class="btn-sub" id="wc-add">＋ 子どもを追加</button>' +
    (wizChildren.length ? '<button type="button" class="btn-sub" id="wc-del">最後の1人を削除</button>' : "") +
    "</div>";
  return html;
}

function collectWizChildren() {
  wizChildren.forEach((c, i) => {
    if (!$("wc-name-" + i)) return;
    c.name = val("wc-name-" + i);
    c.birthYear = n(val("wc-birth-" + i), c.birthYear);
    c.university = val("wc-univ-" + i);
  });
}

function openWizard() {
  wizStep = 0;
  wizChildren = DATA.children.map(c => ({
    id: c.id, name: c.name, birthYear: c.birthYear,
    coursePlan: c.coursePlan || {},
    university: S.coursePlanFor(c, "university"),
  }));
  $("wizard-overlay").hidden = false;
  renderWizard();
}

function renderWizard() {
  const step = WIZ_STEPS[wizStep];
  $("wiz-steps").innerHTML = WIZ_STEPS.map((s, i) =>
    '<span class="' + (i === wizStep ? "active" : i < wizStep ? "done" : "") + '">' +
    (i + 1) + ". " + esc(s.title) + "</span>").join("");
  $("wiz-body").innerHTML = "<h3>" + esc(step.title) + "</h3>" +
    (step.note ? '<p class="note">' + esc(step.note) + "</p>" : "") + step.render();
  $("wiz-prev").disabled = wizStep === 0;
  $("wiz-next").textContent = wizStep === WIZ_STEPS.length - 1 ? "完了" : "次へ";

  if (wizStep === 2) renderWizardChildHandlers(step);
}

function renderWizardChildHandlers(step) {
  const add = $("wc-add"), del = $("wc-del");
  if (add) add.onclick = () => {
    collectWizChildren();
    wizChildren.push({
      id: uid(), name: "", birthYear: new Date().getFullYear(),
      coursePlan: {}, university: "national",
    });
    redrawWizChildren(step);
  };
  if (del) del.onclick = () => {
    collectWizChildren();
    wizChildren.pop();
    redrawWizChildren(step);
  };
}

function redrawWizChildren(step) {
  $("wiz-body").innerHTML = "<h3>" + esc(step.title) + "</h3>" +
    '<p class="note">' + esc(step.note) + "</p>" + wizChildrenHtml();
  renderWizardChildHandlers(step);
}

function setupWizard() {
  $("wiz-next").addEventListener("click", () => {
    WIZ_STEPS[wizStep].collect();
    if (wizStep === WIZ_STEPS.length - 1) {
      $("wizard-overlay").hidden = true;
      save();
      document.querySelector('.tab-btn[data-tab="sim"]').click();
      return;
    }
    wizStep++;
    save();
    renderWizard();
  });
  $("wiz-prev").addEventListener("click", () => {
    if (wizStep === 0) return;
    WIZ_STEPS[wizStep].collect();
    wizStep--;
    save();
    renderWizard();
  });
  $("wiz-close").addEventListener("click", () => {
    WIZ_STEPS[wizStep].collect();
    $("wizard-overlay").hidden = true;
    save();
  });
}

/* ================= 初期化 ================= */

function renderAll() {
  renderSim();
  renderPolicies();
  if (!viewMode) {
    renderAssumptions();
    renderSettings();
  }
}

function init() {
  DATA = load();
  setupTabs();
  applyViewMode();

  if (!viewMode) {
    setupSliders();
    setupSettings();
    setupWizard();
    bindAssumptionInputs();

    $("add-policy").addEventListener("click", () => openPolicyDialog(null));
    $("add-company").addEventListener("click", () => openCompanyDialog(null));
    $("add-child").addEventListener("click", () => openChildDialog(null));
    $("add-asset").addEventListener("click", () => openAssetDialog(null));
    $("add-public").addEventListener("click", () => openPublicDialog(null));
    $("reset-public").addEventListener("click", () => {
      if (!confirm("公的給付の一覧を、よくある3つの雛形に並べ直します。今の内容は消えます。")) return;
      DATA.publicBenefits = D.PUBLIC_BENEFIT_TEMPLATES.map(t => Object.assign({ id: uid() }, t));
      save();
    });
    $("start-wizard").addEventListener("click", openWizard);
    $("start-wizard-2").addEventListener("click", openWizard);

    /* 表を丸ごと描き直すと入力欄からフォーカスが外れた瞬間に壊れるので、
       ここではバッジだけを書き換える。 */
    $("edu-table").addEventListener("change", e => {
      const key = e.target.dataset && e.target.dataset.edu;
      if (!key) return;
      const ovs = DATA.household.educationCostOverrides;
      if (e.target.value === "") delete ovs[key];
      else ovs[key] = n(e.target.value);
      persist();
      refreshEduBadge(key);
      renderSim();
    });
  }

  /* ダイアログは詳細表示にも使うので、閲覧モードでも動かす */
  $("dialog-cancel").addEventListener("click", closeDialog);
  $("dialog-save").addEventListener("click", () => { if (dialogSave) dialogSave(); });
  $("dialog-delete").addEventListener("click", () => { if (dialogDelete) dialogDelete(); });
  $("dialog-overlay").addEventListener("click", e => { if (e.target.id === "dialog-overlay") closeDialog(); });

  document.body.addEventListener("click", e => {
    const t = e.target;
    if (!t.dataset) return;
    if (t.dataset.detailPolicy) openPolicyDetail(DATA.policies.find(x => x.id === t.dataset.detailPolicy));
    if (t.dataset.editPolicy) openPolicyDialog(DATA.policies.find(x => x.id === t.dataset.editPolicy));
    if (t.dataset.editCompany) openCompanyDialog(DATA.companyBenefits.find(x => x.id === t.dataset.editCompany));
    if (t.dataset.editChild) openChildDialog(DATA.children.find(x => x.id === t.dataset.editChild));
    if (t.dataset.editAsset) openAssetDialog(DATA.assets.find(x => x.id === t.dataset.editAsset));
    if (t.dataset.editPublic) openPublicDialog(DATA.publicBenefits.find(x => x.id === t.dataset.editPublic));
  });

  /* 閲覧モードはハッシュで切り替わるので、変わったら読み込み直す */
  window.addEventListener("hashchange", () => location.reload());

  /* 他の端末から同期で届いたとき */
  window.addEventListener("hoken:remote", () => {
    DATA = load();
    renderAll();
  });

  renderAll();

  /* 前提が入っていなければウィザードを開く */
  if (!viewMode && !isSetUp()) openWizard();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
