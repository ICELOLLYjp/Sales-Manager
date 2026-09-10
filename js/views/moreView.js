import { listCategoryTemplates } from "../services/productService.js";
import { listCurrencies } from "../services/currencyService.js";

export function renderMore() {
  const categories = listCategoryTemplates();
  const currencies = listCurrencies();

  return `
    <h1 class="page-title">More</h1>
    <p class="page-note">商品・通貨・設定</p>

    <section class="card">
      <div class="card-title">Product Categories</div>
      <div class="category-grid">
        ${categories.map(item => `
          <button class="category-btn" type="button">
            ${item.labelJa}
            <small>${item.posLabel}</small>
          </button>
        `).join("")}
      </div>
    </section>

    <section class="card">
      <div class="card-title">Currencies</div>
      ${currencies.map(c => `
        <div class="list-row">
          <span>${c.code}</span>
          <span class="muted">${c.symbol} ${c.name}</span>
        </div>
      `).join("")}
    </section>
  `;
}
