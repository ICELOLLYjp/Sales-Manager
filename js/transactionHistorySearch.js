const CONTROL_CLASS = "transaction-history-search-controls";

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/\s+/g, " ")
    .trim();
}

function findHistorySections() {
  return Array.from(document.querySelectorAll(".card-title"))
    .filter(element => element.textContent?.trim() === "会計履歴")
    .map(element => ({
      title: element,
      section: element.parentElement
    }))
    .filter(item => item.section);
}

function enhanceHistorySection({ title, section }) {
  if (section.querySelector(`.${CONTROL_CLASS}`)) {
    return;
  }

  const transactionRows = Array.from(section.children)
    .filter(element => (
      element !== title &&
      element.tagName === "DIV" &&
      (
        element.querySelector(".voidSaleTransactionButton") ||
        element.textContent?.includes("取消済み")
      )
    ));

  if (!transactionRows.length) {
    return;
  }

  const controls = document.createElement("div");
  controls.className = CONTROL_CLASS;
  controls.style.cssText = [
    "display:grid",
    "gap:7px",
    "margin:8px 0 4px"
  ].join(";");

  controls.innerHTML = `
    <input
      class="transaction-history-search-input"
      type="search"
      placeholder="金額・Transaction ID・時刻などで検索"
      autocomplete="off"
      style="
        width:100%;
        min-height:44px;
        padding:0 12px;
        border:1px solid #deded9;
        border-radius:12px;
        background:#fff;
      "
    >

    <div
      style="
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:7px;
      "
    >
      <select
        class="transaction-history-payment-filter"
        style="
          width:100%;
          min-height:40px;
          padding:0 9px;
          border:1px solid #deded9;
          border-radius:10px;
          background:#fff;
        "
      >
        <option value="all">支払方法：すべて</option>
        <option value="stripe">Stripe</option>
        <option value="other">Stripe以外</option>
      </select>

      <select
        class="transaction-history-status-filter"
        style="
          width:100%;
          min-height:40px;
          padding:0 9px;
          border:1px solid #deded9;
          border-radius:10px;
          background:#fff;
        "
      >
        <option value="all">状態：すべて</option>
        <option value="active">有効</option>
        <option value="voided">取消済み</option>
      </select>
    </div>

    <div
      class="transaction-history-search-count muted"
      style="
        min-height:16px;
        font-size:11px;
      "
    ></div>
  `;

  title.insertAdjacentElement("afterend", controls);

  const searchInput = controls.querySelector(
    ".transaction-history-search-input"
  );
  const paymentFilter = controls.querySelector(
    ".transaction-history-payment-filter"
  );
  const statusFilter = controls.querySelector(
    ".transaction-history-status-filter"
  );
  const count = controls.querySelector(
    ".transaction-history-search-count"
  );

  function applyFilter() {
    const query = normalizeSearchText(searchInput?.value);
    const payment = paymentFilter?.value || "all";
    const status = statusFilter?.value || "all";

    let visibleCount = 0;

    transactionRows.forEach(row => {
      const rowText = normalizeSearchText(row.textContent);
      const isStripe = rowText.includes("stripe");
      const isVoided = rowText.includes("取消済み");

      const searchMatches = !query || rowText.includes(query);
      const paymentMatches = (
        payment === "all" ||
        (payment === "stripe" && isStripe) ||
        (payment === "other" && !isStripe)
      );
      const statusMatches = (
        status === "all" ||
        (status === "active" && !isVoided) ||
        (status === "voided" && isVoided)
      );

      const visible = (
        searchMatches &&
        paymentMatches &&
        statusMatches
      );

      row.style.display = visible ? "" : "none";

      if (visible) {
        visibleCount += 1;
      }
    });

    if (count) {
      count.textContent = `${visibleCount} / ${transactionRows.length} 件`;
    }
  }

  searchInput?.addEventListener("input", applyFilter);
  paymentFilter?.addEventListener("change", applyFilter);
  statusFilter?.addEventListener("change", applyFilter);

  applyFilter();
}

function enhanceTransactionHistory() {
  findHistorySections().forEach(enhanceHistorySection);
}

const view = document.querySelector("#view");

if (view) {
  const observer = new MutationObserver(() => {
    enhanceTransactionHistory();
  });

  observer.observe(view, {
    childList: true,
    subtree: true
  });
}

enhanceTransactionHistory();
