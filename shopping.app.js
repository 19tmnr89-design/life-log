// 買い物リスト（夫婦でリアルタイム共有）
//
// 設計メモ:
//  - 認証なし。URL の ?room=xxxx が部屋の鍵。匿名認証で Firestore に接続する。
//  - マスター食材の本体は shopping.data.js（コード側）に持つ。Firestore に保存するのは
//    「編集したコツ」「カスタム品目」「使用回数」などの差分（master_meta）だけ。
//    → 読み書きが最小限で済み、プリセットの更新はファイル編集だけで全端末に反映される。
//  - オフライン永続化を有効にしているので、店内で電波が切れてもチェックは端末に残り、
//    復帰時に自動送信される。
//
// Firestore の構造:
//   shopping_lists/{roomId}
//     /items/{itemId}        … 今回買うもの
//     /master_meta/{name}    … マスターの差分・使用回数・カスタム品目
//     /history/{historyId}   … 買い物完了時のスナップショット

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { MASTER_PRESET, CATEGORY_ORDER, UNIT_OPTIONS } from "./shopping.data.js";

/* ==================== 定数・小道具 ==================== */

const ROOM_KEY = "shopping-room-id";
const WHO_KEY  = "shopping-who";
const MODE_KEY = "shopping-mode";
const ROOT     = "shopping_lists";
const UNIT_OTHER = "__other__";

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const CAT_RANK = new Map(CATEGORY_ORDER.map((c, i) => [c, i]));
// カテゴリ統合前に登録された品目を、統合後の売り場に読み替える
const CAT_ALIAS = {
  "大豆製品": "大豆製品・加工品", "加工品": "大豆製品・加工品",
  "日配": "麺類・米・パン", "麺類・米": "麺類・米・パン",
  "乳製品": "卵・乳製品"
};
const canonCat = (c) => CAT_ALIAS[c] || c || "その他";
const catRank = (c) => {
  const k = canonCat(c);
  return CAT_RANK.has(k) ? CAT_RANK.get(k) : CATEGORY_ORDER.length;
};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function randomId(len) {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => chars[b % chars.length]).join("");
}

