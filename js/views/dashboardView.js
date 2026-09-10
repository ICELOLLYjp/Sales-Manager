export function renderDashboard({ firebaseEnabled = false } = {}) {
  return `
    <h1 class="page-title">Dashboard</h1>
    <p class="page-note">Version 1 foundation</p>

    ${!firebaseEnabled ? `
      <div class="warning">
        Firebaseはまだ未接続です。firebase-config.jsへ設定を入れると接続できます。
      </div>
    ` : ""}

    <div class="grid grid-2">
      <section class="card">
        <div class="metric">¥0</div>
        <div class="metric-label">Sales</div>
      </section>
      <section class="card">
        <div class="metric">¥0</div>
        <div class="metric-label">Profit</div>
      </section>
    </div>

    <section class="card">
      <div class="card-title">Phase 1</div>
      <div class="list-row"><span>商品カテゴリ</span><span class="pill">8</span></div>
      <div class="list-row"><span>通貨</span><span class="pill">6</span></div>
      <div class="list-row"><span>在庫Adapter</span><span class="pill">Ready</span></div>
    </section>
  `;
}
