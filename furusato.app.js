/* ふるさと納税シート — 画面とデータ操作
 *
 * データの唯一の出所は localStorage["furusato-log-v1"] の配列。
 * 記録は k で種類が分かれる（money-log と同じ考え方）。
 *   {k:"donation", id, year, date, municipality, item, amount, oneStop, site, note}
 *   {k:"income",   id, year, month, salary, bonus, insurance}
 *   {k:"household",id, year, hasSpouse, spouseAnnualIncome, hasUnder23Dependent, dependents}
 *
 * 金額はすべて「円」で保存。入力欄は項目に応じて万円で受け取り、保存前に変換する。
 * 同期は共通の sync.js。SYNC_FINGERPRINT に r.id を指定しているので、
 * 端末間の和集合マージは id 単位（money-log と同じ方式）。
 */

const STORAGE_KEY = "furusato-log-v1";
const D = FURUSATO_DATA;
const S = FURUSATO_SIM;

let RECORDS = [];
let YEAR = new Date().getFullYear();

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function n(v, fb) { const x = Number(v); return Number.isFinite(x) ? x : (fb === undefined ? 0 : fb); }
function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
function yenStr(v) { return n(v).toLocaleString("ja-JP") + "円"; }
function man(yen) {
  const v = n(yen) / 10000;
  const rounded = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return rounded.toLocaleString("ja-JP");
}
function manYen(yen) { return man(yen) + "万円"; }

/* ================= データ ================= */

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn("データの読み込みに失敗しました", e);
    return [];
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(RECORDS));
  window.dispatchEvent(new CustomEvent("furusato:changed"));
}
function save() { persist(); renderAll(); }

function donationsOf(year) { return RECORDS.filter(r => r.k === "donation" && r.year === year); }
function incomeOf(year) { return RECORDS.filter(r => r.k === "income" && r.year === year); }
function householdOf(year) { return RECORDS.find(r => r.k === "household" && r.year === year); }

/* 呼び出し側で「新しく作ったか」を見分けられるよう、
   ensureHousehold と同じく戻り値に created を持たせている（下の理由を参照）。 */
function ensureHousehold(year) {
  let h = householdOf(year);
  if (h) return { record: h, created: false };
  // 直近の年の設定があれば引き継ぐ（毎年ゼロから入れ直さなくていいように）
  const prior = RECORDS.filter(r => r.k === "household" && r.year < year).sort((a, b) => b.year - a.year)[0];
  h = prior
    ? Object.assign({}, prior, { id: "household-" + year, year })
    : { k: "household", id: "household-" + year, year, hasSpouse: false, spouseAnnualIncome: 0,
        hasUnder23Dependent: false, dependents: { general: 0, specific: 0, elderlyWith: 0, elderlyOther: 0 } };
  RECORDS.push(h);
  return { record: h, created: true };
}

/* 新しく行を作ったときだけ true を返す。
   呼び出し側（init / onYearChange）はこれが false なら persist() を呼ばない。
   何もローカルで変わっていないのに毎回 "furusato:changed" を発火すると、
   sync.js が同期コード接続直後の和集合マージを終える前にこの端末の（まだ他端末の分を
   取り込んでいない）ローカルデータで上書き push してしまう競合が起きるため
   （実際にPCとスマホの内容が食い違う形で発生した。詳細は第10章）。 */
function ensureIncomeRows(year) {
  let created = false;
  for (let m = 1; m <= 12; m++) {
    const id = "income-" + year + "-" + m;
    if (!RECORDS.some(r => r.id === id)) {
      RECORDS.push({ k: "income", id, year, month: m, salary: 0, bonus: 0, insurance: 0 });
      created = true;
    }
  }
  return created;
}

/* ================= 年の切り替え ================= */

