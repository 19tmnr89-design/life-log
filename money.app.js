/* ==========================================================================
   お金ログ — マイライフログ内アプリ
   ・データの唯一の出所は localStorage["money-log-v1"]（配列）
   ・sync.js（window.SYNC_APP = "money"）が Firestore と同期する
   ・口座名・カテゴリ・定例項目はコードに持たず、取り込んだ記録から組み立てる
     （このリポジトリは公開のため、個人情報をコードに置かない）
   ========================================================================== */

const KEY = "money-log-v1", FAV = "money-fav-v1";
const $ = id => document.getElementById(id);
const yen = n => n.toLocaleString("ja-JP");
const today = () => new Date().toISOString().slice(0, 10);
/* 8桁のランダムID。1万件規模なら衝突確率は 0.01% 未満。
   短くしているのは Firestore の 1MiB 制限に効くため（1万件で約80KB差）。 */
const uid = () => { let s = ""; for(let i = 0; i < 8; i++) s += (Math.random()*36|0).toString(36); return s; };

const recs = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
const put = a => { localStorage.setItem(KEY, JSON.stringify(a)); _map = null;
                   window.dispatchEvent(new CustomEvent("money:changed")); };

/* sync.js の和集合マージ用。筋トレ用の指紋では潰れてしまうので差し替える。
   同額・同カテゴリの記録が同じ日に複数あり得るので、内容ではなく id で判定する。 */
window.SYNC_FINGERPRINT = r => r.id || JSON.stringify(r);

/* ---- レコードの形 -------------------------------------------------------
   取引   {k:"t",  id, d:"YYYY-MM-DD", s:内容, m:円, n?:補足, t?:"i"（収入のときだけ）}
          大項目・中項目・リベ分類は内容から一意に決まるので、取引には持たせず
          分類マスタ {k:"map"} に1本だけ持つ。Firestore の 1MiB 制限対策。
   分類   {k:"map",id, v:{内容:[大項目, 中項目, リベ分類]}}
   資産   {k:"a",  id, d:"YYYY-MM-01", a:口座id, m:円}
   口座   {k:"acc",id, a:口座id, name, grp:表示区分, active:1|0, ord}
   目標   {k:"tgt",id, a:口座id, m:円}
   設定   {k:"cfg",id, key:"fixed", pin:[内容], hide:[内容]}
   ------------------------------------------------------------------------ */

let _map = null;
function clsMap(){
  if(!_map){ const r = recs().find(x => x.k === "map"); _map = (r && r.v) || {}; }
  return _map;
}
/* 取引レコードから 種別/大項目/中項目/リベ分類 を取り出す（古い形の c,g,f も読める） */
const rType = r => r.t || "e";
function cls(r){
  if(rType(r) === "i") return ["収入", "収入", ""];
  const m = clsMap()[r.s];
  return [r.c || (m && m[0]) || "", r.g || (m && m[1]) || V, r.f || (m && m[2]) || M4];
}
const rCat = r => cls(r)[0], rKind = r => cls(r)[1], rFreq = r => cls(r)[2];
/* 新しい内容を使ったら分類マスタに覚えさせる */
function learn(a, sub, cat, kind, freq){
  if(!sub || !cat) return;
  let m = a.find(x => x.k === "map");
  if(!m){ m = { k:"map", id:uid(), v:{} }; a.push(m); }
  m.v[sub] = [cat, kind, freq];
}

const V = "消費（流動費）", F = "消費（固定費）", R = "浪費", T = "税金", K = "教育", I = "投資";
const M2 = "2.毎月・変動", M1 = "1.毎月・固定", M4 = "4.不定・変動", MI = "投資";

/* 取り込み前に使う汎用の初期セット（一般的な費目のみ） */
const SEED = {
  "食料":         [["食料品",V,M1],["外食",V,M2]],
  "雑貨・日用品":  [["日用品",V,M2]],
  "娯楽":         [["その他遊び",R,M2],["旅行",R,M4]],
  "交際費":       [["飲み会",R,M2],["プレゼント",R,M4]],
  "保健医療":     [["病院",V,M4],["薬",V,M4]],
  "交通":         [["電車代",V,M2],["ガソリン",V,M2]],
  "被服履物":     [["服",V,M2],["美容院",V,M2]],
  "教育":         [["本",K,M4]],
  "光熱水道通信":  [["電気代",F,M1],["ガス代",F,M1],["水道代",F,M1],["携帯",F,M1],["インターネット",F,M1]],
  "住居":         [["家賃",F,M1]],
  "個人保険":     [["生命保険",F,M1]],
  "税金社会保険料": [["社会保険料",T,M1],["所得税",T,M1],["住民税",T,M1]],
  "投資貯金":     [["積立投資",I,MI]]
};
const INCOME_SEED = ["給与", "賞与", "その他収入"];
const GRP_ORDER = ["現金","現金（固定）","自社株","国内株","米国株","全世界株","新興国株","その他"];
const HEX = ["#3987e5","#d95926","#199e70","#c98500","#d55181","#008300","#9085e9","#e66767"];
const SURFACE = "#1c1f2b";

/* ---- 状態 ---- */
let type = "e", digits = "", date = today(), lastIds = [], level1 = null;
let fMonth = today().slice(0, 7), chartMonths = 0, assetMode = "chart";
let searchQ = "";

