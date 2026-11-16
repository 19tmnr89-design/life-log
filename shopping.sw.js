// Service Worker — 圏外でもアプリを開けるようにするためのキャッシュ。
// データそのものは Firestore のオフライン永続化（IndexedDB）が担当するので、
// ここでは「アプリの見た目と実行コード」だけをキャッシュする。

const CACHE = "shopping-v6";

// 自分たちのファイル（インストール時にまとめて取得）
const APP_SHELL = [
  "./shopping.html",
  "./shopping.css",
  "./shopping.app.js",
  "./shopping.data.js",
  "./firebase-config.js",
  "./shopping.manifest.json",
  "./shopping-192.png",
  "./shopping-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (!url.protocol.startsWith("http")) return;

  // Firestore / 認証の通信はそのまま通す（SDK 側がオフライン処理を持っている）
  if (url.hostname.endsWith("googleapis.com") || url.hostname.endsWith("firebaseio.com")) return;

  // Firebase SDK（gstatic）はバージョン付きURLなのでキャッシュ優先
  if (url.hostname === "www.gstatic.com") {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  // 自分たちのファイルはキャッシュを返しつつ裏で更新（stale-while-revalidate）
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
});