// Firestore のドキュメントIDに使えるようにする（"/" や予約名を避ける）
function metaKey(name) {
  let k = String(name || "").trim().replace(/\//g, "／");
  if (k === "." || k === "..") k = "_" + k;
  if (/^__.*__$/.test(k)) k = "_" + k;
  return k.slice(0, 100) || "_";
}

const who = () => localStorage.getItem(WHO_KEY) || "";

// 検索用の正規化。
//  - NFKC で半角カナ（ﾄﾏﾄ）を全角に寄せる
//  - ひらがなをカタカナに寄せる（「ねぎ」で「青ネギ」が出るように）
function normKana(s) {
  return String(s ?? "").normalize("NFKC").toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ==================== 部屋の決定 ==================== */

function resolveRoomId() {
  const params = new URLSearchParams(location.search);
  let id = (params.get("room") || "").trim().slice(0, 40);
  if (!id) id = (localStorage.getItem(ROOM_KEY) || "").trim();
  if (!id) id = randomId(20);
  try { localStorage.setItem(ROOM_KEY, id); } catch { /* プライベートモード等 */ }
  if (params.get("room") !== id) {
    params.set("room", id);
    history.replaceState(null, "", location.pathname + "?" + params.toString());
  }
  return id;
}

const roomId = resolveRoomId();

/* ==================== Firebase ==================== */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// IndexedDB が使えない環境（プライベートモード、アプリ内ブラウザなど）では
// 永続化の初期化に失敗する。そこで落とさず、メモリキャッシュに切り替えて動かす。
let cacheMode = "永続（オフライン対応）";
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (e) {
  console.warn("オフライン永続化を有効にできませんでした:", e);
  cacheMode = "メモリのみ（" + (e.code || e.message) + "）";
  db = initializeFirestore(app, {});
}

const roomRef  = doc(db, ROOT, roomId);
const itemsCol = collection(roomRef, "items");
const metaCol  = collection(roomRef, "master_meta");
const histCol  = collection(roomRef, "history");

/* ==================== 状態 ==================== */

let items = [];        // 今回のリスト
let metaDocs = [];     // master_meta
let histDocs = [];     // 履歴（新しい順）
let openCats = new Set(["野菜"]);   // 開いているカテゴリ
let openTips = new Set();          // コツを開いている品目のID
let searchWord = "";
let editingId = null;  // 編集モーダルで開いている品目
let modalAmounts = null;  // 編集モーダルの選択肢
let modalAmount = null;   // 編集モーダルで選ばれている数量（選択式のとき）
let undoAction = null;
let undoTimer = null;
let netCached = true, netPending = false;
let authState = "未接続";   // 接続状態の表示用
let syncError = "";
let unsubs = [];

/* ==================== マスターの合成 ==================== */

function effectiveMaster() {
  const map = new Map();
  for (const p of MASTER_PRESET) {
    map.set(p.name, {
      name: p.name, category: p.category, unit: p.unit || "個",
      yomi: p.yomi || "", tip: p.tip || "",
      amounts: p.amounts || null, defaultAmount: p.defaultAmount || null,
      isCustom: false, hidden: false, useCount: 0
    });
  }
  for (const m of metaDocs) {
    if (!m.name) continue;
    const base = map.get(m.name) || {
      name: m.name, category: "その他", unit: "個",
      yomi: "", tip: "", amounts: null, defaultAmount: null,
      isCustom: true, hidden: false, useCount: 0
    };
    map.set(m.name, {
      name: m.name,
      category: m.category ?? base.category,
      unit: m.unit ?? base.unit,
      yomi: base.yomi,
      tip: m.tip ?? base.tip,
      amounts: base.amounts,
      defaultAmount: base.defaultAmount,
      isCustom: m.isCustom ?? base.isCustom,
      hidden: m.hidden ?? base.hidden,
      useCount: m.useCount ?? base.useCount
    });
  }
  return Array.from(map.values()).filter((m) => !m.hidden);
}

const sortItems = (arr) => arr.slice().sort((a, b) =>
  catRank(a.category) - catRank(b.category) ||
  (a.order || 0) - (b.order || 0) ||
  String(a.name).localeCompare(String(b.name), "ja"));

// 選択式の品目は amount（「1/4玉」など）、それ以外は 数値+単位 を表示する
const amountLabel = (it) => it.amount || `${it.quantity ?? 1}${it.unit || "個"}`;

/* ==================== 書き込み ==================== */

// writeBatch は 500 件までなので分割してコミットする
async function commitOps(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + 400)) op(batch);
    await batch.commit();
  }
}

async function touchRoom() {
  try {
    await setDoc(roomRef, { updatedAt: Date.now(), createdAt: Date.now() }, { merge: true });
  } catch { /* 失敗しても本体の動作には影響しない */ }
}

function newItemData({ name, category, quantity, unit, tip, amount, amounts }, order) {
  return {
    name, category: category || "その他",
    quantity: Number(quantity) || 1, unit: unit || "個",
    amount: amount || null, amounts: amounts || null,
    tip: tip || "", isChecked: false,
    order: order ?? Date.now(), addedBy: who(), createdAt: Date.now()
  };
}

async function addItem(data) {
  await setDoc(doc(itemsCol, randomId(16)), newItemData(data));
  touchRoom();
}

async function updateItem(id, patch) {
  await setDoc(doc(itemsCol, id), patch, { merge: true });
  touchRoom();
}

const removeItem = (id) => deleteDoc(doc(itemsCol, id));

// マスター側の差分を保存（コツの編集は次回以降にも反映される）
const saveMeta = (name, patch) =>
  setDoc(doc(metaCol, metaKey(name)), { name, ...patch }, { merge: true });

/* ==================== 操作 ==================== */

async function toggleMaster(m) {
  const found = items.find((it) => it.name === m.name);
  if (found) {
    await removeItem(found.id);
  } else {
    await addItem({
      name: m.name, category: m.category, quantity: 1, unit: m.unit, tip: m.tip,
      amounts: m.amounts,
      amount: m.amounts ? (m.defaultAmount || m.amounts[0]) : null
    });
  }
}

async function setChecked(item, checked) {
  await updateItem(item.id, {
    isChecked: checked,
    checkedAt: checked ? Date.now() : null,
    checkedBy: checked ? who() : null
  });
  showUndo(
    checked ? `「${item.name}」をカゴに入れました` : `「${item.name}」を戻しました`,
    () => updateItem(item.id, {
      isChecked: !checked,
      checkedAt: !checked ? Date.now() : null,
      checkedBy: !checked ? who() : null
    })
  );
}

