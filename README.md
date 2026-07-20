# マイライフログ (life-log)

日々の記録をまとめて管理・分析するための、個人用ミニアプリ集です。
サーバー不要（GitHub Pagesでホスティング）で、データは端末のブラウザに保存され、
Firebaseによる同期コードでスマホ・PC間で共有されます。

## 構成（すべて直下・フォルダなし）

```
index.html            ホーム（各アプリへのリンク集）
sync.js               端末間同期（Firebase Firestore・全アプリ共通）
firebase-config.js    Firebase接続設定（共通）
kintore.html          💪 筋トレログ本体
app.js / style.css    筋トレログの処理・デザイン
import_template.csv   取り込み用CSVテンプレート
```

今後、習慣・お金・ライフプラン・読書記録などを `<name>.html` + `<name>.app.js` + `<name>.css`
として直下に追加していきます（同期の `sync.js` は共通で使い回し）。

## アプリの追加方法（開発メモ）

1. `<appname>.html` / `<appname>.app.js` / `<appname>.css` を直下に置く
2. データは `localStorage["<appname>-log-v1"]` に配列で保存する
3. 保存時に `window.dispatchEvent(new CustomEvent("<appname>:changed"))` を発火する
4. HTMLに同期UI（`#sync-status` `#sync-code` `#sync-connect` など）を置き、
   `sync.js` を読み込む前に `window.SYNC_APP = "<appname>"` を指定する
5. リモート反映は `window.addEventListener("<appname>:remote", ...)` で受けて再描画する

同期は `window.SYNC_APP` ごとに Firestore コレクション・保存キーが分かれるため、
1つのFirebaseプロジェクトで全アプリを独立して同期できます。

## 公開

GitHub の Settings → Pages で公開すると、
`https://<ユーザー名>.github.io/life-log/`（ホーム）、
`https://<ユーザー名>.github.io/life-log/kintore.html`（筋トレ）でアクセスできます。