function setupYearNav() {
  $("year-prev").addEventListener("click", () => { YEAR--; onYearChange(); });
  $("year-next").addEventListener("click", () => { YEAR++; onYearChange(); });
}
function onYearChange() {
  $("year-label").textContent = YEAR + "年";
  const createdIncome = ensureIncomeRows(YEAR);
  const { created: createdHousehold } = ensureHousehold(YEAR);
  /* 何も新しく作っていなければ persist() しない（変わっていないデータで
     "furusato:changed" を発火すると、同期の初回マージと競合するため。理由は下の関数を参照）。 */
  if (createdIncome || createdHousehold) persist();
  renderAll();
}

/* ================= 上限額タブ ================= */

function renderLimit() {
  const { record: h } = ensureHousehold(YEAR);
  $("h-spouse").checked = !!h.hasSpouse;
  $("h-spouse-income").value = h.spouseAnnualIncome ? h.spouseAnnualIncome / 10000 : "";
  $("h-spouse-income-field").hidden = !h.hasSpouse;
  $("h-under23").checked = !!h.hasUnder23Dependent;
  const dep = h.dependents || {};
  $("h-dep-general").value = dep.general || "";
  $("h-dep-specific").value = dep.specific || "";
  $("h-dep-elderly-with").value = dep.elderlyWith || "";
  $("h-dep-elderly-other").value = dep.elderlyOther || "";

  const incomeSum = S.incomeSummary(RECORDS.filter(r => r.k === "income"), YEAR);
  const donationSum = S.donationSummary(RECORDS.filter(r => r.k === "donation"), YEAR);

  const household = {
    hasSpouse: h.hasSpouse, spouseAnnualIncome: h.spouseAnnualIncome,
    hasUnder23Dependent: h.hasUnder23Dependent, dependents: h.dependents,
  };
  const income = { salary: incomeSum.salary, bonus: incomeSum.bonus, insurance: incomeSum.insurance };
  const result = S.calcLimit(income, household);
  const remaining = result.limit - donationSum.total;

  const partial = incomeSum.monthsEntered < 12;

  const noIncome = incomeSum.salary === 0 && incomeSum.bonus === 0;
  if (noIncome) {
    $("summary-grid").innerHTML = [
      box("上限額の目安", "―", "「収入・保険料」タブに入力すると計算されます", ""),
      box("今年の寄付累計", man(donationSum.total), donationSum.count + "件・" + donationSum.municipalityCount + "自治体", ""),
      box("あと寄付できる目安", "―", "", ""),
    ].join("");
  } else {
    $("summary-grid").innerHTML = [
      box("上限額の目安", man(result.limit), partial ? "入力済み" + incomeSum.monthsEntered + "か月分から算出" : "年間の見込み額", ""),
      box("今年の寄付累計", man(donationSum.total), donationSum.count + "件・" + donationSum.municipalityCount + "自治体", ""),
      box("あと寄付できる目安", man(Math.max(0, remaining)), remaining < 0 ? "上限を超えています" : "実質2,000円で収まる範囲", remaining < 0 ? "bad" : "good"),
    ].join("");
  }

  $("calc-detail").innerHTML = detailTable(result, incomeSum);
}

function box(labelText, value, hint, cls) {
  const unit = value === "―" ? "" : '<span class="unit">万円</span>';
  return '<div class="summary-box ' + cls + '">' +
    '<div class="label">' + esc(labelText) + "</div>" +
    '<div class="value">' + esc(value) + unit + "</div>" +
    '<div class="hint">' + esc(hint) + "</div></div>";
}