async function changeQty(item, delta) {
  const next = Math.min(999, Math.max(1, (Number(item.quantity) || 1) + delta));
  if (next !== item.quantity) await updateItem(item.id, { quantity: next });
}

async function completeShopping() {
  if (!items.length) return;
  if (!confirm(`買い物を完了します。\n${items.length}品を履歴に保存して、リストを空にします。\nよろしいですか？`)) return;

  const snapshot = items.map((i) => ({
    name: i.name, category: i.category,
    quantity: i.quantity ?? 1, unit: i.unit || "個",
    amount: i.amount || null, amounts: i.amounts || null, tip: i.tip || ""
  }));
  const master = new Map(effectiveMaster().map((m) => [m.name, m]));
  const names = Array.from(new Set(items.map((i) => i.name)));

  const ops = [
    (b) => b.set(doc(histCol, randomId(16)),
      { completedAt: Date.now(), by: who(), count: snapshot.length, items: snapshot }),
    ...names.map((name) => (b) => b.set(doc(metaCol, metaKey(name)),
      { name, useCount: (master.get(name)?.useCount || 0) + 1, lastUsedAt: Date.now() }, { merge: true })),
    ...items.map((i) => (b) => b.delete(doc(itemsCol, i.id)))
  ];
  await commitOps(ops);
  toast(`${snapshot.length}品を履歴に保存しました`);
  setMode("edit");
}

async function restoreLast() {
  const last = histDocs[0];
  if (!last || !Array.isArray(last.items) || !last.items.length) return;
  const exists = new Set(items.map((i) => i.name));
  const add = last.items.filter((i) => !exists.has(i.name));
  if (!add.length) { toast("前回の品目はすべてリストに入っています"); return; }

  const base = Date.now();
  await commitOps(add.map((it, idx) => (b) =>
    b.set(doc(itemsCol, randomId(16)), newItemData(it, base + idx))));
  toast(`前回のリストから${add.length}品を復元しました`);
}

async function clearItems(onlyChecked) {
  const target = onlyChecked ? items.filter((i) => i.isChecked) : items;
  if (!target.length) { toast(onlyChecked ? "購入済みの品目はありません" : "リストは空です"); return; }
  const msg = onlyChecked
    ? `購入済みの${target.length}品を削除します。よろしいですか？`
    : `リストの${target.length}品をすべて削除します。\n（履歴には残りません）よろしいですか？`;
  if (!confirm(msg)) return;
  await commitOps(target.map((i) => (b) => b.delete(doc(itemsCol, i.id))));
  toast(`${target.length}品を削除しました`);
}

/* ==================== 取り消しバー ==================== */

function showUndo(text, undoFn) {
  undoAction = undoFn;
  $("#undo-text").textContent = text;
  $("#undo-bar").hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, 5000);
}
function hideUndo() {
  clearTimeout(undoTimer);
  undoAction = null;
  $("#undo-bar").hidden = true;
}

/* ==================== 描画 ==================== */

// 食材をタップするとリストが上に伸びて、見ている場所がずれてしまう。
// 描画の前後で食材パネルの位置を測り、ずれた分だけスクロールを戻す。
function render() {
  const anchor = $("#master-panel");
  const before = anchor.getBoundingClientRect().top;
  renderEdit();
  renderShop();
  if (!$("#view-edit").hidden) {
    const diff = anchor.getBoundingClientRect().top - before;
    if (Math.abs(diff) > 0.5) window.scrollBy(0, diff);
  }
}

/* ---- 画面A: リスト作成 ---- */

