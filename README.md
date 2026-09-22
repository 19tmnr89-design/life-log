# マイライフログ (life-log)

日々の記録をまとめて管理・分析するための、個人用ミニアプリ集です。
サーバー不要（GitHub Pagesでホスティング）で、データは端末のブラウザに保存され、
Firebaseによる同期コードでスマホ・PC間で共有されます。

## 構成（すべて直下・フォルダなし）

```
index.html            ホーム（各アプリへのリンク集）
sync.js               端末間同期（Firebase Firestore・全アプリ共通）
firebase-config.js    Firebase接続設定（共通）

kintore.html           💪 筋トレログ本体
app.js / style.css     筋トレログの処理・デザイン
import_template.csv    筋トレログ用の取り込みテンプレート

money.html              💰 お金ログ（家計簿・資産管理）
money.app.js / money.css

hoken.html                     ☂️ もしもシート（保険の整理・もしもの時のお金）
hoken.app.js                   画面・入力・グラフ
hoken.data.js / hoken.sim.js   マスターデータ・シミュレーション計算（純粋関数）
hoken.css
```

詳しい設計の経緯・データ形式・落とし穴は [`CLAUDE.md`](./CLAUDE.md) を参照。

新しいアプリを足すときも `<name>.html` + `<name>.app.js` + `<name>.css` として
直下に追加していきます（同期の `sync.js` は共通で使い回し）。

## アプリの追加方法（開発メモ）

1. `<appname>.html` / `<appname>.app.js` / `<appname>.css` を直下に置く
2. データは `localStorage["<appname>-log-v1"]` に保存する
   - 記録の**配列**（筋トレ・お金ログの形）なら、そのまま `sync.js` の既定動作
     （和集合マージ）が使える
   - 記録ではなく**1つのオブジェクト**（もしもシートの形：契約・前提のまとまり）なら、
     `window.SYNC_MODE = "replace"` を指定する（「新しい方で丸ごと置き換え、
     食い違うときは確認ダイアログ」という動作になる）
3. 保存時に `window.dispatchEvent(new CustomEvent("<appname>:changed"))` を発火する
4. HTMLに同期UI（`#sync-status` `#sync-code` `#sync-connect` など）を置き、
   `sync.js` を読み込む前に `window.SYNC_APP = "<appname>"`（必要なら `SYNC_MODE` も）を指定する
5. リモート反映は `window.addEventListener("<appname>:remote", ...)` で受けて再描画する

同期は `window.SYNC_APP` ごとに Firestore コレクション・保存キーが分かれるため、
1つのFirebaseプロジェクトで全アプリを独立して同期できます。

### 個人の実データはコードに置かない

**このリポジトリは公開です。** 口座名・保険会社名・金額・契約内容などの実データは
コードにもコミットメッセージにも一切書きません。実データは各アプリの「データ」画面の
CSV/JSON取り込みから入れ、Firebase同期で他の端末に配ります（お金ログ・もしもシート共通）。
詳細は `CLAUDE.md` の「守ること」章を参照。

## 公開

GitHub の Settings → Pages で公開すると、次のURLでアクセスできます。

- `https://<ユーザー名>.github.io/life-log/`（ホーム）
- `https://<ユーザー名>.github.io/life-log/kintore.html`（筋トレ）
- `https://<ユーザー名>.github.io/life-log/money.html`（お金）
- `https://<ユーザー名>.github.io/life-log/hoken.html`（もしも）