function detailTable(r, incomeSum) {
  const rows = [
    ["給与収入（給与＋ボーナス）", yenStr(r.grossIncome)],
    ["　うち社会保険料控除", yenStr(r.insurance)],
    ["給与所得控除", yenStr(r.employmentDeduction)],
    ["給与所得", yenStr(r.employmentIncome)],
    ["所得金額調整控除", yenStr(r.adjustment)],
    ["合計所得金額", yenStr(r.incomeAfterAdjustment)],
    ["所得税の控除（基礎/配偶者/扶養）", yenStr(r.deductions.income.basic) + " / " + yenStr(r.deductions.income.spouse) + " / " + yenStr(r.deductions.income.dependents)],
    ["住民税の控除（基礎/配偶者/扶養）", yenStr(r.deductions.resident.basic) + " / " + yenStr(r.deductions.resident.spouse) + " / " + yenStr(r.deductions.resident.dependents)],
    ["所得税の課税所得・税率", yenStr(r.taxableIncomeTax) + "　（税率 " + Math.round(r.incomeTaxRate * 100) + "%）"],
    ["住民税の課税所得", yenStr(r.taxableResident)],
    ["住民税の調整控除", yenStr(r.residentAdjustment)],
    ["住民税所得割額", yenStr(r.residentIncomeLevy)],
  ];
  return '<table><tbody>' +
    rows.map(row => "<tr><td>" + esc(row[0]) + '</td><td class="num">' + row[1] + "</td></tr>").join("") +
    "</tbody></table>";
}