function renderEdit() {
  const list = sortItems(items);
  $("#edit-count").textContent = String(list.length);
  $("#current-empty").hidden = list.length > 0;
  $("#btn-restore-last").hidden = histDocs.length === 0;

  // 1品目1行に収めて表示できる行数を稼ぐ。選び方のコツは 💡 を押したときだけ開く
  $("#current-list").innerHTML = list.map((it) => {
    const opts = Array.isArray(it.amounts) && it.amounts.length ? it.amounts : null;
    const current = amountLabel(it);
    const tipOpen = openTips.has(it.id);
    return `
      <li class="item-row${it.isChecked ? " is-checked" : ""}" data-id="${esc(it.id)}">
        <div class="item-top">
          <button class="item-name-btn" data-act="edit" type="button">${esc(it.name)}${it.isChecked ? " <span class='mini-tag'>カゴ済</span>" : ""}</button>
          ${it.tip ? `<button class="tip-btn${tipOpen ? " is-on" : ""}" data-act="tip" type="button" aria-label="選び方のコツ">💡</button>` : ""}
          <div class="ctl">
            ${opts ? opts.map((a) =>
              `<button type="button" class="amt${a === current ? " is-on" : ""}" data-act="amount" data-amt="${esc(a)}">${esc(a)}</button>`
            ).join("") : ""}
            ${opts && !opts.includes(current)
              // 「その他」で入れた数量も、選択中のチップとして同じ見た目で並べる（押すと編集）
              ? `<button type="button" class="amt is-on" data-act="edit">${esc(current)}</button>`
              : ""}
            ${opts ? "" : `
            <div class="qty-ctl">
              <button class="qty-btn" data-act="minus" type="button" aria-label="減らす">−</button>
              <span class="qty-val"><b>${esc(it.quantity ?? 1)}</b><small>${esc(it.unit || "個")}</small></span>
              <button class="qty-btn" data-act="plus" type="button" aria-label="増やす">＋</button>
            </div>`}
          </div>
        </div>
        ${it.tip && tipOpen ? `<div class="item-tip">💡 ${esc(it.tip)}</div>` : ""}
      </li>`;
  }).join("");

  renderMaster();
}

function renderMaster() {
  const inList = new Set(items.map((i) => i.name));
  const all = effectiveMaster();
  const word = normKana(searchWord.trim());
  const hit = word
    ? all.filter((m) => normKana(m.name).includes(word) || normKana(m.yomi).includes(word))
    : all;

  // よく買うもの（検索中は隠す）
  const freq = all.filter((m) => (m.useCount || 0) > 0)
    .sort((a, b) => (b.useCount || 0) - (a.useCount || 0)).slice(0, 12);
  const showFreq = !word && freq.length > 0;
  $("#frequent-wrap").hidden = !showFreq;
  if (showFreq) $("#frequent-chips").innerHTML = freq.map((m) => chipHtml(m, inList)).join("");

  const byCat = new Map();
  for (const m of hit) {
    const cat = canonCat(m.category);
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(m);
  }
  const cats = Array.from(byCat.keys()).sort((a, b) => catRank(a) - catRank(b));
  $("#master-empty").hidden = hit.length > 0;

  $("#master-categories").innerHTML = cats.map((cat) => {
    const open = word ? true : openCats.has(cat);
    const list = byCat.get(cat).sort((a, b) => a.name.localeCompare(b.name, "ja"));
    return `
      <details class="cat" data-cat="${esc(cat)}"${open ? " open" : ""}>
        <summary class="cat-summary">${esc(cat)} <span class="cat-count">${list.length}</span></summary>
        <div class="chip-grid">${list.map((m) => chipHtml(m, inList)).join("")}</div>
      </details>`;
  }).join("");
}

function chipHtml(m, inList) {
  const on = inList.has(m.name);
  // 選択済みは色だけで示す。文字を足すと幅が変わって、他のチップの位置がずれてしまう
  return `<button type="button" class="chip${on ? " is-on" : ""}${m.isCustom ? " is-custom" : ""}"
    data-master="${esc(m.name)}"${m.tip ? ` title="${esc(m.tip)}"` : ""}>${esc(m.name)}</button>`;
}

/* ---- 画面B: 買い物モード ---- */

