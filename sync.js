// 端末間同期モジュール（Firebase Firestore）— 複数アプリ共通
//
// 各アプリの index.html で、このモジュールを読み込む前に
//   <script>window.SYNC_APP = "kintore";</script>
// のようにアプリ名を指定する（未指定なら "kintore"）。
//
// アプリ名ごとに保存キー・Firestoreコレクション・イベント名が分かれるので、
// 同じ仕組みを筋トレ／習慣／お金…と使い回せる。
//
// データ本体は localStorage["<app>-log-v1"] が唯一の出所。各アプリの app.js とはイベントで連携する:
//   - app.js は保存時に "<app>:changed" を dispatch する
//   - このモジュールはリモート反映時に "<app>:remote" を dispatch する（app.js が再描画）

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig as bakedConfig } from "./firebase-config.js";

const APP = window.SYNC_APP || "kintore";
const STORAGE_KEY = `${APP}-log-v1`;
const CODE_KEY = `${APP}-sync-code`;
const DEVICE_KEY = `${APP}-device-id`;
const CFG_KEY = `${APP}-fb-config`;       // UIから貼り付けた設定の保存先
const CHANGED_EVT = `${APP}:changed`;
const REMOTE_EVT = `${APP}:remote`;

/* -------- ユーティリティ -------- */

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}
const deviceId = getDeviceId();

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}

function recordFingerprint(r) {
  const sets = (r.sets || []).map(s => `${s.weight}x${s.reps}`).join("|");
  return `${r.date} ${r.exercise} ${sets}`;
}

// ローカルとリモートを「和集合」で統合（同期の初回リンク時に、どちらのデータも失わないため）
function unionRecords(a, b) {
  const seen = new Set();
  const out = [];
  for (const r of [...a, ...b]) {
    const fp = recordFingerprint(r);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(r);
  }
  return out;
}

function effectiveConfig() {
  const pasted = localStorage.getItem(CFG_KEY);
  if (pasted) {
    try { return JSON.parse(pasted); } catch { /* fallthrough */ }
  }
  return bakedConfig;
}

function isConfigured(cfg) {
  return cfg && typeof cfg.apiKey === "string" &&
    cfg.apiKey && !cfg.apiKey.startsWith("PASTE_") &&
    cfg.projectId && !String(cfg.projectId).startsWith("PASTE_");
}

/* -------- Firebase 状態 -------- */

let db = null, auth = null, docRef = null, unsub = null;
let pushTimer = null;

function setStatus(text, cls) {
  const el = document.getElementById("sync-status");
  if (el) { el.textContent = text; el.className = "sync-status " + (cls || ""); }
}

async function ensureFirebase() {
  if (db) return true;
  const cfg = effectiveConfig();
  if (!isConfigured(cfg)) return false;
  const app = initializeApp(cfg);
  auth = getAuth(app);
  db = getFirestore(app);
  await signInAnonymously(auth);
  return true;
}

function schedulePush() {
  if (!docRef) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 800); // 連続変更をまとめて送る
}

async function pushNow() {
  if (!docRef) return;
  try {
    await setDoc(docRef, { records: loadLocal(), updatedAt: Date.now(), updatedBy: deviceId });
    setStatus("✅ 同期オン｜保存しました " + new Date().toLocaleTimeString("ja-JP"), "ok");
  } catch (e) {
    setStatus("⚠️ 同期エラー: " + (e.code || e.message), "err");
  }
}

async function connect(code) {
  code = (code || "").trim();
  if (code.length < 4) { setStatus("同期コードは4文字以上にしてください", "err"); return; }
  setStatus("接続中…", "");
  try {
    if (!(await ensureFirebase())) { setStatus("Firebase設定が未登録です", "err"); return; }
    const id = await sha256Hex(APP + ":" + code);
    docRef = doc(db, APP, id);

    // 初回リンク: リモートとローカルを和集合で統合してから購読開始
    const snap = await getDoc(docRef);
    const local = loadLocal();
    if (snap.exists()) {
      const remote = snap.data().records || [];
      const merged = unionRecords(local, remote);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      window.dispatchEvent(new CustomEvent(REMOTE_EVT));
      await setDoc(docRef, { records: merged, updatedAt: Date.now(), updatedBy: deviceId });
    } else {
      await setDoc(docRef, { records: local, updatedAt: Date.now(), updatedBy: deviceId });
    }

    if (unsub) unsub();
    unsub = onSnapshot(docRef, snap2 => {
      if (!snap2.exists()) return;
      const data = snap2.data();
      if (data.updatedBy === deviceId) return; // 自分の書き込みは無視（ループ防止）
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data.records || []));
      window.dispatchEvent(new CustomEvent(REMOTE_EVT));
      setStatus("✅ 同期オン｜他の端末から更新を受信 " + new Date().toLocaleTimeString("ja-JP"), "ok");
    }, err => setStatus("⚠️ 同期エラー: " + (err.code || err.message), "err"));

    localStorage.setItem(CODE_KEY, code);
    setStatus("✅ 同期オン（コード: " + code + "）｜この端末は同期されています", "ok");
    updateButtons(true);
  } catch (e) {
    setStatus("接続失敗: " + (e.code || e.message), "err");
  }
}

function disconnect() {
  if (unsub) { unsub(); unsub = null; }
  docRef = null;
  localStorage.removeItem(CODE_KEY);
  setStatus("未接続", "");
  updateButtons(false);
}

function updateButtons(connected) {
  const conn = document.getElementById("sync-connect");
  const disc = document.getElementById("sync-disconnect");
  const input = document.getElementById("sync-code");
  if (conn) conn.hidden = connected;
  if (disc) disc.hidden = !connected;
  if (input) input.disabled = connected;
}

/* -------- 画面初期化 -------- */

function initUI() {
  const cfg = effectiveConfig();
  const configured = isConfigured(cfg);

  const cfgBox = document.getElementById("sync-config-box");
  const cfgArea = document.getElementById("sync-config-input");
  const cfgSave = document.getElementById("sync-config-save");
  // 設定済みなら貼り付け欄は隠す（未設定のときだけ表示）
  if (cfgBox) cfgBox.hidden = configured;

  if (cfgSave) cfgSave.addEventListener("click", () => {
    try {
      const raw = cfgArea.value.trim();
      // "firebaseConfig = {...}" でも "{...}" でも受け付ける
      const jsonStart = raw.indexOf("{");
      const obj = JSON.parse(raw.slice(jsonStart).replace(/;\s*$/, "").replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
      if (!obj.apiKey || !obj.projectId) throw new Error("apiKey / projectId がありません");
      localStorage.setItem(CFG_KEY, JSON.stringify(obj));
      setStatus("設定を保存しました。同期コードを入れて開始してください", "ok");
      if (cfgBox) cfgBox.hidden = true;
      db = null; // 再初期化させる
    } catch (e) {
      setStatus("設定の読み取りに失敗: " + e.message, "err");
    }
  });

  const conn = document.getElementById("sync-connect");
  const disc = document.getElementById("sync-disconnect");
  if (conn) conn.addEventListener("click", () => connect(document.getElementById("sync-code").value));
  if (disc) disc.addEventListener("click", disconnect);

  // ローカル変更 → Push
  window.addEventListener(CHANGED_EVT, schedulePush);

  // 保存済みコードがあれば自動再接続
  const saved = localStorage.getItem(CODE_KEY);
  if (saved) {
    document.getElementById("sync-code").value = saved;
    connect(saved);
  } else {
    setStatus(configured ? "未接続" : "Firebase設定が未登録です", configured ? "" : "err");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initUI);
} else {
  initUI();
}