const favs = () => { try { return JSON.parse(localStorage.getItem(FAV) || "{}"); } catch { return {}; } };
const bumpFav = n => { const f = favs(); f[n] = (f[n] || 0) + 1; localStorage.setItem(FAV, JSON.stringify(f)); };
const shiftMonth = (ym, n) => { const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
const wd = d => "日月火水木金土"[new Date(d + "T00:00").getDay()];

/* =========================================================================
   マスタ（記録から組み立てる）
   ========================================================================= */
function catTree(){
  const t = {}, f = favs();
  for(const [g, list] of Object.entries(SEED))
    t[g] = list.map(x => ({ s:x[0], g:x[1], f:x[2], n:(f[x[0]] || 0) }));
  for(const r of recs()){
    if(r.k !== "t" || rType(r) !== "e") continue;
    const [c, g, fr] = cls(r); if(!c) continue;
    (t[c] ||= []);
    let e = t[c].find(x => x.s === r.s);
    if(!e){ e = { s:r.s, g, f:fr, n:(f[r.s] || 0) }; t[c].push(e); }
    e.n++;
  }
  for(const k in t) t[k].sort((a, b) => b.n - a.n);
  return t;
}
/* 大項目をまたいで、内容を使用頻度順に平らに並べる（1段目の「よく使う」と検索用） */
function allItems(){
  const t = catTree(), out = [];
  for(const [c, list] of Object.entries(t)) list.forEach(x => out.push({ ...x, c }));
  return out.sort((a, b) => b.n - a.n);
}
function incomeItems(){
  const f = favs(), seen = new Map();
  INCOME_SEED.forEach(s => seen.set(s, { s, n:(f[s] || 0) }));
  for(const r of recs()){
    if(r.k !== "t" || rType(r) !== "i") continue;
    const e = seen.get(r.s) || { s:r.s, n:(f[r.s] || 0) };
    e.n++; seen.set(r.s, e);
  }
  return [...seen.values()].sort((a, b) => b.n - a.n);
}
function accounts(){
  return recs().filter(r => r.k === "acc").sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
}
function cfgFixed(){
  return recs().find(r => r.k === "cfg" && r.key === "fixed") || { pin:[], hide:[] };
}
/* 「定例」の判定
   直近12ヶ月を見て、毎月20日前後(18-22日)に出ていて、かつ月1回程度しか出ない項目。
   外食や食料品のように月に何度も記録する費目は、20日に出ていても定例には入れない。 */
function fixedItems(){
  const rs = recs().filter(r => r.k === "t").sort((a, b) => a.d.localeCompare(b.d));
  const cfg = cfgFixed();
  const last = rs.length ? rs[rs.length - 1].d.slice(0, 7) : today().slice(0, 7);
  const from = shiftMonth(last, -11) + "-01";
  const acc = new Map();
  for(const r of rs){
    const e = acc.get(r.s) || { months:new Set(), all:0, rec:r };
    if(r.d >= from){
      const day = +r.d.slice(8, 10);
      if(day >= 18 && day <= 22) e.months.add(r.d.slice(0, 7));
      e.all++;
    }
    e.rec = r; acc.set(r.s, e);
  }
  return [...acc.entries()]
    .filter(([s, e]) => {
      if(cfg.hide.includes(s)) return false;
      if(cfg.pin.includes(s)) return true;
      return e.months.size >= 10 && e.all <= e.months.size * 1.6;
    })
    .map(([s, e]) => e.rec);
}
const bucketOf = r => rType(r) === "i" ? "収入" : rKind(r) === T ? "税金・社会保険"
                    : rKind(r) === I ? "投資・貯蓄" : "固定費";
const BUCKETS = ["収入", "税金・社会保険", "固定費", "投資・貯蓄"];

/* =========================================================================
   入力画面
   ========================================================================= */
function renderAmt(){
  const v = +digits || 0;
  $("amt").textContent = yen(v);
  $("amt").classList.toggle("zero", v === 0);
  $("padAmt").textContent = yen(v) + " 円";
  document.querySelectorAll("#cats .tile").forEach(t => t.disabled = v === 0);
  const n = $("needAmt"); if(n) n.hidden = v > 0;
}
/* テンキーは金額を打つときだけ出す。出しっぱなしだとカテゴリが選べないため。 */
function padOpen(on){
  $("pad").classList.toggle("on", on);
  $("amtBtn").setAttribute("aria-expanded", on ? "true" : "false");
  $("amtHint").textContent = on ? "完了で閉じる" : "タップして入力";
}
$("amtBtn").addEventListener("click", () => padOpen(!$("pad").classList.contains("on")));
$("padDone").addEventListener("click", () => padOpen(false));
$("pad").addEventListener("click", e => {
  const b = e.target.closest("button"); if(!b) return;
  const k = b.dataset.k; if(!k) return;      // 「完了」ボタンは数字ではない
  if(k === "del") digits = digits.slice(0, -1);
  else if(digits.length < 8) digits = (digits + k).replace(/^0+(?=\d)/, "");
  renderAmt();
});
/* 日付は「‹ ›」で前後日、チップのタップで端末のカレンダーを開く。
   以前は非表示の input を作って showPicker() を呼んでいたが、iOS で開かなかった。 */
const shiftDay = (d, n) => {
  const t = new Date(d + "T00:00");
  t.setDate(t.getDate() + n);
  return t.getFullYear() + "-" + String(t.getMonth()+1).padStart(2,"0") + "-" + String(t.getDate()).padStart(2,"0");
};
function renderDate(){
  const [, m, d] = date.split("-");
  const isToday = date === today();
  $("dateLbl").textContent = isToday ? "今日" : `${+m}/${+d}（${wd(date)}）`;
  $("dateChip").classList.toggle("off", !isToday);
  $("dayToday").hidden = isToday;
  $("dateInput").value = date;
}
$("dateInput").addEventListener("change", e => { if(e.target.value){ date = e.target.value; renderDate(); } });
$("dayPrev").addEventListener("click", () => { date = shiftDay(date, -1); renderDate(); });
$("dayNext").addEventListener("click", () => { date = shiftDay(date, +1); renderDate(); });
$("dayToday").addEventListener("click", () => { date = today(); renderDate(); });
$("type").addEventListener("click", e => {
  const b = e.target.closest("button"); if(!b) return;
  type = b.dataset.t; level1 = null; searchQ = "";
  [...e.currentTarget.children].forEach(x => x.setAttribute("aria-pressed", x === b));
  renderCats();
});

const tilesHTML = (names, cls, lv1) => `<div class="tiles">` + names.map(n =>
  `<button class="tile ${cls}" data-n="${esc(n)}" data-lv1="${lv1 ? 1 : 0}">${esc(n)}</button>`).join("") + `</div>`;
const freeHTML = () => `<div class="freeform">
  <input id="freeName" placeholder="一覧にない内容を入力" autocomplete="off">
  <button id="freeSave">記録</button></div>`;
const needHTML = () => `<p class="needamt" id="needAmt">先に金額を入力してください</p>`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

/* 内容のタイル。大項目を data-c に持たせるので、押した時点で大項目も決まる。 */
const itemTilesHTML = (items, showCat) => `<div class="tiles">` + items.map(x =>
  `<button class="tile${x.g === I ? " inv" : ""}" data-n="${esc(x.s)}" data-c="${esc(x.c)}" data-lv1="0">${esc(x.s)}`
  + (showCat ? `<small>${esc(x.c)}</small>` : "") + `</button>`).join("") + `</div>`;
const searchHTML = () => `<div class="searchbox"><span class="ic">🔍</span>
  <input id="catSearch" placeholder="内容で探す（例: ケーキ）" autocomplete="off" value="${esc(searchQ)}">
  ${searchQ ? `<button class="clr" id="catClear" aria-label="消す">✕</button>` : ""}</div>`;

function renderCats(){
  const box = $("cats"), tree = catTree();
  if(type === "i"){
    box.innerHTML = tilesHTML(incomeItems().map(x => x.s), "inc") + freeHTML() + needHTML();
  } else if(!level1){
    const all = allItems(), q = searchQ.trim();
    if(q){
      const hits = all.filter(x => x.s.includes(q) || x.c.includes(q)).slice(0, 30);
      box.innerHTML = searchHTML()
        + (hits.length ? itemTilesHTML(hits, true)
                       : `<p class="needamt">「${esc(q)}」は見つかりませんでした。下の欄に入れると新しい内容として記録できます。</p>`)
        + `<h2 class="sec">大項目から選ぶ</h2>` + tilesHTML(Object.keys(tree), "lv1", true)
        + freeHTML() + needHTML();
    } else {
      /* 定例タブでまとめて入れる項目は、日々の入力では邪魔なので除く */
      const fixed = new Set(fixedItems().map(r => r.s));
      box.innerHTML = searchHTML()
        + `<h2 class="sec">よく使う</h2>` + itemTilesHTML(all.filter(x => !fixed.has(x.s)).slice(0, 12), true)
        + `<h2 class="sec">大項目から選ぶ</h2>` + tilesHTML(Object.keys(tree), "lv1", true)
        + needHTML();
    }
  } else {
    box.innerHTML = `<div class="crumb"><button id="back">‹ 大項目</button>
      <span class="now">${esc(level1)}</span><span class="step">2 / 2</span></div>`
      + itemTilesHTML((tree[level1] || []).map(x => ({ ...x, c:level1 })), false)
      + freeHTML() + needHTML();
    $("back").addEventListener("click", () => { level1 = null; renderCats(); });
  }
  renderAmt();
}
$("cats").addEventListener("click", e => {
  if(e.target.id === "catClear"){ searchQ = ""; renderCats(); return; }
  const b = e.target.closest(".tile");
  if(b && !b.disabled){
    if(b.dataset.lv1 === "1"){ level1 = b.dataset.n; renderCats(); return; }
    const name = b.dataset.n;
    if(type === "i") return commit(name, "収入", "収入", "");
    const cat = b.dataset.c || level1;
    const hit = (catTree()[cat] || []).find(x => x.s === name);
    return commit(name, cat, hit ? hit.g : V, hit ? hit.f : M4);
  }
  if(e.target.id === "freeSave") saveFree();
});
/* 検索欄。打つたびに絞り込むが、再描画してもフォーカスとカーソル位置は保つ。 */
$("cats").addEventListener("input", e => {
  if(e.target.id !== "catSearch") return;
  const pos = e.target.selectionStart;
  searchQ = e.target.value;
  renderCats();
  const el = $("catSearch");
  if(el){ el.focus(); try { el.setSelectionRange(pos, pos); } catch {} }
});
$("cats").addEventListener("keydown", e => { if(e.key === "Enter" && e.target.id === "freeName") saveFree(); });

function saveFree(){
  const name = ($("freeName").value || "").trim();
  if(!name) return;
  if(!+digits) return toast("先に金額を入力してください", false);
  if(type === "i") return commit(name, "収入", "収入", "");
  const known = allItems().find(x => x.s === name);     // 既にある内容なら大項目を引き継ぐ
  if(known) return commit(known.s, known.c, known.g, known.f);
  if(!level1) return toast("先に大項目を選んでください", false);
  commit(name, level1, level1 === "投資貯金" ? I : V, M4);
}
function commit(sub, cat, kind, freq){
  const rec = { k:"t", id:uid(), d:date, s:sub, m:+digits };
  if(type === "i") rec.t = "i";
  const memo = ($("memo").value || "").trim();
  if(memo) rec.n = memo;
  const a = recs(); a.push(rec);
  if(type === "e") learn(a, sub, cat, kind, freq);
  put(a);
  bumpFav(sub); lastIds = [rec.id];
  toast(`${sub} ${yen(rec.m)}円 を記録`, true);
  digits = ""; level1 = null; searchQ = ""; $("memo").value = "";
  padOpen(false);
  renderCats(); renderMonth();
}

/* =========================================================================
   定例
   ========================================================================= */
const numOf = el => +String(el.value).replace(/[^0-9]/g, "") || 0;
function lastAmount(sub, beforeYm){
  const rows = recs().filter(r => r.k === "t" && r.s === sub && r.d.slice(0, 7) < beforeYm)
                     .sort((a, b) => a.d.localeCompare(b.d));
  return rows.length ? rows[rows.length - 1].m : null;
}
function renderFixed(){
  const d = `${fMonth}-20`, [y, m] = fMonth.split("-");
  const done = recs().some(r => r.k === "t" && r.d === d);
  $("fMonth").innerHTML = `${y}/${m}<small>記録日 ${+m}/20</small>`;
  $("fixState").textContent = done ? "記録済み" : "未記録";
  const items = fixedItems();
  $("fHint").textContent = !items.length
    ? "まだ定例の項目がありません。毎月20日ごろに繰り返し記録している項目が自動でここに並びます。「定例に項目を追加」からも足せます。"
    : done ? "この月はすでに記録済みです。金額を直して押し直すと、この日付の記録を入れ替えます。"
    : "前に記録した金額が入っています。変わったところだけ直して、下のボタンでまとめて記録します。0 のままの項目は記録しません。";

  const cur = {};
  if(done) recs().filter(r => r.k === "t" && r.d === d).forEach(r => cur[r.s] = r.m);
  const byBucket = {};
  items.forEach(r => (byBucket[bucketOf(r)] ||= []).push(r));

  $("fixList").innerHTML = BUCKETS.filter(b => byBucket[b]).map(b => `
    <div class="grp2"><h3>${b}<em data-fsub="${esc(b)}">0 円</em></h3>` +
    byBucket[b].map(r => {
      const v = cur[r.s] != null ? cur[r.s] : (lastAmount(r.s, fMonth) ?? "");
      return `<div class="row">
        <span class="nm">${esc(r.s)}</span>
        <input type="text" inputmode="numeric" data-f="${esc(r.s)}" data-g="${esc(b)}" data-t="${rType(r)}"
               value="${v === "" ? "" : yen(v)}" placeholder="0">
        <span class="u">円</span>
        <button class="pin" data-hide="${esc(r.s)}" title="定例から外す">✕</button></div>`;
    }).join("") + `</div>`).join("");
  recalcFixed();
}
function recalcFixed(){
  const subs = {}; let inc = 0, exp = 0;
  document.querySelectorAll("#fixList input").forEach(i => {
    const v = numOf(i);
    subs[i.dataset.g] = (subs[i.dataset.g] || 0) + v;
    if(i.dataset.t === "i") inc += v; else exp += v;
  });
  document.querySelectorAll("[data-fsub]").forEach(el =>
    el.textContent = yen(subs[el.dataset.fsub] || 0) + " 円");
  const net = inc - exp;
  $("fNet").innerHTML = (net >= 0 ? "+" : "−") + yen(Math.abs(net)) + "<small>円</small>";
  $("fNet").className = "v " + (net >= 0 ? "up" : "down");
}
$("fixList").addEventListener("input", e => {
  if(e.target.matches("input")){ const n = numOf(e.target); e.target.value = n ? yen(n) : ""; }
  recalcFixed();
});
$("fixList").addEventListener("click", e => {
  const b = e.target.closest("[data-hide]"); if(!b) return;
  updateCfg(c => { c.hide = [...new Set([...c.hide, b.dataset.hide])];
                   c.pin = c.pin.filter(x => x !== b.dataset.hide); });
  renderFixed();
});
function updateCfg(fn){
  const a = recs();
  let c = a.find(r => r.k === "cfg" && r.key === "fixed");
  if(!c){ c = { k:"cfg", id:uid(), key:"fixed", pin:[], hide:[] }; a.push(c); }
  c.pin ||= []; c.hide ||= []; fn(c); put(a);
}
$("fPrev").addEventListener("click", () => { fMonth = shiftMonth(fMonth, -1); renderFixed(); });
$("fNext").addEventListener("click", () => { fMonth = shiftMonth(fMonth, +1); renderFixed(); });

$("addFixed").addEventListener("click", () => {
  const panel = $("addPanel");
  if(!panel.hidden){ panel.hidden = true; return; }
  const inList = new Set(fixedItems().map(r => r.s));
  const all = new Set();
  recs().forEach(r => { if(r.k === "t" && !inList.has(r.s)) all.add(r.s); });
  Object.values(catTree()).flat().forEach(x => { if(!inList.has(x.s)) all.add(x.s); });
  incomeItems().forEach(x => { if(!inList.has(x.s)) all.add(x.s); });
  panel.innerHTML = `<p class="hint">定例に加える項目を選んでください。</p>`
    + tilesHTML([...all], "");
  panel.hidden = false;
  panel.scrollIntoView({ behavior:"smooth", block:"nearest" });
});
$("addPanel").addEventListener("click", e => {
  const b = e.target.closest(".tile"); if(!b) return;
  updateCfg(c => { c.pin = [...new Set([...c.pin, b.dataset.n])];
                   c.hide = c.hide.filter(x => x !== b.dataset.n); });
  $("addPanel").hidden = true;
  renderFixed();
});

$("saveFixed").addEventListener("click", () => {
  const d = `${fMonth}-20`;
  const meta = {};
  fixedItems().forEach(r => meta[r.s] = r);
  const a = recs().filter(r => !(r.k === "t" && r.d === d));
  let n = 0;
  document.querySelectorAll("#fixList input").forEach(i => {
    const v = numOf(i); if(!v) return;
    const src = meta[i.dataset.f]; if(!src) return;
    const rec = { k:"t", id:uid(), d, s:src.s, m:v };
    if(rType(src) === "i") rec.t = "i";
    a.push(rec); n++;
  });
  put(a); lastIds = [];
  toast(`${fMonth.replace("-","/")} の定例 ${n}件を記録しました`, false);
  renderFixed(); renderMonth();
});

/* =========================================================================
   資産
   ========================================================================= */
$("assetMode").addEventListener("click", e => {
  const b = e.target.closest("button"); if(!b) return;
  assetMode = b.dataset.m;
  [...e.currentTarget.children].forEach(x => x.setAttribute("aria-pressed", x === b));
  $("assetChart").hidden = assetMode !== "chart";
  $("assetEdit").hidden = assetMode !== "edit";
  assetMode === "chart" ? renderChart() : renderAssetEdit();
});
function assetSeries(){
  const accs = accounts(), byId = {};
  accs.forEach(a => byId[a.a] = a);
  const byDate = {};
  for(const r of recs()){
    if(r.k !== "a") continue;
    const g = byId[r.a] ? byId[r.a].grp : "その他";
    (byDate[r.d] ||= {});
    byDate[r.d][g] = (byDate[r.d][g] || 0) + r.m;
  }
  const dates = Object.keys(byDate).sort();
  const order = GRP_ORDER.filter(g => dates.some(d => byDate[d][g]));
  return { dates, order, byDate,
           total: dates.map(d => Object.values(byDate[d]).reduce((s, v) => s + v, 0)) };
}
/* 資産は月1回の入力なので、今月ぶんを入れたかどうかが一目で分かるようにする */
function assetMonthState(){
  const cur = today().slice(0, 7);
  const rows = recs().filter(r => r.k === "a");
  const months = [...new Set(rows.map(r => r.d.slice(0, 7)))].sort();
  return {
    cur,
    done: rows.some(r => r.d === cur + "-01"),
    prev: months.filter(m => m < cur).pop() || null
  };
}
const jpMonth = ym => { const [y, m] = ym.split("-"); return `${y}年${+m}月`; };
function renderAssetHeader(){
  const { cur, done } = assetMonthState();
  $("asOf").innerHTML = `${+cur.slice(5)}月<span class="badge ${done ? "done" : "todo"}">`
    + (done ? "入力済み" : "未入力") + `</span>`;
}
function renderChart(){
  renderAssetHeader();
  const S = assetSeries();
  if(!S.dates.length){
    $("stats").innerHTML = "";
    $("chart").innerHTML = "";
    $("breakdown").innerHTML = `<p class="empty">資産の記録がまだありません。<br>「残高を入力」から入れるか、データタブでCSVを取り込んでください。</p>`;
    $("legend").innerHTML = ""; $("breakCap").textContent = "";
    return;
  }
  const n = S.total.length, cur = S.total[n - 1];
  const prev = S.total[n - 2] ?? cur, yoyI = Math.max(0, n - 13), yoy = S.total[yoyI];
  const man = v => yen(Math.round(v / 10000));
  const sign = v => (v >= 0 ? "+" : "−") + man(Math.abs(v));
  const tgt = recs().filter(r => r.k === "tgt").reduce((s, r) => s + r.m, 0);
  $("stats").innerHTML = `
    <div class="stat"><div class="lab">総資産</div><div class="val">${man(cur)}<span class="u">万円</span></div>
      <div class="note">${S.dates[n-1].slice(0,7).replace("-","/")} 時点</div></div>
    <div class="stat"><div class="lab">前月差</div>
      <div class="val ${cur-prev>=0?"up":"down"}">${sign(cur-prev)}<span class="u">万円</span></div>
      <div class="note">${S.dates[n-2] ? S.dates[n-2].slice(0,7).replace("-","/") + " 比" : "—"}</div></div>
    <div class="stat"><div class="lab">前年同月差</div>
      <div class="val ${cur-yoy>=0?"up":"down"}">${sign(cur-yoy)}<span class="u">万円</span></div>
      <div class="note">${S.dates[yoyI].slice(0,7).replace("-","/")} 比</div></div>` +
    (tgt ? `<div class="stat"><div class="lab">2027年 目標</div>
      <div class="val">${Math.round(cur/tgt*100)}<span class="u">%</span></div>
      <div class="note">目標 ${man(tgt)} 万円</div></div>` : "");

  $("legend").innerHTML = S.order.map((g, i) =>
    `<span><i style="background:${HEX[i % 8]}"></i>${esc(g)}</span>`).join("");
  $("breakCap").textContent = S.dates[n - 1].slice(0, 7).replace("-", "/") + " 時点";
  const tgtBy = {}; const accById = {};
  accounts().forEach(a => accById[a.a] = a);
  recs().filter(r => r.k === "tgt").forEach(r => {
    const g = accById[r.a] ? accById[r.a].grp : "その他";
    tgtBy[g] = (tgtBy[g] || 0) + r.m;
  });
  $("breakdown").innerHTML = S.order.map((g, i) => {
    const v = S.byDate[S.dates[n - 1]][g] || 0; if(!v) return "";
    return `<div class="row"><span class="nm"><i class="dot" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${HEX[i%8]};margin-right:8px"></i>${esc(g)}</span>
      <span class="dlt" style="width:auto;font-size:12px;color:var(--sub)">${(v/cur*100).toFixed(1)}%</span>
      <span style="font-weight:700;font-variant-numeric:tabular-nums;min-width:64px;text-align:right">${man(v)}</span>
      <span class="u">万円</span></div>`;
  }).join("");
  drawChart(S);
}

let hot = null;
function chartBox(){
  const narrow = window.innerWidth < 480;
  return narrow ? { W:520, H:390, P:{ t:12, r:48, b:26, l:46 } }
                : { W:860, H:400, P:{ t:14, r:62, b:28, l:54 } };
}
function drawChart(S){
  const svg = $("chart");
  const { W, H, P } = chartBox();
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const from = chartMonths ? Math.max(0, S.dates.length - chartMonths) : 0;
  const dates = S.dates.slice(from), total = S.total.slice(from);
  const series = S.order.map(g => dates.map(d => S.byDate[d][g] || 0));
  const n = dates.length;
  if(n < 2){ svg.innerHTML = ""; return; }
  const t = dates.map(d => Date.parse(d)), x0 = t[0], x1 = t[n - 1];
  const yMax = Math.max(...total) * 1.06 || 1;
  const X = v => P.l + (v - x0) / (x1 - x0) * (W - P.l - P.r);
  const Y = v => H - P.b - v / yMax * (H - P.t - P.b);
  const cum = [];
  for(let i = 0; i < n; i++){ let a = 0; cum.push(S.order.map((_, s) => a += series[s][i])); }

  let g = "";
  const step = Math.pow(10, Math.floor(Math.log10(yMax / 4)));
  const tick = [1,2,2.5,5,10].map(s => s * step).find(s => s >= yMax / 4) || 10 * step;
  for(let v = 0; v <= yMax; v += tick){
    g += `<line x1="${P.l}" y1="${Y(v).toFixed(1)}" x2="${W-P.r}" y2="${Y(v).toFixed(1)}" stroke="var(--grid)" stroke-width="1"/>`
      +  `<text x="${P.l-9}" y="${(Y(v)+4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="var(--dim)" style="font-variant-numeric:tabular-nums">${yen(Math.round(v/10000))}</text>`;
  }
  g += `<text x="${P.l-9}" y="${P.t-2}" text-anchor="end" font-size="10" fill="var(--dim)">万円</text>`;
  for(let s = S.order.length - 1; s >= 0; s--){
    let d = `M ${X(t[0]).toFixed(1)} ${Y(cum[0][s]).toFixed(1)}`;
    for(let i = 1; i < n; i++) d += ` L ${X(t[i]).toFixed(1)} ${Y(cum[i][s]).toFixed(1)}`;
    d += ` L ${X(t[n-1]).toFixed(1)} ${Y(0).toFixed(1)} L ${X(t[0]).toFixed(1)} ${Y(0).toFixed(1)} Z`;
    g += `<path d="${d}" fill="${HEX[s % 8]}"/>`;
  }
  for(let s = 0; s < S.order.length - 1; s++){
    let d = `M ${X(t[0]).toFixed(1)} ${Y(cum[0][s]).toFixed(1)}`;
    for(let i = 1; i < n; i++) d += ` L ${X(t[i]).toFixed(1)} ${Y(cum[i][s]).toFixed(1)}`;
    g += `<path d="${d}" fill="none" stroke="${SURFACE}" stroke-width="2" stroke-linejoin="round"/>`;
  }
  let dT = `M ${X(t[0]).toFixed(1)} ${Y(total[0]).toFixed(1)}`;
  for(let i = 1; i < n; i++) dT += ` L ${X(t[i]).toFixed(1)} ${Y(total[i]).toFixed(1)}`;
  g += `<path d="${dT}" fill="none" stroke="var(--text)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  g += `<line x1="${P.l}" y1="${Y(0)}" x2="${W-P.r}" y2="${Y(0)}" stroke="var(--baseline)" stroke-width="1"/>`;
  const xs = Math.max(1, Math.round(n / 6));
  for(let i = 0; i < n; i += xs)
    g += `<text x="${X(t[i]).toFixed(1)}" y="${H-P.b+16}" text-anchor="middle" font-size="10.5" fill="var(--dim)">${dates[i].slice(0,7).replace("-","/")}</text>`;
  const last = cum[n - 1];
  for(let s = 0; s < S.order.length; s++){
    const v = series[s][n - 1]; if(v / total[n - 1] < 0.05) continue;
    const mid = (last[s] + (s ? last[s-1] : 0)) / 2;
    g += `<text x="${W-P.r+7}" y="${(Y(mid)+3.5).toFixed(1)}" font-size="10" fill="var(--sub)">${esc(S.order[s])}</text>`;
  }
  g += `<g id="hov"></g><rect x="${P.l}" y="${P.t}" width="${W-P.l-P.r}" height="${H-P.t-P.b}" fill="transparent" id="hit"/>`;
  svg.innerHTML = g;
  hot = { dates, total, series, order:S.order, t, X, Y, n, W, H, P };
  const hit = svg.querySelector("#hit");
  hit.addEventListener("pointermove", onHover);
  hit.addEventListener("pointerleave", () => {
    $("tip").style.opacity = 0; svg.querySelector("#hov").innerHTML = "";
  });
}
function onHover(e){
  const { dates, total, series, order, t, X, Y, n, W, H, P } = hot;
  const svg = $("chart"), tip = $("tip"), card = svg.parentElement;
  const r = svg.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width * W;
  let best = 0, bd = Infinity;
  for(let i = 0; i < n; i++){ const d = Math.abs(X(t[i]) - px); if(d < bd){ bd = d; best = i; } }
  const cx = X(t[best]);
  svg.querySelector("#hov").innerHTML =
    `<line x1="${cx}" y1="${P.t}" x2="${cx}" y2="${H-P.b}" stroke="var(--sub)" stroke-width="1" stroke-dasharray="3 3"/>`
  + `<circle cx="${cx}" cy="${Y(total[best])}" r="5" fill="var(--text)" stroke="${SURFACE}" stroke-width="2"/>`;
  const man = v => yen(Math.round(v / 10000));
  tip.innerHTML = `<div class="d">${dates[best].slice(0,7).replace("-","/")}</div>
    <div class="t"><span>総資産</span><span>${man(total[best])} 万円</span></div>` +
    order.map((g, s) => series[s][best] ? `<div class="r"><em><i style="background:${HEX[s%8]}"></i>${esc(g)}</em><b>${man(series[s][best])}</b></div>` : "").join("");
  tip.style.opacity = 1;
  const cw = card.getBoundingClientRect().width;
  const left = svg.getBoundingClientRect().left - card.getBoundingClientRect().left + cx / W * r.width;
  const want = left > cw * 0.55 ? left - tip.offsetWidth - 14 : left + 14;
  tip.style.left = Math.min(Math.max(6, want), cw - tip.offsetWidth - 6) + "px";
  tip.style.top = (svg.getBoundingClientRect().top - card.getBoundingClientRect().top + 8) + "px";
}
$("range").addEventListener("click", e => {
  const b = e.target.closest("button"); if(!b) return;
  [...e.currentTarget.children].forEach(x => x.setAttribute("aria-pressed", x === b));
  chartMonths = +b.dataset.m; renderChart();
});

function lastAssetSnapshot(){
  const rows = recs().filter(r => r.k === "a");
  if(!rows.length) return { date:null, map:{} };
  const d = rows.map(r => r.d).sort().pop();
  const map = {}; rows.filter(r => r.d === d).forEach(r => map[r.a] = r.m);
  return { date:d, map };
}
function renderAssetEdit(){
  renderAssetHeader();
  const accs = accounts().filter(a => a.active !== 0);
  const { date:d, map } = lastAssetSnapshot();
  const st = assetMonthState();
  $("assetState").innerHTML = st.done
    ? `<div class="stateline done">✅ <span><b>${jpMonth(st.cur)}分は入力済みです。</b>保存し直すと、この月の記録を入れ替えます。</span></div>`
    : `<div class="stateline todo">📝 <span><b>${jpMonth(st.cur)}分はまだ入力していません。</b>`
      + (st.prev ? `前回の入力は ${jpMonth(st.prev)} です。` : "") + `</span></div>`;
  $("saveAssets").textContent = `${jpMonth(st.cur)}分として保存`;
  $("aHint").textContent = !accs.length
    ? "口座がまだ登録されていません。データタブで money_accounts.csv を取り込んでください。"
    : d ? "前回入力した値が入っています。変わった口座だけ上書きして保存してください。単位は万円です。"
        : "口座ごとの残高を万円で入力してください。次からは前回の値が入った状態で開きます。";
  const groups = {};
  accs.forEach(a => (groups[a.grp] ||= []).push(a));
  $("accList").innerHTML = GRP_ORDER.filter(g => groups[g]).map(g => `
    <div class="grp2"><h3>${esc(g)}<em data-sub="${esc(g)}">0 万円</em></h3>` +
    groups[g].map(a => {
      const man = map[a.a] != null ? Math.round(map[a.a] / 10000) : "";
      return `<div class="row man"><span class="nm">${esc(a.name)}</span>
        <input type="number" inputmode="numeric" data-a="${esc(a.a)}" data-cat="${esc(g)}" value="${man}" placeholder="0">
        <span class="u">万円</span><span class="dlt" data-d="${esc(a.a)}"></span></div>`;
    }).join("") + `</div>`).join("");
  recalcAssets();
}
function recalcAssets(){
  const { map } = lastAssetSnapshot();
  let sum = 0; const subs = {};
  document.querySelectorAll("#accList input").forEach(inp => {
    const v = +inp.value || 0; sum += v;
    subs[inp.dataset.cat] = (subs[inp.dataset.cat] || 0) + v;
    const prev = map[inp.dataset.a] != null ? Math.round(map[inp.dataset.a] / 10000) : null;
    const el = document.querySelector(`[data-d="${CSS.escape(inp.dataset.a)}"]`);
    if(!el) return;
    if(prev == null || prev === v){ el.textContent = ""; el.className = "dlt flat"; }
    else { const dv = v - prev; el.textContent = (dv > 0 ? "+" : "−") + yen(Math.abs(dv));
           el.className = "dlt " + (dv > 0 ? "up" : "down"); }
  });
  document.querySelectorAll("[data-sub]").forEach(el =>
    el.textContent = yen(subs[el.dataset.sub] || 0) + " 万円");
  $("aTotal").innerHTML = yen(sum) + "<small>万円</small>";
}
$("accList").addEventListener("input", recalcAssets);
$("saveAssets").addEventListener("click", () => {
  const d = today().slice(0, 8) + "01";
  const a = recs().filter(r => !(r.k === "a" && r.d === d));
  document.querySelectorAll("#accList input").forEach(inp =>
    a.push({ k:"a", id:uid(), d, a:inp.dataset.a, m:(+inp.value || 0) * 10000 }));
  put(a); lastIds = [];
  toast(`${d.slice(0,7).replace("-","/")} の残高を保存しました`, false);
  renderAssetEdit();
});

/* =========================================================================
   履歴
   ========================================================================= */
function renderLog(){
  /* 同じ日付の中は取り込み順のまま（JSのsortは安定なので入れ替わらない） */
  const rs = recs().filter(r => r.k === "t").reverse().sort((a, b) => b.d.localeCompare(a.d));
  $("logCount").textContent = rs.length ? `${yen(rs.length)}件` : "";
  if(!rs.length){
    $("logBody").innerHTML = `<p class="empty">まだ記録がありません。<br>入力タブで金額を打ち、内容を選ぶと保存されます。</p>`;
    return;
  }
  let html = "", cur = "";
  for(const r of rs.slice(0, 300)){
    if(r.d !== cur){
      cur = r.d;
      const sum = rs.filter(x => x.d === cur && rType(x) === "e").reduce((s, x) => s + x.m, 0);
      html += `<div class="day">${cur.replace(/-/g,"/")}（${wd(cur)}）　支出 ${yen(sum)}円</div>`;
    }
    const col = rType(r) === "i" ? "var(--income)" : rKind(r) === I ? "var(--invest)" : "var(--accent)";
    html += `<div class="rec" data-e="${esc(r.id)}" role="button" tabindex="0">
      <span class="dot" style="background:${col}"></span>
      <span class="t"><b>${esc(r.s)}</b><small>${esc(rCat(r))}${r.n ? " ・ " + esc(r.n) : ""}</small></span>
      <span class="m">${rType(r) === "i" ? "+" : ""}${yen(r.m)}</span>
      <span class="x" aria-hidden="true">›</span></div>`;
  }
  $("logBody").innerHTML = html;
  if(rs.length > 300) $("logBody").insertAdjacentHTML("beforeend",
    `<p class="hint" style="text-align:center;margin-top:14px">直近300件を表示しています</p>`);
}
$("logBody").addEventListener("click", e => {
  const row = e.target.closest("[data-e]"); if(!row) return;
  openEdit(row.dataset.e);
});

/* =========================================================================
   記録の修正シート
   ========================================================================= */
let editId = null;
function openEdit(id){
  const r = recs().find(x => String(x.id) === String(id));
  if(!r) return;
  editId = String(id);
  const inc = rType(r) === "i";
  $("eKind").textContent = inc ? "収入の記録" : "支出の記録";
  $("eDate").value = r.d;
  $("eAmt").value = yen(r.m);
  $("eSub").value = r.s;
  $("eNote").value = r.n || "";
  $("eCatField").hidden = inc;
  if(!inc){
    const cats = Object.keys(catTree());
    const cur = rCat(r);
    if(cur && !cats.includes(cur)) cats.push(cur);
    $("eCat").innerHTML = cats.map(c => `<option value="${esc(c)}"${c === cur ? " selected" : ""}>${esc(c)}</option>`).join("");
  }
  $("eSubList").innerHTML = (inc ? incomeItems() : allItems())
    .map(x => `<option value="${esc(x.s)}">`).join("");
  $("editSheet").hidden = false;
}
function closeEdit(){ $("editSheet").hidden = true; editId = null; }
$("editBg").addEventListener("click", closeEdit);
$("eCancel").addEventListener("click", closeEdit);
/* 内容を書き換えたら、既に知っている内容なら大項目を自動で合わせる */
$("eSub").addEventListener("input", () => {
  const hit = allItems().find(x => x.s === $("eSub").value.trim());
  if(hit && !$("eCatField").hidden) $("eCat").value = hit.c;
});
$("eAmt").addEventListener("input", e => { const n = numOf(e.target); e.target.value = n ? yen(n) : ""; });
$("eSave").addEventListener("click", () => {
  const a = recs();
  const r = a.find(x => String(x.id) === editId);
  if(!r) return closeEdit();
  const sub = $("eSub").value.trim(), amt = numOf($("eAmt"));
  if(!sub) return toast("内容を入れてください", false);
  if(!amt) return toast("金額を入れてください", false);
  r.d = $("eDate").value || r.d;
  r.m = amt;
  r.s = sub;
  const note = $("eNote").value.trim();
  if(note) r.n = note; else delete r.n;
  if(rType(r) !== "i"){
    const cat = $("eCat").value;
    const hit = (catTree()[cat] || []).find(x => x.s === sub);
    learn(a, sub, cat, hit ? hit.g : V, hit ? hit.f : M4);
    delete r.c; delete r.g; delete r.f;   // 分類はマスタ側に寄せる
  }
  put(a); lastIds = [];
  closeEdit(); renderLog(); renderMonth();
  toast(`${sub} を修正しました`, false);
});
$("eDelete").addEventListener("click", () => {
  const r = recs().find(x => String(x.id) === editId);
  if(!r) return closeEdit();
  if(!confirm(`${r.d.replace(/-/g,"/")} の「${r.s}」${yen(r.m)}円 を削除します。よろしいですか？`)) return;
  put(recs().filter(x => String(x.id) !== editId));
  lastIds = []; closeEdit(); renderLog(); renderMonth();
  toast("削除しました", false);
});

/* =========================================================================
   データ（取り込み・書き出し・同期・削除）
   ========================================================================= */
function parseCSV(text){
  const rows = []; let row = [], cell = "", q = false;
  text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(q){
      if(c === '"'){ if(text[i+1] === '"'){ cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if(c === '"') q = true;
    else if(c === ","){ row.push(cell); cell = ""; }
    else if(c === "\n"){ row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if(cell !== "" || row.length){ row.push(cell); rows.push(row); }
  const head = rows.shift().map(h => h.trim());
  return rows.filter(r => r.some(v => v !== "")).map(r => {
    const o = {}; head.forEach((h, i) => o[h] = (r[i] ?? "").trim()); return o;
  });
}
const grpOf = (cat, liquid) => cat === "cash" ? (liquid === "1" ? "現金" : "現金（固定）")
  : ({ jisha:"自社株", dom:"国内株", us:"米国株", world:"全世界株", em:"新興国株" }[cat] || "その他");

$("importFile").addEventListener("change", async e => {
  const files = [...e.target.files]; if(!files.length) return;
  const msg = $("importMsg"); msg.hidden = false; msg.className = "msg"; msg.textContent = "読み込み中…";
  if(recs().some(r => r.k === "t") &&
     !confirm("すでに記録があります。取り込むと同じ内容が二重に入る可能性があります。続けますか？")){
    msg.textContent = "取り込みを中止しました。"; e.target.value = ""; return;
  }
  const a = recs(); const added = {};
  try {
    for(const f of files){
      const rows = parseCSV(await f.text());
      if(!rows.length) continue;
      const h = Object.keys(rows[0]);
      if(h.includes("account_id") && h.includes("amount_yen")){
        rows.forEach(r => a.push({ k:"a", id:uid(), d:r.date, a:r.account_id, m:+r.amount_yen }));
        added["資産残高"] = rows.length;
      } else if(h.includes("account_id") && h.includes("target_yen")){
        rows.forEach(r => a.push({ k:"tgt", id:uid(), a:r.account_id, m:+r.target_yen }));
        added["目標"] = rows.length;
      } else if(h.includes("id") && h.includes("cat") && h.includes("active")){
        rows.forEach((r, i) => a.push({ k:"acc", id:uid(), a:r.id, name:r.name,
          grp:grpOf(r.cat, r.liquid), active:+r.active, ord:i }));
        added["口座"] = rows.length;
      } else if(h.includes("sub") && h.includes("amount_yen")){
        rows.forEach(r => {
          const rec = { k:"t", id:uid(), d:r.date, s:r.sub, m:+r.amount_yen };
          if(r.type === "i") rec.t = "i";
          if(r.item) rec.n = r.item;
          a.push(rec);
          if(r.type !== "i") learn(a, r.sub, r.cat, r.kind || V, r.freq || M4);
        });
        added["家計簿"] = rows.length;
      } else {
        msg.className = "msg err"; msg.textContent = `${f.name} は見覚えのない形式です。`; return;
      }
    }
    put(a);
    msg.className = "msg";
    msg.textContent = "取り込みました： " + Object.entries(added).map(([k, v]) => `${k} ${yen(v)}件`).join(" / ");
    renderAll();
  } catch(err){
    msg.className = "msg err"; msg.textContent = "取り込みに失敗しました: " + err.message;
  }
  e.target.value = "";
});

$("exportJson").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(recs(), null, 1)], { type:"application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `money-log-${today()}.json`;
  a.click(); URL.revokeObjectURL(a.href);
});
$("genCode").addEventListener("click", () => {
  const c = [...crypto.getRandomValues(new Uint8Array(15))]
    .map(b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
  $("sync-code").value = c;
  toast("コードを作りました。両方の端末に同じものを入れてください", false);
});
$("clearAll").addEventListener("click", () => {
  if(!confirm("この端末のお金の記録をすべて削除します。よろしいですか？")) return;
  if(!confirm("元に戻せません。本当に削除しますか？")) return;
  put([]); localStorage.removeItem(FAV);
  renderAll(); toast("すべて削除しました", false);
});

/* =========================================================================
   共通
   ========================================================================= */
function dataSize(){
  const b = new Blob([localStorage.getItem(KEY) || "[]"]).size;
  return { bytes:b, pct:Math.round(b / 1048576 * 100) };
}
/* 同期がうまくいっているか一目で分かるように、種類ごとの件数を出す */
function renderBreakdown(){
  const el = $("breakdownData"); if(!el) return;
  const a = recs();
  const tx = a.filter(r => r.k === "t");
  const rows = [
    ["取引（家計簿）", tx.length],
    ["資産の残高", a.filter(r => r.k === "a").length],
    ["口座", a.filter(r => r.k === "acc").length],
    ["2027年の目標", a.filter(r => r.k === "tgt").length]
  ];
  const span = tx.length
    ? tx.map(r => r.d).sort().at(0).replace(/-/g,"/") + " 〜 " + tx.map(r => r.d).sort().at(-1).replace(/-/g,"/")
    : "";
  el.innerHTML = rows.map(([k, v]) =>
    `<div class="row"><span class="nm">${k}</span>
      <span style="font-weight:700;font-variant-numeric:tabular-nums">${yen(v)}</span>
      <span class="u">件</span></div>`).join("")
    + (span ? `<p class="note" style="margin:9px 2px 0">期間 ${span}</p>` : "")
    + (tx.length ? "" : `<p class="note err" style="margin:9px 2px 0">記録がまだ1件もありません。PCで4本のCSVを取り込み、同じ同期コードで両方の端末を繋いでください。</p>`);
}
function renderMonth(){
  const ym = today().slice(0, 7);
  const v = recs().filter(r => r.k === "t" && rType(r) === "e" && r.d.startsWith(ym))
                  .reduce((s, r) => s + r.m, 0);
  $("mtotal").textContent = yen(v);
  const ds = dataSize();
  $("dataCount").textContent = `${yen(recs().length)}件`;
  renderBreakdown();
  const el = $("sizeNote");
  if(el){
    el.textContent = `いまのデータ量 ${(ds.bytes/1024).toFixed(0).replace(/\B(?=(\d{3})+$)/g,",")} KB（同期1件あたりの上限 1,024 KB の ${ds.pct}%）`;
    el.className = "note" + (ds.pct >= 80 ? " err" : "");
  }
}
let toastT;
function toast(msg, undoable){
  $("toastMsg").textContent = msg;
  $("undo").hidden = !undoable;
  $("toast").classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(() => $("toast").classList.remove("on"), 3600);
}
$("undo").addEventListener("click", () => {
  if(!lastIds.length) return;
  put(recs().filter(r => !lastIds.includes(r.id)));
  lastIds = []; $("toast").classList.remove("on");
  renderMonth(); renderLog();
});
$("tabs").addEventListener("click", e => {
  const b = e.target.closest("button"); if(!b) return;
  [...e.currentTarget.children].forEach(x => x.removeAttribute("aria-current"));
  b.setAttribute("aria-current", "page");
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("on", s.id === b.dataset.s));
  if(b.dataset.s === "s-fixed") renderFixed();
  if(b.dataset.s === "s-assets") assetMode === "chart" ? renderChart() : renderAssetEdit();
  if(b.dataset.s === "s-log") renderLog();
});
function renderAll(){
  renderDate(); renderCats(); renderMonth();
  if($("s-fixed").classList.contains("on")) renderFixed();
  if($("s-assets").classList.contains("on")) assetMode === "chart" ? renderChart() : renderAssetEdit();
  if($("s-log").classList.contains("on")) renderLog();
}
/* 他の端末から同期で降ってきたら、キャッシュを捨てて描き直す */
window.addEventListener("money:remote", () => { _map = null; renderAll(); });
window.addEventListener("resize", () => { $("tip").style.opacity = 0; });

renderAll();