function renderShop() {
  const list = sortItems(items);
  const todo = list.filter((i) => !i.isChecked);
  const done = list.filter((i) => i.isChecked);

  const total = list.length;
  $("#shop-empty").hidden = total > 0;
  $("#shop-alldone").hidden = !(total > 0 && todo.length === 0);

  // 売り場（カテゴリ）ごとにまとめる
  const groups = [];
  for (const it of todo) {
    const cat = canonCat(it.category);
    const g = groups[groups.length - 1];
    if (g && g.cat === cat) g.items.push(it);
    else groups.push({ cat, items: [it] });
  }
  $("#shop-todo").innerHTML = groups.map((g) => `
    <div class="shop-group">
      <h3 class="shop-cat">${esc(g.cat)}</h3>
      ${g.items.map(shopRowHtml).join("")}
    </div>`).join("");

  $("#done-wrap").hidden = done.length === 0;
  $("#done-count").textContent = String(done.length);
  $("#shop-done").innerHTML = done.map(doneRowHtml).join("");
}

// チェックボタンは置かず、行全体をタップしてカゴ入れする（押し間違いは取り消しバーで戻せる）
function shopRowHtml(it) {
  return `
    <button class="shop-item" type="button" data-id="${esc(it.id)}">
      <span class="si-line">
        <span class="si-name">${esc(it.name)}</span>
        <span class="si-qty">${esc(amountLabel(it))}</span>
      </span>
      ${it.tip ? `<span class="si-tip">💡 ${esc(it.tip)}</span>` : ""}
    </button>`;
}

function doneRowHtml(it) {
  return `
    <button class="shop-item is-done" type="button" data-id="${esc(it.id)}">
      <span class="si-line">
        <span class="si-name">${esc(it.name)}</span>
        <span class="si-qty">${esc(amountLabel(it))}</span>
        ${it.checkedBy ? `<span class="si-by">${esc(it.checkedBy)}</span>` : ""}
      </span>
    </button>`;
}

/* ==================== モード切替（端末ごとに保持） ==================== */

function setMode(mode) {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* noop */ }
  $("#view-edit").hidden = mode !== "edit";
  $("#view-shop").hidden = mode !== "shop";
  $$(".mode-tab").forEach((b) => b.classList.toggle("is-active", b.dataset.mode === mode));
  window.scrollTo({ top: 0 });
}

/* ==================== 単位のプルダウン ==================== */

function unitOptionsHtml(selected) {
  const known = UNIT_OPTIONS.includes(selected);
  return UNIT_OPTIONS.map((u) =>
    `<option value="${esc(u)}"${known && u === selected ? " selected" : ""}>${esc(u)}</option>`
  ).join("") +
    `<option value="${UNIT_OTHER}"${!known && selected ? " selected" : ""}>その他（入力）</option>`;
}

// select が「その他」なら自由入力欄の値を使う
function readUnit(select, other) {
  const v = select.value === UNIT_OTHER ? other.value.trim() : select.value;
  return v || "個";
}
function syncUnitOther(select, other) {
  other.hidden = select.value !== UNIT_OTHER;
  if (!other.hidden) other.focus();
}

/* ==================== 品目編集モーダル ==================== */

function renderModalAmounts() {
  if (!modalAmounts) return;
  $("#mi-amounts").innerHTML = modalAmounts.map((a) =>
    `<button type="button" class="amt${a === modalAmount ? " is-on" : ""}" data-amt="${esc(a)}">${esc(a)}</button>`
  ).join("") +
    `<button type="button" class="amt amt-other${modalAmount === null ? " is-on" : ""}" data-amt="${UNIT_OTHER}">その他</button>`;
  $("#mi-qty-field").hidden = modalAmount !== null;
}

function openItemModal(id) {
  const it = items.find((i) => i.id === id);
  if (!it) return;
  editingId = id;
  $("#mi-name").value = it.name || "";
  $("#mi-qty").value = it.quantity ?? 1;
  $("#mi-unit").innerHTML = unitOptionsHtml(it.unit || "個");
  $("#mi-unit-other").value = UNIT_OPTIONS.includes(it.unit || "個") ? "" : (it.unit || "");
  syncUnitOther($("#mi-unit"), $("#mi-unit-other"));
  $("#mi-category").value = CATEGORY_ORDER.includes(canonCat(it.category)) ? canonCat(it.category) : "その他";
  $("#mi-tip").value = it.tip || "";

  modalAmounts = Array.isArray(it.amounts) && it.amounts.length ? it.amounts : null;
  modalAmount = modalAmounts ? (it.amount || null) : null;
  $("#mi-amount-field").hidden = !modalAmounts;
  if (modalAmounts) renderModalAmounts(); else $("#mi-qty-field").hidden = false;

  $("#modal-item").hidden = false;
}

