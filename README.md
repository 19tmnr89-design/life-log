<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="theme-color" content="#12141c">
<title>マイライフログ</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #12141c; --panel: #1c1f2b; --panel2: #262a3a;
    --text: #e8eaf2; --sub: #9aa0b4; --line: #34394e; --accent: #4dabf7;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
    background: var(--bg); color: var(--text); min-height: 100vh;
    padding: 28px 18px 40px; max-width: 640px; margin: 0 auto;
  }
  header { margin-bottom: 24px; }
  h1 { font-size: 22px; font-weight: 700; }
  .sub { color: var(--sub); font-size: 13px; margin-top: 6px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .app-card {
    display: flex; flex-direction: column; gap: 6px;
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 14px; padding: 18px 16px; text-decoration: none; color: var(--text);
    min-height: 108px; justify-content: center;
  }
  .app-card:active { opacity: 0.8; }
  .app-card .emoji { font-size: 30px; }
  .app-card .name { font-size: 15px; font-weight: 700; }
  .app-card .desc { font-size: 11px; color: var(--sub); }
  .app-card.soon { opacity: 0.55; }
  .app-card.soon .badge {
    font-size: 10px; color: var(--sub); background: var(--panel2);
    padding: 2px 8px; border-radius: 999px; align-self: flex-start; margin-top: 2px;
  }
  footer { margin-top: 28px; color: var(--sub); font-size: 11px; text-align: center; }
</style>
</head>
<body>
<header>
  <h1>🗂 マイライフログ</h1>
  <p class="sub">日々の記録をまとめて管理・分析</p>
</header>

<div class="grid">
  <a class="app-card" href="kintore/">
    <span class="emoji">💪</span>
    <span class="name">筋トレログ</span>
    <span class="desc">トレーニング記録と分析</span>
  </a>
  <div class="app-card soon">
    <span class="emoji">✅</span>
    <span class="name">習慣</span>
    <span class="badge">準備中</span>
  </div>
  <div class="app-card soon">
    <span class="emoji">💰</span>
    <span class="name">お金</span>
    <span class="badge">準備中</span>
  </div>
  <div class="app-card soon">
    <span class="emoji">📊</span>
    <span class="name">ライフプラン</span>
    <span class="badge">準備中</span>
  </div>
  <div class="app-card soon">
    <span class="emoji">📚</span>
    <span class="name">読書記録</span>
    <span class="badge">準備中</span>
  </div>
</div>

<footer>各アプリのデータは端末に保存され、同期コードでスマホ・PC間で共有されます。</footer>
</body>
</html>