function bindHouseholdInputs() {
  const ids = ["h-spouse", "h-spouse-income", "h-under23", "h-dep-general", "h-dep-specific", "h-dep-elderly-with", "h-dep-elderly-other"];
  ids.forEach(id => $(id).addEventListener("change", pullHousehold));
  $("h-spouse").addEventListener("change", () => { $("h-spouse-income-field").hidden = !$("h-spouse").checked; });
}
function pullHousehold() {
  const { record: h } = ensureHousehold(YEAR);
  h.hasSpouse = $("h-spouse").checked;
  h.spouseAnnualIncome = Math.round(n($("h-spouse-income").value) * 10000);
  h.hasUnder23Dependent = $("h-under23").checked;
  h.dependents = {
    general: n($("h-dep-general").value), specific: n($("h-dep-specific").value),
    elderlyWith: n($("h-dep-elderly-with").value), elderlyOther: n($("h-dep-elderly-other").value),
  };
  save();
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
function unitInp(id, value, unit, placeholder) {
  return '<div class="input-unit">' + inp(id, "number", value, placeholder) +
    '<span class="unit">' + esc(unit) + "</span></div>";
}
function sel(id, options, value) {
  return '<select id="' + id + '">' + options.map(o =>
    '<option value="' + esc(o.key) + '"' + (o.key === value ? " selected" : "") + ">" +
    esc(o.label) + "</option>").join("") + "</select>";
}
function val(id) { const el = $(id); return el ? el.value : ""; }

/* ================= ダイアログ ================= */

let dialogSave = null, dialogDelete = null;

function openDialog(opts) {
  $("dialog-title").textContent = opts.title;
  $("dialog-body").innerHTML = opts.body;
  $("dialog-delete").hidden = !opts.onDelete;
  dialogSave = opts.onSave;
  dialogDelete = opts.onDelete;
  $("dialog-overlay").hidden = false;
  if (opts.after) opts.after();
}
function closeDialog() {
  $("dialog-overlay").hidden = true;
  dialogSave = null; dialogDelete = null;
}

/* ================= 寄付記録タブ ================= */

function renderDonations() {
  const sum = S.donationSummary(RECORDS.filter(r => r.k === "donation"), YEAR);
  $("donation-summary").innerHTML = [
    box2("寄付件数", sum.count + "件", ""),
    box2("寄付先の自治体数", sum.municipalityCount + "自治体", sum.municipalityCount > 5 ? "5自治体を超えるとワンストップ特例が使えません" : "ワンストップの対象（5自治体以内）"),
    box2("ワンストップ手続き済み", sum.oneStopDone + " / " + sum.count + "件", ""),
  ].join("");

  const list = $("donation-list");
  if (!sum.rows.length) {
    list.innerHTML = '<p class="empty-note">' + YEAR + "年の寄付はまだ記録されていません。</p>";
    return;
  }
  const rows = sum.rows.slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  list.innerHTML = rows.map(d => {
    const site = D.FURUSATO_SITES.find(s => s.key === d.site);
    return '<div class="item"><div class="item-head">' +
      '<span class="name">' + esc(d.municipality || "自治体未入力") + "</span>" +
      '<span class="meta">' + manYen(d.amount) + "</span>" +
      (d.oneStop ? '<span class="badge ok">ワンストップ済</span>' : '<span class="badge warn">未実施</span>') +
      "</div>" +
      '<div class="item-body">' +
      (d.date ? d.date + "　" : "") + esc(d.item || "") +
      (site ? "　／　" + esc(site.label) : "") +
      (d.note ? "<br>" + esc(d.note) : "") +
      "</div>" +
      '<div class="item-actions"><button type="button" class="btn-sub" data-edit-donation="' +
      d.id + '">編集</button></div></div>';
  }).join("");
}

function box2(labelText, value, hint) {
  return '<div class="summary-box"><div class="label">' + esc(labelText) + "</div>" +
    '<div class="value" style="font-size:20px;">' + esc(value) + "</div>" +
    (hint ? '<div class="hint">' + esc(hint) + "</div>" : "") + "</div>";
}

function openDonationDialog(existing) {
  const d = existing ? Object.assign({}, existing) : {
    id: uid(), k: "donation", year: YEAR, date: YEAR + "-01-01",
    municipality: "", item: "", amount: 0, oneStop: true, site: "satofull", note: "",
  };
  const body =
    '<div class="field-row">' +
    fld("寄付日", inp("do-date", "date", d.date)) +
    fld("自治体名", inp("do-municipality", "text", d.municipality, "例: ○○県○○市")) +
    "</div>" +
    '<div class="field-row">' +
    fld("金額", unitInp("do-amount", d.amount ? d.amount / 10000 : "", "万円", "1")) +
    fld("申込サイト", sel("do-site", D.FURUSATO_SITES, d.site)) +
    "</div>" +
    fld("返礼品・購入したもの", inp("do-item", "text", d.item, "例: 米10kg")) +
    '<div class="field"><label class="check-row"><input type="checkbox" id="do-onestop"' +
    (d.oneStop ? " checked" : "") + "><span>ワンストップ特例の申請書を提出した（する予定）</span></label></div>" +
    fld("備考", inp("do-note", "text", d.note, "自由記入"));

  openDialog({
    title: existing ? "寄付を編集" : "寄付を記録",
    body: body,
    onSave: () => {
      const date = val("do-date");
      const saved = {
        id: d.id, k: "donation", year: date ? Number(date.slice(0, 4)) : YEAR,
        date: date, municipality: val("do-municipality"),
        amount: Math.round(n(val("do-amount")) * 10000),
        site: val("do-site"), item: val("do-item"),
        oneStop: $("do-onestop").checked, note: val("do-note"),
      };
      const i = RECORDS.findIndex(x => x.id === d.id);
      if (i >= 0) RECORDS[i] = saved; else RECORDS.push(saved);
      closeDialog(); save();
    },
    onDelete: existing ? () => {
      if (!confirm("この寄付の記録を削除します。よろしいですか？")) return;
      RECORDS = RECORDS.filter(x => x.id !== d.id);
      closeDialog(); save();
    } : null,
  });
}

/* ================= 収入・保険料タブ ================= */

const MONTH_LABELS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

function renderIncome() {
  ensureIncomeRows(YEAR);
  const rows = incomeOf(YEAR).slice().sort((a, b) => a.month - b.month);
  let html = '<table><thead><tr><th>月</th><th class="num">給与</th><th class="num">ボーナス</th>' +
    '<th class="num">社会保険料</th></tr></thead><tbody>';
  rows.forEach(r => {
    html += "<tr><td>" + MONTH_LABELS[r.month - 1] + "</td>" +
      '<td class="num"><input type="number" data-income="' + r.id + '" data-field="salary" value="' +
      (r.salary ? r.salary / 10000 : "") + '" placeholder="0" style="max-width:100px;text-align:right;"> 万円</td>' +
      '<td class="num"><input type="number" data-income="' + r.id + '" data-field="bonus" value="' +
      (r.bonus ? r.bonus / 10000 : "") + '" placeholder="0" style="max-width:100px;text-align:right;"> 万円</td>' +
      '<td class="num"><input type="number" data-income="' + r.id + '" data-field="insurance" value="' +
      (r.insurance ? r.insurance / 10000 : "") + '" placeholder="0" style="max-width:100px;text-align:right;"> 万円</td></tr>';
  });
  html += "</tbody></table>";
  $("income-table").innerHTML = html;

  const sum = S.incomeSummary(rows, YEAR);
  $("income-summary").innerHTML = [
    box2("給与年間合計", manYen(sum.salary), ""),
    box2("ボーナス年間合計", manYen(sum.bonus), ""),
    box2("社会保険料年間合計", manYen(sum.insurance), sum.monthsEntered + " / 12か月分入力済み"),
  ].join("");
}

function bindIncomeTable() {
  $("income-table").addEventListener("change", e => {
    const id = e.target.dataset && e.target.dataset.income;
    const field = e.target.dataset && e.target.dataset.field;
    if (!id || !field) return;
    const row = RECORDS.find(r => r.id === id);
    if (!row) return;
    row[field] = Math.round(n(e.target.value) * 10000);
    persist();
    renderLimit(); // 上限額タブの数字を裏で更新しておく
    const sum = S.incomeSummary(incomeOf(YEAR), YEAR);
    $("income-summary").innerHTML = [
      box2("給与年間合計", manYen(sum.salary), ""),
      box2("ボーナス年間合計", manYen(sum.bonus), ""),
      box2("社会保険料年間合計", manYen(sum.insurance), sum.monthsEntered + " / 12か月分入力済み"),
    ].join("");
  });
}

/* ================= 設定タブ ================= */

function setupSettings() {
  $("export-json").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(RECORDS, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "furusato-" + new Date().toISOString().slice(0, 10) + ".json";
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
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error("配列（レコードの一覧）ではありません");
        RECORDS = data;
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
    RECORDS = [];
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

/* ================= タブ切り替え ================= */

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

/* ================= 初期化 ================= */

function renderAll() {
  renderLimit();
  renderDonations();
  renderIncome();
}

function init() {
  RECORDS = load();
  const createdIncome = ensureIncomeRows(YEAR);
  const { created: createdHousehold } = ensureHousehold(YEAR);

  setupTabs();
  setupYearNav();
  bindHouseholdInputs();
  bindIncomeTable();
  setupSettings();

  $("year-label").textContent = YEAR + "年";

  $("add-donation").addEventListener("click", () => openDonationDialog(null));

  $("dialog-cancel").addEventListener("click", closeDialog);
  $("dialog-save").addEventListener("click", () => { if (dialogSave) dialogSave(); });
  $("dialog-delete").addEventListener("click", () => { if (dialogDelete) dialogDelete(); });
  $("dialog-overlay").addEventListener("click", e => { if (e.target.id === "dialog-overlay") closeDialog(); });

  document.body.addEventListener("click", e => {
    const t = e.target;
    if (!t.dataset) return;
    if (t.dataset.editDonation) openDonationDialog(RECORDS.find(x => x.id === t.dataset.editDonation));
  });

  window.addEventListener("furusato:remote", () => {
    RECORDS = load();
    renderAll();
  });

  /* 新しく行を作った（初回起動や年またぎ）ときだけ保存する。
     何も変わっていないのに毎回の起動で "furusato:changed" を発火すると、
     sync.js が同期コード接続直後にリモートと和集合マージを終える前に、
     この端末だけのデータで push してしまい、他端末の記録が消えて見えることがあった。
     詳しくは CLAUDE.md 第10章「起動のたびに同期が上書きされる」を参照。 */
  if (createdIncome || createdHousehold) persist();
  renderAll();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