function closeItemModal() {
  editingId = null;
  modalAmounts = null;
  modalAmount = null;
  $("#modal-item").hidden = true;
}

async function saveItemModal() {
  const id = editingId;
  if (!id) return;
  const before = items.find((i) => i.id === id);
  if (!before) { closeItemModal(); toast("この品目は削除されました"); return; }

  const name = $("#mi-name").value.trim();
  if (!name) { toast("品名を入力してください"); return; }
  const unit = readUnit($("#mi-unit"), $("#mi-unit-other"));
  const patch = {
    name, unit,
    quantity: Math.min(999, Math.max(1, parseInt($("#mi-qty").value, 10) || 1)),
    amount: modalAmount,
    category: $("#mi-category").value,
    tip: $("#mi-tip").value.trim()
  };
  await updateItem(id, patch);

  // コツ・カテゴリ・単位の変更は次回以降のマスターにも反映する
  const known = effectiveMaster().some((m) => m.name === name);
  const changed = before.tip !== patch.tip || before.unit !== unit ||
    before.category !== patch.category || before.name !== name;
  if (changed) {
    await saveMeta(name, {
      tip: patch.tip, unit, category: patch.category,
      ...(known ? {} : { isCustom: true })
    });
  }
  closeItemModal();
  toast("保存しました");
}

/* ==================== 設定モーダル ==================== */

function diagnosticsText() {
  return [
    "部屋ID: " + roomId,
    "ログイン: " + authState,
    "サーバー接続: " + (syncError ? "エラー（" + syncError + "）" : netCached ? "未接続（キャッシュ表示中）" : "接続中"),
    "未送信の変更: " + (netPending ? "あり" : "なし"),
    "保存方式: " + cacheMode,
    "リストの品目数: " + items.length,
    "ブラウザ: " + navigator.userAgent
  ].join("\n");
}

function openSettings() {
  $("#diag").textContent = diagnosticsText();
  $("#share-url").value = location.origin + location.pathname + "?room=" + roomId;
  $("#room-input").value = roomId;
  $$(".who-btn").forEach((b) => b.classList.toggle("is-on", b.dataset.who === who()));
  $("#history-list").innerHTML = histDocs.length
    ? histDocs.slice(0, 10).map((h) => {
        const d = new Date(h.completedAt || 0);
        const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        const names = (h.items || []).map((i) => i.name).join("、");
        return `<div class="history-row"><b>${esc(when)}</b> <span class="history-count">${h.count ?? (h.items || []).length}品</span><br><span class="history-names">${esc(names)}</span></div>`;
      }).join("")
    : `<p class="empty-note">まだ履歴はありません。買い物モードの「買い物を完了」で保存されます。</p>`;
  $("#modal-settings").hidden = false;
}

async function copyShareUrl() {
  const url = $("#share-url").value;
  try {
    await navigator.clipboard.writeText(url);
    toast("共有リンクをコピーしました");
  } catch {
    $("#share-url").select();
    toast("コピーできませんでした。リンクを長押しでコピーしてください");
  }
}

/* ==================== 同期ステータス ==================== */

// オフラインとエラーのときだけ表示する。
// 送信中（hasPendingWrites）はタップのたびに一瞬バーが出て画面が動くので出さない。
// 異常時は画面上端に貼り付いて、スクロールしても見えなくならないようにしている。
function updateSyncStatus() {
  const el = $("#sync-status");
  let msg = "", cls = "";
  if (syncError) {
    msg = "⚠️ " + syncError;
    cls = "is-err";
  } else if (!navigator.onLine || netCached) {
    msg = "📴 オフライン中（変更は端末に保存され、電波が戻ると自動送信されます）";
    cls = "is-off";
  }
  el.textContent = msg;
  el.className = "sync-status " + cls;
  el.hidden = !msg;
}

// 接続に失敗しても諦めず、間隔を空けて匿名ログインを試し直す。
// 一度も成功しないと Firestore の読み書きが権限エラーになり、相手と同期できない。
async function ensureAuth() {
  let retried = false;
  for (let i = 0; i < 6; i++) {
    try {
      await signInAnonymously(auth);
      authState = "ログイン済み";
      syncError = "";
      updateSyncStatus();
      return retried;
    } catch (e) {
      retried = true;
      authState = "ログイン失敗（" + (e.code || e.message) + "）";
      syncError = "サーバーにログインできません。電波の良い場所でページを再読み込みしてください。";
      updateSyncStatus();
      await new Promise((r) => setTimeout(r, Math.min(10000, 800 * 2 ** i)));
    }
  }
  return retried;
}

/* ==================== 初期化 ==================== */

function fillSelects() {
  const opts = CATEGORY_ORDER.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  $("#mi-category").innerHTML = opts;
  const fa = $("#free-add");
  fa.category.innerHTML = opts;
  fa.category.value = "その他";
  fa.unit.innerHTML = unitOptionsHtml("個");
}

function bindEvents() {
  // モードタブ
  $$(".mode-tab").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

  // 今回のリスト
  $("#current-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    const row = e.target.closest(".item-row");
    if (!btn || !row) return;
    const it = items.find((i) => i.id === row.dataset.id);
    if (!it) return;
    if (btn.dataset.act === "edit") openItemModal(it.id);
    if (btn.dataset.act === "plus") changeQty(it, +1);
    if (btn.dataset.act === "minus") changeQty(it, -1);
    if (btn.dataset.act === "amount") updateItem(it.id, { amount: btn.dataset.amt });
    if (btn.dataset.act === "tip") {
      if (openTips.has(it.id)) openTips.delete(it.id); else openTips.add(it.id);
      renderEdit();
    }
  });

  // マスターのチップ
  const onChip = (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const m = effectiveMaster().find((x) => x.name === chip.dataset.master);
    if (m) toggleMaster(m);
  };
  $("#master-categories").addEventListener("click", onChip);
  $("#frequent-chips").addEventListener("click", onChip);

  // カテゴリの開閉状態を覚えておく（再描画で閉じないように）
  // 検索中は全カテゴリを自動で開くので、その分は記憶しない
  $("#master-categories").addEventListener("toggle", (e) => {
    if (searchWord.trim()) return;
    const d = e.target.closest("details.cat");
    if (!d) return;
    if (d.open) openCats.add(d.dataset.cat);
    else openCats.delete(d.dataset.cat);
  }, true);

  // 検索
  $("#master-search").addEventListener("input", (e) => {
    searchWord = e.target.value;
    renderMaster();
  });

  // 自由入力の追加
  const fa = $("#free-add");
  fa.unit.addEventListener("change", () => syncUnitOther(fa.unit, fa.unitOther));
  fa.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = fa.name.value.trim();
    if (!name) return;
    const category = fa.category.value;
    const unit = readUnit(fa.unit, fa.unitOther);
    const tip = fa.tip.value.trim();
    const quantity = Math.min(999, Math.max(1, parseInt(fa.qty.value, 10) || 1));

    await addItem({ name, category, quantity, unit, tip });
    if (fa.toMaster.checked) {
      const known = effectiveMaster().some((m) => m.name === name);
      await saveMeta(name, { category, unit, tip, ...(known ? {} : { isCustom: true }) });
    }
    fa.name.value = "";
    fa.tip.value = "";
    fa.qty.value = 1;
    fa.name.focus();
    toast(`「${name}」を追加しました`);
  });

  $("#btn-restore-last").addEventListener("click", restoreLast);

  // 買い物モード
  const onShopRow = (checked) => (e) => {
    const row = e.target.closest(".shop-item");
    if (!row) return;
    const it = items.find((i) => i.id === row.dataset.id);
    if (it) setChecked(it, checked);
  };
  $("#shop-todo").addEventListener("click", onShopRow(true));
  $("#shop-done").addEventListener("click", onShopRow(false));

  $("#btn-complete").addEventListener("click", completeShopping);
  $("#btn-clear-checked").addEventListener("click", () => clearItems(true));
  $("#btn-clear-all").addEventListener("click", () => clearItems(false));

  // 取り消しバー
  $("#undo-btn").addEventListener("click", () => {
    const fn = undoAction;
    hideUndo();
    if (fn) fn();
  });

  // 品目編集モーダル
  $("#mi-amounts").addEventListener("click", (e) => {
    const b = e.target.closest(".amt");
    if (!b) return;
    modalAmount = b.dataset.amt === UNIT_OTHER ? null : b.dataset.amt;
    renderModalAmounts();
  });
  $("#mi-unit").addEventListener("change", () => syncUnitOther($("#mi-unit"), $("#mi-unit-other")));
  $("#mi-plus").addEventListener("click", () => {
    $("#mi-qty").value = Math.min(999, (parseInt($("#mi-qty").value, 10) || 1) + 1);
  });
  $("#mi-minus").addEventListener("click", () => {
    $("#mi-qty").value = Math.max(1, (parseInt($("#mi-qty").value, 10) || 1) - 1);
  });
  $("#mi-save").addEventListener("click", saveItemModal);
  $("#mi-cancel").addEventListener("click", closeItemModal);
  $("#mi-delete").addEventListener("click", async () => {
    if (!editingId) return;
    const id = editingId;
    closeItemModal();
    await removeItem(id);
    toast("削除しました");
  });

  // 設定モーダル
  $("#btn-settings").addEventListener("click", openSettings);
  $("#st-close").addEventListener("click", () => { $("#modal-settings").hidden = true; });
  $("#btn-copy").addEventListener("click", copyShareUrl);
  $("#btn-copy-diag").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(diagnosticsText());
      toast("接続状態をコピーしました");
    } catch { toast("コピーできませんでした"); }
  });
  $("#who-buttons").addEventListener("click", (e) => {
    const b = e.target.closest(".who-btn");
    if (!b) return;
    try { localStorage.setItem(WHO_KEY, b.dataset.who); } catch { /* noop */ }
    $$(".who-btn").forEach((x) => x.classList.toggle("is-on", x === b));
  });
  $("#btn-join").addEventListener("click", () => {
    const v = $("#room-input").value.trim();
    if (!v || v === roomId) { $("#modal-settings").hidden = true; return; }
    if (!confirm("別の部屋に切り替えます。今の画面のリストは表示されなくなります（データは残ります）。よろしいですか？")) return;
    try { localStorage.setItem(ROOM_KEY, v); } catch { /* noop */ }
    location.search = "?room=" + encodeURIComponent(v);
  });

  // モーダルの背景タップで閉じる
  $$(".modal").forEach((m) => m.addEventListener("click", (e) => {
    if (!e.target.dataset.close) return;
    if (m.id === "modal-item") closeItemModal();
    else m.hidden = true;
  }));

  addEventListener("online", updateSyncStatus);
  addEventListener("offline", updateSyncStatus);
}

function subscribe() {
  unsubs.forEach((u) => { try { u(); } catch { /* noop */ } });
  unsubs = [];

  unsubs.push(onSnapshot(itemsCol, { includeMetadataChanges: true }, (snap) => {
    items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    netCached = snap.metadata.fromCache;
    netPending = snap.metadata.hasPendingWrites;
    syncError = "";
    updateSyncStatus();
    render();
  }, (err) => {
    const code = err.code || err.message;
    syncError = code === "permission-denied"
      ? "この部屋を読み書きする権限がありません（Firestore のルールを確認してください）"
      : "同期エラー: " + code;
    updateSyncStatus();
  }));

  unsubs.push(onSnapshot(metaCol, (snap) => {
    metaDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderEdit();
  }, () => { /* マスターが読めなくてもプリセットで動く */ }));

  unsubs.push(onSnapshot(query(histCol, orderBy("completedAt", "desc"), limit(20)), (snap) => {
    histDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    $("#btn-restore-last").hidden = histDocs.length === 0;
  }, () => { /* 履歴は無くても動く */ }));
}

async function main() {
  window.__shoppingBooted = true;
  fillSelects();
  bindEvents();
  setMode(localStorage.getItem(MODE_KEY) || "edit");
  render();

  onAuthStateChanged(auth, (u) => {
    if (u) authState = "ログイン済み（" + u.uid.slice(0, 6) + "…）";
  });

  // キャッシュからすぐ表示したいので、ログインを待たずに購読を始める。
  // ログインが遅れて成功した場合は、権限エラーで止まった購読を貼り直す。
  subscribe();
  ensureAuth().then((retried) => { if (retried && !syncError) subscribe(); });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("shopping.sw.js", { scope: "./shopping.html" }).catch(() => { /* 失敗しても通常動作する */ });
  }
}

main();
