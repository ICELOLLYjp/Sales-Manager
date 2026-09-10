import { initFirebase } from "./firebase.js";
import { initAuth, loginWithGoogle, logout } from "./auth.js";
import { renderDashboard } from "./views/dashboardView.js";
import { tshirtAdapter } from "./inventoryAdapters/tshirtAdapter.js";
import { accessoryAdapter } from "./inventoryAdapters/accessoryAdapter.js";
import { loadTshirtProductVariants, syncTshirtCurrentStockRows } from "./services/catalogService.js";
import { listAllProductVariants, registerTshirtVariant, registerGeneralProduct, syncAccessoryCatalogRows } from "./services/productAdminService.js";
import { CATEGORY_TEMPLATES, getCategoryTemplate } from "./data/categoryTemplates.js";
import { loadPosPriceConfig, savePosPriceConfig, QUICK_PRICE_CURRENCIES } from "./services/priceBookService.js?v=20260911-mixmatch-2";
import { listSalesSessions, createEventSession, updateEventSession, updateEventExpenses, SESSION_CURRENCIES } from "./services/sessionService.js";
import { commitQuickSale, voidSaleTransaction } from "./services/transactionService.js?v=20260911-cost-snapshot-1";
import { listSessionTransactions } from "./services/salesHistoryService.js?v=20260910-setdiscount-2";
import { saveCategoryCost, loadAllCategoryCostHistories, resolveCategoryUnitCost, saveTshirtBodyCost, loadTshirtBodyCostHistories, resolveBodyUnitCost, saveVariantCost, loadVariantCostHistories, calculateResolvedCogs } from "./services/costHistoryService.js?v=20260911-cost-snapshot-1";
import { loadPinkoiTshirtCatalog, syncPinkoiTshirtCatalog } from "./services/pinkoiCatalogService.js";
let sessionLifecycleModulePromise =
  null;

async function sessionLifecycleModule() {
  if (
    !sessionLifecycleModulePromise
  ) {
    sessionLifecycleModulePromise =
      import(
        "./services/sessionLifecycleService.js?v=20260910-import-fix-1"
      );
  }

  return await sessionLifecycleModulePromise;
}

async function inspectEventSessionRemoval(
  sessionId
) {
  const module =
    await sessionLifecycleModule();

  return await module
    .inspectEventSessionRemoval(
      sessionId
    );
}

async function deleteEventSession(
  sessionId
) {
  const module =
    await sessionLifecycleModule();

  return await module
    .deleteEventSession(
      sessionId
    );
}

async function archiveEventSession(
  sessionId,
  options
) {
  const module =
    await sessionLifecycleModule();

  return await module
    .archiveEventSession(
      sessionId,
      options
    );
}

async function restoreArchivedEventSession(
  sessionId
) {
  const module =
    await sessionLifecycleModule();

  return await module
    .restoreArchivedEventSession(
      sessionId
    );
}



let inventoryCountServicePromise =
  null;

async function inventoryCountService() {
  if (
    !inventoryCountServicePromise
  ) {
    inventoryCountServicePromise =
      import(
        "./services/inventoryCountService.js?v=20260911-safe-opening-1"
      )
        .catch(
          error => {
            inventoryCountServicePromise =
              null;

            throw new Error(
              `イベント在庫確認モジュールを読み込めませんでした。js/services/inventoryCountService.js の配置を確認してください。 ${error?.message || error}`
            );
          }
        );
  }

  return await inventoryCountServicePromise;
}

async function loadEventInventoryCount(
  ...args
) {
  const service =
    await inventoryCountService();

  return await service
    .loadEventInventoryCount(
      ...args
    );
}

async function saveEventOpeningInventory(
  ...args
) {
  const service =
    await inventoryCountService();

  return await service
    .saveEventOpeningInventory(
      ...args
    );
}

async function resetEventOpeningInventory(
  ...args
) {
  const service =
    await inventoryCountService();

  return await service
    .resetEventOpeningInventory(
      ...args
    );
}


async function saveEventClosingInventory(
  ...args
) {
  const service =
    await inventoryCountService();

  return await service
    .saveEventClosingInventory(
      ...args
    );
}


let eventCloseServicePromise =
  null;

async function eventCloseService() {
  if (
    !eventCloseServicePromise
  ) {
    eventCloseServicePromise =
      import(
        "./services/eventCloseService.js?v=20260911-event-finalize-1"
      )
        .catch(
          error => {
            eventCloseServicePromise =
              null;

            throw new Error(
              `イベント終了モジュールを読み込めませんでした。js/services/eventCloseService.js の配置を確認してください。 ${error?.message || error}`
            );
          }
        );
  }

  return await eventCloseServicePromise;
}

async function finalizeEventSession(
  ...args
) {
  const service =
    await eventCloseService();

  return await service
    .finalizeEventSession(
      ...args
    );
}


const view = document.querySelector("#view");
view.dataset.booted = "true";
const syncStatus = document.querySelector("#syncStatus");

let firebaseState = null;
let currentUser = null;
let authError = null;
let currentRoute = "dashboard";
let renderSequence = 0;

const POS_CATEGORY_ORDER = [
  "tshirt",
  "pierce",
  "earring",
  "drop_pierce",
  "drop_earring",
  "sticker",
  "postcard",
  "art_print"
];

const POS_CATEGORY_LABELS = {
  tshirt: "Tシャツ",
  pierce: "ピアス",
  earring: "イヤリング",
  drop_pierce: "ドロップタイプピアス",
  drop_earring: "ドロップタイプイヤリング",
  sticker: "ステッカー",
  postcard: "ポストカード",
  art_print: "アートプリント"
};


const TSHIRT_PRICE_BODY_ORDER = [
  {
    id: "Vintage",
    label: "Pigment T Shirt"
  },
  {
    id: "Organic",
    label: "Organic Cotton T Shirt"
  },
  {
    id: "MIJ",
    label: "Made in Japan T Shirt"
  }
];

function tshirtBodyPriceKey(
  value
) {
  const normalized =
    String(
      value || ""
    )
      .trim()
      .toLocaleLowerCase();

  if (
    normalized === "vintage" ||
    normalized.includes(
      "pigment"
    )
  ) {
    return "Vintage";
  }

  if (
    normalized === "organic" ||
    normalized.includes(
      "organic"
    )
  ) {
    return "Organic";
  }

  if (
    normalized === "mij" ||
    normalized.includes(
      "made in japan"
    ) ||
    normalized.includes(
      "japan"
    )
  ) {
    return "MIJ";
  }

  return "";
}

function tshirtBodyLabel(
  bodyId
) {
  return (
    TSHIRT_PRICE_BODY_ORDER
      .find(
        item =>
          item.id === bodyId
      )
      ?.label ||
    bodyId ||
    "Tシャツ"
  );
}

let posCurrency =
  localStorage.getItem(
    "icelolly-sales-pos-currency"
  ) || "JPY";

let posPriceBook = {};
let posSetOfferBook = {};
let posTshirtBodyPriceBook = {};
let posTshirtBodySetOfferBook = {};
let posTshirtMixMatchDiscountBook = {};
let posPriceBookLoaded = false;
let posCart = new Map();
let posOrderDiscount = 0;

let activeSessionId =
  localStorage.getItem(
    "icelolly-sales-active-session"
  ) || "";

let pendingCheckoutTransactionId =
  null;

let lastCheckoutResult =
  null;

let editingSessionId =
  "";

let posPriceSettingsOpen =
  false;

let posMode =
  localStorage.getItem(
    "icelolly-sales-pos-mode"
  ) || "quick";

let posSkuCategory =
  "tshirt";

let posSkuSearch =
  "";

let sessionDetailId =
  "";

let sessionInventoryCountId =
  "";

let sessionOpeningEditId =
  "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateNavigation() {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.route === currentRoute);
  });
}

function renderLogin() {
  updateNavigation();
  syncStatus.textContent = "Login";

  view.innerHTML = `
    <div style="max-width:420px;margin:40px auto;">
      <section class="card">
        <h1 class="page-title" style="margin-top:0;">ICELOLLY</h1>
        <p class="page-note">Sales Manager</p>

        ${authError ? `<div class="warning">${escapeHtml(authError.message || authError)}</div>` : ""}

        <button id="googleLoginButton" class="button" style="width:100%;" type="button">
          Googleでログイン
        </button>
      </section>
    </div>
  `;

  document.querySelector("#googleLoginButton")?.addEventListener("click", async () => {
    try {
      await loginWithGoogle();
    } catch (error) {
      authError = error;
      renderLogin();
    }
  });
}

function simplePage(title, note) {
  return `
    <h1 class="page-title">${escapeHtml(title)}</h1>
    <p class="page-note">${escapeHtml(note)}</p>
    <section class="card">
      <div class="muted">この画面は次のPhaseで実装します。</div>
    </section>
  `;
}

function selectStyle() {
  return "width:100%;min-height:46px;padding:0 10px;border:1px solid #deded9;border-radius:12px;background:white;";
}

function inputStyle() {
  return "width:100%;min-height:46px;padding:0 12px;border:1px solid #deded9;border-radius:12px;background:white;";
}

async function renderInventory(sequence) {
  view.innerHTML = `
    <h1 class="page-title">Inventory</h1>
    <p class="page-note">在庫を読み込んでいます</p>
  `;

  try {
    const [
      tshirtInventory,
      accessoryCatalog,
      allVariants
    ] = await Promise.all([
      tshirtAdapter.getInventorySnapshot(),
      accessoryAdapter.getCatalogSnapshot(),
      listAllProductVariants()
    ]);

    if (sequence !== renderSequence) {
      return;
    }

    const tshirtRows =
      tshirtInventory.rows;

    const tshirtRegistered =
      allVariants.filter(
        item =>
          item.productId === "tshirt" ||
          item.category === "tshirt"
      );

    const tshirtRegisteredMap =
      new Map(
        tshirtRegistered.map(
          item => [
            item.variantId ||
            item.id,
            item
          ]
        )
      );

    const tshirtCurrentIds =
      new Set(
        tshirtRows.map(
          row =>
            row.variantId
        )
      );

    const tshirtUnregistered =
      tshirtRows.filter(
        row =>
          !tshirtRegisteredMap.has(
            row.variantId
          )
      );

    const tshirtSoldOut =
      tshirtRegistered.filter(
        item =>
          !tshirtCurrentIds.has(
            item.variantId ||
            item.id
          )
      );

    const accessoryRows =
      accessoryCatalog.rows;

    const accessoryRegistered =
      allVariants.filter(
        item =>
          item.inventorySource ===
          "accessory"
      );

    const accessoryRegisteredMap =
      new Map(
        accessoryRegistered.map(
          item => [
            item.variantId ||
            item.id,
            item
          ]
        )
      );

    const accessoryCurrentIds =
      new Set(
        accessoryRows.map(
          row =>
            row.variantId
        )
      );

    const accessoryUnregistered =
      accessoryRows.filter(
        row =>
          !accessoryRegisteredMap.has(
            row.variantId
          )
      );

    const accessorySoldOut =
      accessoryRegistered.filter(
        item =>
          !accessoryCurrentIds.has(
            item.variantId ||
            item.id
          )
      );

    const accessoryCategories = [
      {
        id:
          "pierce",
        label:
          "ピアス"
      },
      {
        id:
          "earring",
        label:
          "イヤリング"
      },
      {
        id:
          "drop_pierce",
        label:
          "ドロップタイプピアス"
      },
      {
        id:
          "drop_earring",
        label:
          "ドロップタイプイヤリング"
      }
    ];

    const totalTrackedStock =
      Number(
        tshirtInventory
          .summary
          .totalStock || 0
      ) +
      Number(
        accessoryCatalog
          .summary
          .totalStock || 0
      );

    function categoryCurrentRows(
      category
    ) {
      return accessoryRows
        .filter(
          row =>
            row.category ===
            category
        );
    }

    function categoryRegisteredCount(
      category
    ) {
      return accessoryRegistered
        .filter(
          item =>
            item.category ===
            category
        )
        .length;
    }

    const inventoryTshirtSizes = [
      "S",
      "M",
      "L",
      "XL",
      "XXL"
    ];

    function groupInventoryTshirtRows(
      rows
    ) {
      const groups =
        new Map();

      (
        Array.isArray(rows)
          ? rows
          : []
      ).forEach(
        row => {
          const key =
            [
              row.design || "",
              row.body || "",
              row.color || ""
            ].join("||");

          if (
            !groups.has(
              key
            )
          ) {
            groups.set(
              key,
              {
                design:
                  row.design ||
                  "Tシャツ",
                body:
                  row.body ||
                  "",
                color:
                  row.color ||
                  "",
                items: []
              }
            );
          }

          groups
            .get(
              key
            )
            .items
            .push(
              row
            );
        }
      );

      return Array.from(
        groups.values()
      )
        .sort(
          (a, b) =>
            a.design.localeCompare(
              b.design,
              "ja"
            ) ||
            a.body.localeCompare(
              b.body,
              "ja"
            ) ||
            a.color.localeCompare(
              b.color,
              "ja"
            )
        );
    }

    function groupInventoryAccessoryRows(
      rows
    ) {
      const groups =
        new Map();

      (
        Array.isArray(rows)
          ? rows
          : []
      ).forEach(
        row => {
          const design =
            row.displayName ||
            row.design ||
            "アクセサリー";

          if (
            !groups.has(
              design
            )
          ) {
            groups.set(
              design,
              {
                design,
                items: []
              }
            );
          }

          groups
            .get(
              design
            )
            .items
            .push(
              row
            );
        }
      );

      return Array.from(
        groups.values()
      )
        .sort(
          (a, b) =>
            a.design.localeCompare(
              b.design,
              "ja"
            )
        );
    }

    const tshirtInventoryGroups =
      groupInventoryTshirtRows(
        tshirtRows
      );

    const accessoryInventoryGroups =
      groupInventoryAccessoryRows(
        accessoryRows
      );

    view.innerHTML = `
      <h1 class="page-title">
        Inventory
      </h1>

      <p class="page-note">
        Tシャツとアクセサリー
      </p>


      <div class="grid grid-2">

        <section class="card">
          <div class="metric">
            ${totalTrackedStock}
          </div>

          <div class="metric-label">
            Tracked Stock
          </div>
        </section>


        <section class="card">
          <div class="metric">
            ${tshirtInventory.summary.totalStock}
          </div>

          <div class="metric-label">
            T Shirt
          </div>
        </section>


        <section class="card">
          <div class="metric">
            ${accessoryCatalog.summary.totalStock}
          </div>

          <div class="metric-label">
            Accessory
          </div>
        </section>


        <section class="card">
          <div class="metric">
            ${
              tshirtRegistered.length +
              accessoryRegistered.length
            }
          </div>

          <div class="metric-label">
            Registered SKU
          </div>
        </section>

      </div>


      <details
        class="card"
        style="
          margin-top:14px;
        "
      >
        <summary
          style="
            cursor:pointer;
            font-weight:800;
            font-size:16px;
          "
        >
          SKU登録状況
        </summary>

        <div
          style="
            display:grid;
            grid-template-columns:
              repeat(2,minmax(0,1fr));
            gap:10px;
            margin-top:12px;
          "
        >
          <div
            style="
              padding:12px;
              border:1px solid #ecece7;
              border-radius:12px;
            "
          >
            <div
              style="
                font-weight:800;
                margin-bottom:8px;
              "
            >
              Tシャツ
            </div>

            <div class="list-row">
              <span>現在在庫</span>
              <strong>
                ${tshirtInventory.summary.totalStock}
              </strong>
            </div>

            <div class="list-row">
              <span>在庫ありSKU</span>
              <strong>
                ${tshirtRows.length}
              </strong>
            </div>

            <div class="list-row">
              <span>登録済みSKU</span>
              <strong>
                ${tshirtRegistered.length}
              </strong>
            </div>

            <div class="list-row">
              <span>登録済み在庫0</span>
              <strong>
                ${tshirtSoldOut.length}
              </strong>
            </div>
          </div>

          <div
            style="
              padding:12px;
              border:1px solid #ecece7;
              border-radius:12px;
            "
          >
            <div
              style="
                font-weight:800;
                margin-bottom:8px;
              "
            >
              アクセサリー
            </div>

            <div class="list-row">
              <span>現在在庫</span>
              <strong>
                ${accessoryCatalog.summary.totalStock}
              </strong>
            </div>

            <div class="list-row">
              <span>在庫ありSKU</span>
              <strong>
                ${accessoryRows.length}
              </strong>
            </div>

            <div class="list-row">
              <span>登録済みSKU</span>
              <strong>
                ${accessoryRegistered.length}
              </strong>
            </div>

            <div class="list-row">
              <span>登録済み在庫0</span>
              <strong>
                ${accessorySoldOut.length}
              </strong>
            </div>
          </div>
        </div>

        ${
          tshirtUnregistered.length
            ? `
              <button
                id="syncTshirtCatalogButton"
                class="button"
                type="button"
                style="
                  width:100%;
                  margin-top:12px;
                "
              >
                現在在庫のTシャツSKUを商品登録
              </button>

              <div
                id="syncTshirtCatalogMessage"
                class="muted"
                style="
                  margin-top:8px;
                "
              ></div>
            `
            : ""
        }

        ${
          accessoryUnregistered.length
            ? `
              <button
                id="syncAccessoryCatalogButtonInventory"
                class="button"
                type="button"
                style="
                  width:100%;
                  margin-top:10px;
                "
              >
                現在在庫のアクセサリーSKUを商品登録
              </button>

              <div
                id="syncAccessoryCatalogMessageInventory"
                class="muted"
                style="
                  margin-top:8px;
                "
              ></div>
            `
            : ""
        }

        <div
          style="
            margin-top:12px;
            padding-top:10px;
            border-top:1px solid #ecece7;
          "
        >
          ${accessoryCategories.map(
            category => {
              const current =
                categoryCurrentRows(
                  category.id
                );

              const stock =
                current.reduce(
                  (
                    sum,
                    row
                  ) =>
                    sum +
                    Number(
                      row.quantity ||
                      0
                    ),
                  0
                );

              return `
                <div class="list-row">
                  <span>
                    ${escapeHtml(
                      category.label
                    )}
                  </span>

                  <span
                    style="
                      text-align:right;
                    "
                  >
                    <strong>
                      ${stock}
                    </strong>

                    <span class="muted">
                      /
                      ${categoryRegisteredCount(
                        category.id
                      )}
                      SKU
                    </span>
                  </span>
                </div>
              `;
            }
          ).join("")}
        </div>
      </details>


      <section
        class="card"
        style="
          margin-top:14px;
        "
      >
        <div class="card-title">
          現在庫一覧
        </div>

        <div
          style="
            display:flex;
            gap:7px;
            overflow-x:auto;
            padding:2px 0 4px;
            margin-top:10px;
          "
        >
          ${[
            ["all", "すべて"],
            ["tshirt", "Tシャツ"],
            ["accessory", "アクセサリー"]
          ].map(
            ([value, label]) => `
              <button
                type="button"
                class="inventoryViewFilter"
                data-stock-view="${value}"
                style="
                  flex:0 0 auto;
                  min-height:38px;
                  padding:0 13px;
                  border:1px solid #deded9;
                  border-radius:999px;
                  background:${
                    value === "all"
                      ? "#1f1f1f"
                      : "#fff"
                  };
                  color:${
                    value === "all"
                      ? "#fff"
                      : "#1f1f1f"
                  };
                  font-weight:700;
                "
              >
                ${label}
              </button>
            `
          ).join("")}
        </div>

        <input
          id="inventoryStockSearch"
          type="search"
          placeholder="デザイン、色、Body、サイズで検索"
          style="
            ${inputStyle()}
            margin-top:10px;
          "
        >

        <div
          class="muted"
          style="
            margin-top:8px;
            line-height:1.5;
            font-size:12px;
          "
        >
          在庫ありSKUだけを表示しています。横スクロールする表はDesign列140pxで統一し、TシャツのSize列は56pxで表示しています。
        </div>
      </section>


      <section
        id="inventoryTshirtSection"
        class="card inventoryStockSection"
        data-stock-view="tshirt"
        style="
          margin-top:14px;
        "
      >
        <div
          style="
            display:flex;
            justify-content:space-between;
            gap:10px;
            align-items:center;
          "
        >
          <div class="card-title">
            T Shirt Current Stock
          </div>

          <strong>
            ${tshirtInventory.summary.totalStock} 点
          </strong>
        </div>

        <div
          style="
            overflow-x:auto;
            margin-top:10px;
            border:1px solid #ecece7;
            border-radius:14px;
          "
        >
          <div
            style="
              min-width:420px;
            "
          >
            <div
              style="
                display:grid;
                grid-template-columns:
                  140px
                  repeat(5,56px);
                background:#f7f7f4;
                border-bottom:1px solid #ecece7;
                font-size:12px;
                font-weight:800;
              "
            >
              <div
                style="
                  position:sticky;
                  left:0;
                  z-index:4;
                  padding:8px;
                  background:#f7f7f4;
                  border-right:1px solid #e7e7e2;
                  box-shadow:3px 0 6px rgba(0,0,0,.04);
                "
              >
                Design / Body / Color
              </div>

              ${inventoryTshirtSizes.map(
                size => `
                  <div
                    style="
                      padding:9px 4px;
                      text-align:center;
                    "
                  >
                    ${size}
                  </div>
                `
              ).join("")}
            </div>

            ${tshirtInventoryGroups.map(
              group => {
                const searchText =
                  [
                    group.design,
                    group.body,
                    group.color,
                    ...group.items.map(
                      item =>
                        [
                          item.size,
                          item.variantId
                        ]
                          .filter(Boolean)
                          .join(" ")
                    )
                  ]
                    .filter(Boolean)
                    .join(" ")
                    .toLocaleLowerCase();

                return `
                  <div
                    class="inventoryStockRow"
                    data-inventory-type="tshirt"
                    data-search="${escapeHtml(
                      searchText
                    )}"
                    style="
                      display:grid;
                      grid-template-columns:
                        140px
                        repeat(5,56px);
                      border-bottom:1px solid #ecece7;
                    "
                  >
                    <div
                      style="
                        position:sticky;
                        left:0;
                        z-index:3;
                        padding:8px;
                        min-width:0;
                        background:#fff;
                        border-right:1px solid #e7e7e2;
                        box-shadow:3px 0 6px rgba(0,0,0,.04);
                      "
                    >
                      <div
                        style="
                          font-weight:800;
                          font-size:14px;
                          line-height:1.2;
                          overflow-wrap:anywhere;
                        "
                      >
                        ${escapeHtml(
                          group.design
                        )}
                      </div>

                      <div
                        class="muted"
                        style="
                          margin-top:3px;
                          font-size:10px;
                          line-height:1.25;
                          overflow-wrap:anywhere;
                        "
                      >
                        ${escapeHtml(
                          [
                            group.body,
                            group.color
                          ]
                            .filter(Boolean)
                            .join(" / ")
                        )}
                      </div>
                    </div>

                    ${inventoryTshirtSizes.map(
                      size => {
                        const row =
                          group.items.find(
                            item =>
                              item.size ===
                              size
                          );

                        if (!row) {
                          return `
                            <div
                              style="
                                min-height:58px;
                                display:flex;
                                align-items:center;
                                justify-content:center;
                                border-left:1px solid #f0f0ec;
                                background:#f3f3f0;
                                color:#bbb;
                              "
                            >
                              —
                            </div>
                          `;
                        }

                        const registered =
                          tshirtRegisteredMap.has(
                            row.variantId
                          );

                        return `
                          <div
                            style="
                              min-height:58px;
                              padding:7px 4px;
                              display:flex;
                              flex-direction:column;
                              align-items:center;
                              justify-content:center;
                              border-left:1px solid #f0f0ec;
                              background:#fff;
                              text-align:center;
                            "
                          >
                            <div
                              style="
                                font-size:18px;
                                font-weight:800;
                              "
                            >
                              ${row.quantity}
                            </div>

                            ${
                              registered
                                ? ""
                                : `
                                  <div
                                    style="
                                      margin-top:2px;
                                      font-size:9px;
                                      color:#b65a3a;
                                      font-weight:700;
                                    "
                                  >
                                    未登録
                                  </div>
                                `
                            }
                          </div>
                        `;
                      }
                    ).join("")}
                  </div>
                `;
              }
            ).join("")}
          </div>
        </div>
      </section>


      <section
        id="inventoryAccessorySection"
        class="card inventoryStockSection"
        data-stock-view="accessory"
        style="
          margin-top:14px;
        "
      >
        <div
          style="
            display:flex;
            justify-content:space-between;
            gap:10px;
            align-items:center;
          "
        >
          <div class="card-title">
            Accessory Current Stock
          </div>

          <strong>
            ${accessoryCatalog.summary.totalStock} 点
          </strong>
        </div>

        <div
          style="
            overflow-x:auto;
            margin-top:10px;
            border:1px solid #ecece7;
            border-radius:14px;
          "
        >
          <div
            style="
              min-width:390px;
            "
          >
            <div
              style="
                display:grid;
                grid-template-columns:
                  140px
                  repeat(4,62px);
                background:#f7f7f4;
                border-bottom:1px solid #ecece7;
                font-size:11px;
                font-weight:800;
              "
            >
              <div
                style="
                  position:sticky;
                  left:0;
                  z-index:4;
                  padding:8px;
                  background:#f7f7f4;
                  border-right:1px solid #e7e7e2;
                  box-shadow:3px 0 6px rgba(0,0,0,.04);
                "
              >
                Design
              </div>

              <div
                style="
                  padding:9px 4px;
                  text-align:center;
                "
              >
                Pierce
              </div>

              <div
                style="
                  padding:9px 4px;
                  text-align:center;
                "
              >
                Earring
              </div>

              <div
                style="
                  padding:9px 4px;
                  text-align:center;
                "
              >
                Drop P
              </div>

              <div
                style="
                  padding:9px 4px;
                  text-align:center;
                "
              >
                Drop E
              </div>
            </div>

            ${accessoryInventoryGroups.map(
              group => {
                const searchText =
                  [
                    group.design,
                    ...group.items.map(
                      item =>
                        [
                          item.categoryLabel,
                          item.category,
                          item.variantId
                        ]
                          .filter(Boolean)
                          .join(" ")
                    )
                  ]
                    .filter(Boolean)
                    .join(" ")
                    .toLocaleLowerCase();

                const categoryOrder = [
                  "pierce",
                  "earring",
                  "drop_pierce",
                  "drop_earring"
                ];

                return `
                  <div
                    class="inventoryStockRow"
                    data-inventory-type="accessory"
                    data-search="${escapeHtml(
                      searchText
                    )}"
                    style="
                      display:grid;
                      grid-template-columns:
                        140px
                        repeat(4,62px);
                      border-bottom:1px solid #ecece7;
                    "
                  >
                    <div
                      style="
                        position:sticky;
                        left:0;
                        z-index:3;
                        padding:8px;
                        min-width:0;
                        background:#fff;
                        border-right:1px solid #e7e7e2;
                        box-shadow:3px 0 6px rgba(0,0,0,.04);
                      "
                    >
                      <div
                        style="
                          font-weight:800;
                          font-size:14px;
                          line-height:1.2;
                          overflow-wrap:anywhere;
                        "
                      >
                        ${escapeHtml(
                          group.design
                        )}
                      </div>
                    </div>

                    ${categoryOrder.map(
                      category => {
                        const rows =
                          group.items.filter(
                            item =>
                              item.category ===
                              category
                          );

                        if (!rows.length) {
                          return `
                            <div
                              style="
                                min-height:58px;
                                display:flex;
                                align-items:center;
                                justify-content:center;
                                border-left:1px solid #f0f0ec;
                                background:#f3f3f0;
                                color:#bbb;
                              "
                            >
                              —
                            </div>
                          `;
                        }

                        const quantity =
                          rows.reduce(
                            (sum, row) =>
                              sum +
                              Number(
                                row.quantity ||
                                0
                              ),
                            0
                          );

                        const unregistered =
                          rows.some(
                            row =>
                              !accessoryRegisteredMap.has(
                                row.variantId
                              )
                          );

                        return `
                          <div
                            style="
                              min-height:58px;
                              padding:7px 4px;
                              display:flex;
                              flex-direction:column;
                              align-items:center;
                              justify-content:center;
                              border-left:1px solid #f0f0ec;
                              background:#fff;
                              text-align:center;
                            "
                          >
                            <div
                              style="
                                font-size:18px;
                                font-weight:800;
                              "
                            >
                              ${quantity}
                            </div>

                            ${
                              unregistered
                                ? `
                                  <div
                                    style="
                                      margin-top:2px;
                                      font-size:9px;
                                      color:#b65a3a;
                                      font-weight:700;
                                    "
                                  >
                                    未登録
                                  </div>
                                `
                                : ""
                            }
                          </div>
                        `;
                      }
                    ).join("")}
                  </div>
                `;
              }
            ).join("")}
          </div>
        </div>
      </section>
    `;


    const tshirtSyncButton =
      document.querySelector(
        "#syncTshirtCatalogButton"
      );


    tshirtSyncButton
      ?.addEventListener(
        "click",
        async () => {

          const message =
            document.querySelector(
              "#syncTshirtCatalogMessage"
            );


          tshirtSyncButton.disabled =
            true;


          tshirtSyncButton.textContent =
            "登録中";


          try {

            const result =
              await syncTshirtCurrentStockRows(
                tshirtUnregistered
              );


            if (message) {

              message.textContent =
                `${result.processed} SKUを登録しました。`;
            }


            await renderInventory(
              ++renderSequence
            );


          } catch (error) {

            tshirtSyncButton.disabled =
              false;


            tshirtSyncButton.textContent =
              "現在在庫のTシャツSKUを商品登録";


            if (message) {

              message.textContent =
                error.code ||
                error.message ||
                String(error);
            }
          }
        }
      );


    const accessorySyncButton =
      document.querySelector(
        "#syncAccessoryCatalogButtonInventory"
      );


    accessorySyncButton
      ?.addEventListener(
        "click",
        async () => {

          const message =
            document.querySelector(
              "#syncAccessoryCatalogMessageInventory"
            );


          accessorySyncButton.disabled =
            true;


          accessorySyncButton.textContent =
            "登録中";


          try {

            const result =
              await syncAccessoryCatalogRows(
                accessoryUnregistered
              );


            if (message) {

              message.textContent =
                `${result.processed} SKUを登録しました。`;
            }


            await renderInventory(
              ++renderSequence
            );


          } catch (error) {

            accessorySyncButton.disabled =
              false;


            accessorySyncButton.textContent =
              "現在在庫のアクセサリーSKUを商品登録";


            if (message) {

              message.textContent =
                error.code ||
                error.message ||
                String(error);
            }
          }
        }
      );


    let inventoryStockView =
      "all";

    function applyInventoryStockFilters() {
      const query =
        String(
          document
            .querySelector(
              "#inventoryStockSearch"
            )
            ?.value ||
          ""
        )
          .trim()
          .toLocaleLowerCase();

      document
        .querySelectorAll(
          ".inventoryStockRow"
        )
        .forEach(
          row => {
            const type =
              row.dataset
                .inventoryType ||
              "";

            const typeMatch =
              inventoryStockView ===
                "all" ||
              inventoryStockView ===
                type;

            const searchMatch =
              !query ||
              String(
                row.dataset.search ||
                ""
              )
                .toLocaleLowerCase()
                .includes(
                  query
                );

            row.style.display =
              typeMatch &&
              searchMatch
                ? "grid"
                : "none";
          }
        );

      document
        .querySelectorAll(
          ".inventoryStockSection"
        )
        .forEach(
          section => {
            const type =
              section.dataset
                .stockView;

            section.style.display =
              inventoryStockView ===
                "all" ||
              inventoryStockView ===
                type
                ? ""
                : "none";
          }
        );

      document
        .querySelectorAll(
          ".inventoryViewFilter"
        )
        .forEach(
          button => {
            const active =
              button.dataset
                .stockView ===
              inventoryStockView;

            button.style.background =
              active
                ? "#1f1f1f"
                : "#fff";

            button.style.color =
              active
                ? "#fff"
                : "#1f1f1f";
          }
        );
    }

    document
      .querySelectorAll(
        ".inventoryViewFilter"
      )
      .forEach(
        button => {
          button.addEventListener(
            "click",
            () => {
              inventoryStockView =
                button.dataset
                  .stockView ||
                "all";

              applyInventoryStockFilters();
            }
          );
        }
      );

    document
      .querySelector(
        "#inventoryStockSearch"
      )
      ?.addEventListener(
        "input",
        () => {
          applyInventoryStockFilters();
        }
      );


    syncStatus.textContent =
      "Firebase";


  } catch (error) {

    console.error(
      error
    );


    view.innerHTML = `
      <h1 class="page-title">
        Inventory
      </h1>

      <div class="warning">
        ${escapeHtml(
          error.code ||
          error.message ||
          error
        )}
      </div>
    `;
  }
}

function optionList(items, selected = "") {
  return items.map(item => `
    <option value="${escapeHtml(item.id)}" ${item.id === selected ? "selected" : ""}>
      ${escapeHtml(item.name)}
    </option>
  `).join("");
}

async function renderMorePage(sequence) {
  view.innerHTML = `
    <h1 class="page-title">More</h1>
    <p class="page-note">商品管理</p>
    <section class="card"><div class="muted">商品情報を読み込んでいます</div></section>
  `;

  try {
    const [
      tshirtOptions,
      accessoryCatalog,
      allVariants,
      categoryCostHistories,
      tshirtBodyCostHistories,
      pinkoiTshirtCatalog
    ] = await Promise.all([
      tshirtAdapter.getMasterOptions(),
      accessoryAdapter.getCatalogSnapshot(),
      listAllProductVariants(),
      loadAllCategoryCostHistories(),
      loadTshirtBodyCostHistories(),
      loadPinkoiTshirtCatalog()
        .catch(
          error => ({
            error,
            summary: {
              inventoryCount: 0,
              inventoryDocuments: 0,
              skuCount: 0,
              missingSkuCount: 0,
              duplicateSkuCount: 0,
              matchedCount: 0,
              mappedVariants: 0,
              unmatchedCount: 0,
              unmappedVariants: 0,
              ambiguousCount: 0,
              priceCount: 0,
              pricedCount: 0,
              missingPriceCount: 0,
              priceConflictCount: 0,
              masterStockCount: 0,
              masterStockZeroCount: 0,
              syncEligibleCount: 0,
              zeroStockCatalogCount: 0,
              explicitDesignLinkCount: 0,
              compatibilityAliasCount: 0
            },
            items: [],
            variants: [],
            unmapped: [],
            ambiguous: [],
            byVariantId: new Map()
          })
        )
    ]);

    if (sequence !== renderSequence) return;

    const counts = {};
    allVariants.forEach(item => {
      const key = item.category || "other";
      counts[key] = (counts[key] || 0) + 1;
    });

    const otherTemplates = CATEGORY_TEMPLATES.filter(
      item =>
        ![
          "tshirt",
          "pierce",
          "earring",
          "drop_pierce",
          "drop_earring"
        ].includes(item.id)
    );

    const registeredAccessoryIds = new Set(
      allVariants
        .filter(item => item.inventorySource === "accessory")
        .map(item => item.variantId || item.id)
    );

    const accessoryUnregistered = accessoryCatalog.rows.filter(
      row => !registeredAccessoryIds.has(row.variantId)
    );

    const activeVariants =
      allVariants
        .filter(
          item =>
            item.active !==
            false
        )
        .sort(
          (
            a,
            b
          ) => {
            const aLabel =
              [
                POS_CATEGORY_LABELS[
                  a.category
                ] ||
                a.category ||
                "",
                a.design ||
                a.displayName ||
                "",
                a.body ||
                "",
                a.color ||
                "",
                a.size ||
                ""
              ]
                .filter(Boolean)
                .join(" ");

            const bLabel =
              [
                POS_CATEGORY_LABELS[
                  b.category
                ] ||
                b.category ||
                "",
                b.design ||
                b.displayName ||
                "",
                b.body ||
                "",
                b.color ||
                "",
                b.size ||
                ""
              ]
                .filter(Boolean)
                .join(" ");

            return aLabel.localeCompare(
              bLabel,
              "ja"
            );
          }
        );

    function variantCostLabel(
      item
    ) {
      return [
        POS_CATEGORY_LABELS[
          item.category
        ] ||
        item.category ||
        "",
        item.design ||
        item.displayName ||
        "",
        item.body ||
        "",
        item.color ||
        "",
        item.size ||
        ""
      ]
        .filter(Boolean)
        .join(" / ");
    }

    view.innerHTML = `
      <h1 class="page-title">More</h1>
      <p class="page-note">商品管理</p>

      <section class="card">
        <div class="card-title">登録商品</div>

        <div class="category-grid">
          ${CATEGORY_TEMPLATES.map(item => `
            <div class="category-btn" style="cursor:default;">
              ${escapeHtml(item.labelJa)}
              <small>${counts[item.id] || 0} SKU</small>
            </div>
          `).join("")}
        </div>
      </section>

      <section class="card">

        <div class="card-title">
          Pinkoi Tシャツ連携
        </div>

        <div
          class="muted"
          style="
            margin-bottom:12px;
            line-height:1.55;
          "
        >
          SKUと日本価格はPinkoi、正式実在庫は tshirtStock/master.inventory_v2 を使用します。
        </div>

        ${
          pinkoiTshirtCatalog.error
            ? `
              <div class="warning">
                Pinkoi連携データの読み込みに失敗しました。
                Sales Managerの他機能はそのまま利用できます。
                <br>
                ${escapeHtml(
                  pinkoiTshirtCatalog.error.code ||
                  pinkoiTshirtCatalog.error.message ||
                  String(pinkoiTshirtCatalog.error)
                )}
              </div>
            `
            : `
              <div class="list-row">
                <span>Pinkoi Inventory総数</span>
                <strong>${pinkoiTshirtCatalog.summary.inventoryCount}</strong>
              </div>

              <div class="list-row">
                <span>master対応済み</span>
                <strong>${pinkoiTshirtCatalog.summary.matchedCount}</strong>
              </div>

              <div class="list-row">
                <span>master未対応</span>
                <strong>${pinkoiTshirtCatalog.summary.unmatchedCount}</strong>
              </div>

              <div class="list-row">
                <span>ambiguous</span>
                <strong>${pinkoiTshirtCatalog.summary.ambiguousCount}</strong>
              </div>

              <div class="list-row">
                <span>SKUあり</span>
                <strong>${pinkoiTshirtCatalog.summary.skuCount}</strong>
              </div>

              <div class="list-row">
                <span>SKUなし</span>
                <strong>${pinkoiTshirtCatalog.summary.missingSkuCount}</strong>
              </div>

              <div class="list-row">
                <span>重複SKU</span>
                <strong>${pinkoiTshirtCatalog.summary.duplicateSkuCount}</strong>
              </div>

              <div class="list-row">
                <span>日本価格あり</span>
                <strong>${pinkoiTshirtCatalog.summary.priceCount}</strong>
              </div>

              <div class="list-row">
                <span>日本価格なし</span>
                <strong>${pinkoiTshirtCatalog.summary.missingPriceCount}</strong>
              </div>

              <div class="list-row">
                <span>価格不一致</span>
                <strong>${pinkoiTshirtCatalog.summary.priceConflictCount}</strong>
              </div>

              <div class="list-row">
                <span>master在庫あり</span>
                <strong>${pinkoiTshirtCatalog.summary.masterStockCount}</strong>
              </div>

              <div class="list-row">
                <span>master在庫0</span>
                <strong>${pinkoiTshirtCatalog.summary.masterStockZeroCount}</strong>
              </div>

              <div class="list-row">
                <span>同期可能SKU</span>
                <strong>${pinkoiTshirtCatalog.summary.syncEligibleCount}</strong>
              </div>

              <div class="list-row">
                <span>Design明示リンクSKU</span>
                <strong>${pinkoiTshirtCatalog.summary.explicitDesignLinkCount || 0}</strong>
              </div>

              ${
                pinkoiTshirtCatalog.summary.ambiguousCount > 0
                  ? `
                    <div class="warning" style="margin-top:12px;">
                      ambiguous のSKUは自動登録しません。
                    </div>
                  `
                  : ""
              }

              ${
                pinkoiTshirtCatalog.summary.duplicateSkuCount > 0
                  ? `
                    <div class="warning" style="margin-top:12px;">
                      重複SKUは自動登録しません。
                    </div>
                  `
                  : ""
              }

              ${
                pinkoiTshirtCatalog.summary.priceConflictCount > 0
                  ? `
                    <div class="warning" style="margin-top:12px;">
                      価格不一致は自動的に正しい価格を決めません。JPY販売では価格未確定として扱います。
                    </div>
                  `
                  : ""
              }

              ${
                pinkoiTshirtCatalog.items.some(
                  item =>
                    item.masterMatch.status !== "matched" ||
                    item.skuStatus !== "ok"
                )
                  ? `
                    <details style="margin-top:12px;">
                      <summary
                        style="
                          cursor:pointer;
                          font-weight:800;
                          padding:8px 0;
                        "
                      >
                        未対応・要確認SKUの詳細
                      </summary>

                      <div style="margin-top:8px;">
                        ${pinkoiTshirtCatalog.items
                          .filter(
                            item =>
                              item.masterMatch.status !== "matched" ||
                              item.skuStatus !== "ok"
                          )
                          .map(
                            item => `
                              <div
                                style="
                                  padding:10px 0;
                                  border-bottom:1px solid #ecece7;
                                "
                              >
                                <div style="font-weight:700;">
                                  ${escapeHtml(
                                    [
                                      item.names.design,
                                      item.names.body,
                                      item.names.color,
                                      item.pinkoi.size
                                    ]
                                      .filter(Boolean)
                                      .join(" / ")
                                  )}
                                </div>

                                <div
                                  class="muted"
                                  style="
                                    margin-top:4px;
                                    line-height:1.5;
                                    word-break:break-all;
                                  "
                                >
                                  SKU:
                                  ${escapeHtml(item.sku || "未設定")}
                                  <br>

                                  判定:
                                  ${escapeHtml(item.masterMatch.status)}
                                  <br>

                                  理由:
                                  ${escapeHtml(
                                    (
                                      item.masterMatch.reasons || []
                                    ).join(", ") ||
                                    "なし"
                                  )}
                                  <br>

                                  Design照合:
                                  ${escapeHtml(
                                    item.masterMatch
                                      ?.design
                                      ?.method ||
                                    "none"
                                  )}
                                  <br>

                                  masterDesignId:
                                  ${escapeHtml(
                                    item.explicitLinks
                                      ?.masterDesignId ||
                                    "未設定"
                                  )}
                                  <br>

                                  価格:
                                  ${
                                    item.price.priceStatus === "ok"
                                      ? formatMoney(
                                          item.price.priceJpy,
                                          "JPY"
                                        )
                                      : escapeHtml(item.price.priceStatus)
                                  }
                                </div>
                              </div>
                            `
                          )
                          .join("")}
                      </div>
                    </details>
                  `
                  : ""
              }

              ${
                pinkoiTshirtCatalog.items.some(
                  item =>
                    item.price.priceStatus === "price_missing" ||
                    item.price.priceStatus === "price_conflict"
                )
                  ? `
                    <details style="margin-top:12px;">
                      <summary
                        style="
                          cursor:pointer;
                          font-weight:800;
                          padding:8px 0;
                        "
                      >
                        日本価格の要確認
                      </summary>

                      <div style="margin-top:8px;">
                        ${pinkoiTshirtCatalog.items
                          .filter(
                            item =>
                              item.price.priceStatus === "price_missing" ||
                              item.price.priceStatus === "price_conflict"
                          )
                          .map(
                            item => `
                              <div
                                style="
                                  padding:10px 0;
                                  border-bottom:1px solid #ecece7;
                                "
                              >
                                <div style="font-weight:700;">
                                  ${escapeHtml(
                                    [
                                      item.names.design,
                                      item.names.body,
                                      item.names.color,
                                      item.pinkoi.size
                                    ]
                                      .filter(Boolean)
                                      .join(" / ")
                                  )}
                                </div>

                                <div class="muted" style="margin-top:4px;">
                                  SKU:
                                  ${escapeHtml(item.sku || "未設定")}
                                  <br>
                                  ${escapeHtml(item.price.priceStatus)}
                                  <br>
                                  products:
                                  ${formatMoney(
                                    item.price.productPriceJpy || 0,
                                    "JPY"
                                  )}
                                  /
                                  inventory:
                                  ${formatMoney(
                                    item.price.inventoryPriceJpy || 0,
                                    "JPY"
                                  )}
                                </div>
                              </div>
                            `
                          )
                          .join("")}
                      </div>
                    </details>
                  `
                  : ""
              }

              <button
                id="syncPinkoiTshirtButton"
                class="button"
                type="button"
                style="
                  width:100%;
                  min-height:52px;
                  margin-top:14px;
                "
              >
                診断済みSKU・日本価格を更新
              </button>

              <div
                id="syncPinkoiTshirtMessage"
                class="muted"
                style="margin-top:10px;"
              ></div>

              <div
                class="muted"
                style="
                  margin-top:12px;
                  line-height:1.55;
                "
              >
                同期対象は、SKUあり、重複なし、Body / Design / Color / Size がすべて matched のSKUだけです。Designは masterDesignId を最優先します。診断表示だけではFirestoreを書き換えません。
              </div>
            `
        }

      </section>


      <section class="card">

        <div class="card-title">
          原価マスター
        </div>

        <div
          class="muted"
          style="
            margin-bottom:12px;
            line-height:1.55;
          "
        >
          原価の入力は初回と変更時だけです。SKU → TシャツBody → カテゴリ標準原価の順で優先し、適用開始日ごとに履歴を残します。新しい売上は会計時点の原価を明細へ固定保存するため、あとから原価を変更しても過去の利益は変わりません。
        </div>


        <details
          open
        >
          <summary
            style="
              cursor:pointer;
              font-weight:800;
              padding:8px 0;
            "
          >
            カテゴリ標準原価
          </summary>

          <div
            style="
              display:grid;
              gap:10px;
              margin-top:8px;
            "
          >

            <select
              id="costCategory"
              style="${selectStyle()}"
            >
              ${POS_CATEGORY_ORDER.map(
                category => `
                  <option
                    value="${category}"
                  >
                    ${escapeHtml(
                      POS_CATEGORY_LABELS[
                        category
                      ]
                    )}
                  </option>
                `
              ).join("")}
            </select>


            <div
              style="
                display:grid;
                grid-template-columns:
                  minmax(0,1fr)
                  minmax(0,1fr);
                gap:10px;
              "
            >

              <input
                id="costAmountJPY"
                type="number"
                min="0"
                step="1"
                inputmode="numeric"
                placeholder="1点あたり原価 JPY"
                style="${inputStyle()}"
              >


              <input
                id="costEffectiveFrom"
                type="date"
                value="${
                  new Date()
                    .toISOString()
                    .slice(0,10)
                }"
                style="${inputStyle()}"
              >

            </div>


            <input
              id="costNote"
              type="text"
              placeholder="メモ 任意"
              style="${inputStyle()}"
            >


            <button
              id="saveCategoryCostButton"
              class="button"
              type="button"
              style="
                width:100%;
                min-height:50px;
              "
            >
              カテゴリ原価を保存
            </button>


            <div
              id="saveCategoryCostMessage"
              class="muted"
            ></div>

          </div>


          <div
            style="
              margin-top:14px;
            "
          >
            ${POS_CATEGORY_ORDER.map(
              category => {
                const currentCost =
                  resolveCategoryUnitCost(
                    categoryCostHistories,
                    category,
                    new Date()
                      .toISOString()
                      .slice(0,10)
                  );

                return `
                  <div class="list-row">
                    <span>
                      ${escapeHtml(
                        POS_CATEGORY_LABELS[
                          category
                        ]
                      )}
                    </span>

                    <strong>
                      ${
                        currentCost === null
                          ? "未設定"
                          : formatMoney(
                              currentCost,
                              "JPY"
                            )
                      }
                    </strong>
                  </div>
                `;
              }
            ).join("")}
          </div>
        </details>


        <details
          style="
            margin-top:14px;
            padding-top:12px;
            border-top:1px solid #ecece7;
          "
        >
          <summary
            style="
              cursor:pointer;
              font-weight:800;
              padding:8px 0;
            "
          >
            Tシャツ Body原価
          </summary>

          <div
            style="
              display:grid;
              gap:10px;
              margin-top:8px;
            "
          >

            <select
              id="bodyCostBody"
              style="${selectStyle()}"
            >
              ${optionList(
                tshirtOptions.bodies
              )}
            </select>


            <div
              style="
                display:grid;
                grid-template-columns:
                  minmax(0,1fr)
                  minmax(0,1fr);
                gap:10px;
              "
            >

              <input
                id="bodyCostAmountJPY"
                type="number"
                min="0"
                step="1"
                inputmode="numeric"
                placeholder="1点あたり原価 JPY"
                style="${inputStyle()}"
              >


              <input
                id="bodyCostEffectiveFrom"
                type="date"
                value="${
                  new Date()
                    .toISOString()
                    .slice(0,10)
                }"
                style="${inputStyle()}"
              >

            </div>


            <input
              id="bodyCostNote"
              type="text"
              placeholder="メモ 任意"
              style="${inputStyle()}"
            >


            <button
              id="saveBodyCostButton"
              class="button"
              type="button"
              style="
                width:100%;
                min-height:50px;
              "
            >
              Body原価を保存
            </button>


            <div
              id="saveBodyCostMessage"
              class="muted"
            ></div>

          </div>


          <div
            style="
              margin-top:14px;
            "
          >
            ${tshirtOptions.bodies.map(
              body => {
                const currentCost =
                  resolveBodyUnitCost(
                    tshirtBodyCostHistories,
                    body.id,
                    new Date()
                      .toISOString()
                      .slice(0,10)
                  );

                return `
                  <div class="list-row">
                    <span>
                      ${escapeHtml(
                        body.name
                      )}
                    </span>

                    <strong>
                      ${
                        currentCost === null
                          ? "未設定"
                          : formatMoney(
                              currentCost,
                              "JPY"
                            )
                      }
                    </strong>
                  </div>
                `;
              }
            ).join("")}
          </div>

          <details
            style="
              margin-top:12px;
              padding-top:10px;
              border-top:1px solid #ecece7;
            "
          >
            <summary
              style="
                cursor:pointer;
                font-weight:700;
                padding:6px 0;
              "
            >
              Body原価履歴を見る
            </summary>

            <div
              style="
                margin-top:8px;
              "
            >
              ${tshirtOptions.bodies.map(
                body => {
                  const rows =
                    tshirtBodyCostHistories[
                      body.id
                    ] || [];

                  if (!rows.length) {
                    return "";
                  }

                  return `
                    <div
                      style="
                        margin-bottom:14px;
                      "
                    >
                      <div
                        style="
                          font-weight:800;
                          margin-bottom:4px;
                        "
                      >
                        ${escapeHtml(
                          body.name
                        )}
                      </div>

                      ${rows.slice(
                        0,
                        8
                      ).map(
                        row => `
                          <div class="list-row">
                            <span>
                              ${escapeHtml(
                                row.effectiveFrom
                              )}
                              ${
                                row.note
                                  ? `
                                    <span
                                      class="muted"
                                      style="
                                        display:block;
                                        font-size:11px;
                                        margin-top:2px;
                                      "
                                    >
                                      ${escapeHtml(
                                        row.note
                                      )}
                                    </span>
                                  `
                                  : ""
                              }
                            </span>

                            <strong>
                              ${formatMoney(
                                row.amountJPY,
                                "JPY"
                              )}
                            </strong>
                          </div>
                        `
                      ).join("")}
                    </div>
                  `;
                }
              ).join("")}
            </div>
          </details>
        </details>


        <details
          style="
            margin-top:14px;
            padding-top:12px;
            border-top:1px solid #ecece7;
          "
        >
          <summary
            style="
              cursor:pointer;
              font-weight:800;
              padding:8px 0;
            "
          >
            SKU個別原価
          </summary>

          <div
            style="
              display:grid;
              gap:10px;
              margin-top:8px;
            "
          >

            <select
              id="skuCostVariant"
              style="${selectStyle()}"
            >
              <option value="">
                SKUを選択
              </option>

              ${activeVariants.map(
                item => `
                  <option
                    value="${escapeHtml(
                      item.variantId ||
                      item.id
                    )}"
                  >
                    ${escapeHtml(
                      variantCostLabel(
                        item
                      )
                    )}
                  </option>
                `
              ).join("")}
            </select>


            <div
              id="skuCurrentCostDisplay"
              class="muted"
              style="
                min-height:22px;
              "
            >
              SKUを選択すると現在の個別原価を表示します。
            </div>


            <div
              style="
                display:grid;
                grid-template-columns:
                  minmax(0,1fr)
                  minmax(0,1fr);
                gap:10px;
              "
            >

              <input
                id="skuCostAmountJPY"
                type="number"
                min="0"
                step="1"
                inputmode="numeric"
                placeholder="1点あたり原価 JPY"
                style="${inputStyle()}"
              >


              <input
                id="skuCostEffectiveFrom"
                type="date"
                value="${
                  new Date()
                    .toISOString()
                    .slice(0,10)
                }"
                style="${inputStyle()}"
              >

            </div>


            <input
              id="skuCostNote"
              type="text"
              placeholder="メモ 任意"
              style="${inputStyle()}"
            >


            <button
              id="saveSkuCostButton"
              class="button"
              type="button"
              style="
                width:100%;
                min-height:50px;
              "
            >
              SKU原価を保存
            </button>


            <div
              id="saveSkuCostMessage"
              class="muted"
            ></div>

          </div>
        </details>


        <details
          style="
            margin-top:14px;
            padding-top:12px;
            border-top:1px solid #ecece7;
          "
        >
          <summary
            style="
              cursor:pointer;
              font-weight:800;
              padding:8px 0;
            "
          >
            カテゴリ原価履歴を見る
          </summary>

          <div
            style="
              margin-top:8px;
            "
          >
            ${POS_CATEGORY_ORDER.map(
              category => {
                const rows =
                  categoryCostHistories[
                    category
                  ] || [];

                if (!rows.length) {
                  return "";
                }

                return `
                  <div
                    style="
                      margin-bottom:14px;
                    "
                  >
                    <div
                      style="
                        font-weight:800;
                        margin-bottom:4px;
                      "
                    >
                      ${escapeHtml(
                        POS_CATEGORY_LABELS[
                          category
                        ]
                      )}
                    </div>

                    ${rows.slice(
                      0,
                      5
                    ).map(
                      row => `
                        <div class="list-row">
                          <span>
                            ${escapeHtml(
                              row.effectiveFrom
                            )}
                          </span>

                          <strong>
                            ${formatMoney(
                              row.amountJPY,
                              "JPY"
                            )}
                          </strong>
                        </div>
                      `
                    ).join("")}
                  </div>
                `;
              }
            ).join("")}
          </div>
        </details>

      </section>


      <section class="card">
        <div class="card-title">アクセサリー在庫連携</div>

        <div class="muted" style="margin-bottom:12px;">
          accessoryStock/shared の実在庫を確認します。
        </div>

        <div class="list-row">
          <span>Firestore デザイン数</span>
          <strong>${accessoryCatalog.summary.designCount}</strong>
        </div>

        <div class="list-row">
          <span>Firestore 在庫ありSKU</span>
          <strong>${accessoryCatalog.summary.currentStockSkuCount}</strong>
        </div>

        <div class="list-row">
          <span>Firestore 現在在庫</span>
          <strong>${accessoryCatalog.summary.totalStock}</strong>
        </div>

        <div class="list-row">
          <span>読み込み方法</span>
          <strong>Server</strong>
        </div>

        <div class="list-row">
          <span>Firestore 更新時刻</span>
          <strong style="font-size:12px;text-align:right;">
            ${escapeHtml(
              accessoryCatalog.summary.updatedAt ||
              "未記録"
            )}
          </strong>
        </div>

        ${
          accessoryCatalog.summary.topPositive?.length
            ? `
              <div
                style="
                  margin-top:14px;
                  padding-top:12px;
                  border-top:1px solid #ecece7;
                "
              >
                <div class="muted" style="margin-bottom:8px;">
                  Firestore 在庫あり商品
                </div>

                ${accessoryCatalog.summary.topPositive.map(
                  item => `
                    <div class="list-row">
                      <span>
                        ${escapeHtml(item.name)}
                        <span class="muted">
                          / ${escapeHtml(item.category)}
                        </span>
                      </span>
                      <strong>${item.quantity}</strong>
                    </div>
                  `
                ).join("")}
              </div>
            `
            : ""
        }

        ${
          accessoryCatalog.summary.localTotalStock > 0
            ? `
              <div class="list-row">
                <span>この端末の在庫</span>
                <strong>${accessoryCatalog.summary.localTotalStock}</strong>
              </div>
            `
            : ""
        }

        ${
          accessoryCatalog.summary.sourceState === "local_only"
            ? `
              <div class="warning" style="margin-top:14px;">
                この端末にはアクセサリー在庫がありますが、
                Firestore側は在庫0です。
                まだ商品登録しません。
              </div>
            `
            : ""
        }

        ${
          accessoryCatalog.summary.sourceState === "empty"
            ? `
              <div class="warning" style="margin-top:14px;">
                Firestoreから現在在庫を確認できていません。
                まだ商品登録しません。
              </div>
            `
            : ""
        }

        ${
          accessoryCatalog.summary.sourceState === "cloud_ready" &&
          accessoryUnregistered.length
            ? `
              <div class="list-row">
                <span>未登録の在庫SKU</span>
                <strong>${accessoryUnregistered.length}</strong>
              </div>

              <button
                id="syncAccessoryCatalogButton"
                class="button"
                type="button"
                style="width:100%;margin-top:14px;"
              >
                現在在庫のアクセサリーSKUを商品登録
              </button>

              <div
                id="syncAccessoryCatalogMessage"
                class="muted"
                style="margin-top:10px;"
              ></div>
            `
            : ""
        }

        ${
          accessoryCatalog.summary.sourceState === "cloud_ready" &&
          accessoryUnregistered.length === 0
            ? `
              <div class="muted" style="margin-top:12px;">
                現在在庫のアクセサリーSKUはすべて登録済みです。
              </div>
            `
            : ""
        }
      </section>

      <details
        class="card"
        style="
          display:block;
        "
      >
        <summary
          style="
            cursor:pointer;
            font-weight:800;
            padding:2px 0 10px;
          "
        >
          Tシャツ SKU手動追加
        </summary>

        <div class="muted" style="margin-bottom:14px;">
          通常はPinkoi連携を使います。Pinkoiにまだ存在しないSKUを一時的に追加する場合だけ使用します。
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
          <select id="tshirtBody" style="${selectStyle()}">
            ${optionList(tshirtOptions.bodies)}
          </select>

          <select id="tshirtDesign" style="${selectStyle()}">
            ${optionList(tshirtOptions.designs)}
          </select>

          <select id="tshirtColor" style="${selectStyle()}"></select>

          <select id="tshirtSize" style="${selectStyle()}">
            ${optionList(tshirtOptions.sizes)}
          </select>
        </div>

        <button id="registerTshirtVariantButton" class="button" type="button" style="width:100%;margin-top:14px;">
          TシャツSKUを登録
        </button>

        <div id="registerTshirtMessage" class="muted" style="margin-top:10px;"></div>
      </details>

      <section class="card">
        <div class="card-title">その他の商品を追加</div>

        <div style="display:grid;gap:10px;">
          <select id="generalCategory" style="${selectStyle()}">
            ${optionList(otherTemplates.map(item => ({
              id: item.id,
              name: item.labelJa
            })))}
          </select>

          <input id="generalName" type="text" placeholder="商品名またはDesign" style="${inputStyle()}">

          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
            <input id="generalSize" type="text" placeholder="Size 任意" style="${inputStyle()}">
            <input id="generalVariant" type="text" placeholder="Variant 任意" style="${inputStyle()}">
          </div>

          <select id="generalInventoryMode" style="${selectStyle()}">
            <option value="variant">SKUごとに在庫管理</option>
            <option value="product">商品全体で在庫管理</option>
            <option value="none">在庫管理しない</option>
          </select>

          <input id="generalPrice" type="number" min="0" inputmode="numeric" placeholder="日本価格 任意" style="${inputStyle()}">

          <button id="registerGeneralProductButton" class="button" type="button" style="width:100%;">
            商品を登録
          </button>

          <div id="registerGeneralMessage" class="muted"></div>
        </div>
      </section>

      <section class="card">
        <div class="card-title">Account</div>
        <div class="muted">${escapeHtml(currentUser?.email || "")}</div>

        <button id="logoutButton" class="button button-secondary" type="button" style="width:100%;margin-top:12px;">
          ログアウト
        </button>
      </section>
    `;

    document
      .querySelector(
        "#syncPinkoiTshirtButton"
      )
      ?.addEventListener(
        "click",
        async event => {
          const button =
            event.currentTarget;

          const messageBox =
            document.querySelector(
              "#syncPinkoiTshirtMessage"
            );

          button.disabled =
            true;

          button.textContent =
            "更新中";

          if (messageBox) {
            messageBox.textContent =
              "";
          }

          try {
            const result =
              await syncPinkoiTshirtCatalog();

            button.textContent =
              "更新済み";

            if (messageBox) {
              messageBox.textContent =
                `${result.processed} SKUを更新しました。matched ${result.mapped}、unmatched ${result.unmatched}、ambiguous ${result.ambiguous}、SKUなし ${result.missingSkuCount}、重複SKU ${result.duplicateSkuCount}、価格なし ${result.missingPriceCount}、価格不一致 ${result.priceConflictCount}。`;
            }

            setTimeout(
              () => {
                render(
                  "more"
                );
              },
              700
            );

          } catch (error) {
            button.disabled =
              false;

            button.textContent =
              "PinkoiからSKU・日本価格を更新";

            if (messageBox) {
              messageBox.textContent =
                error.code ||
                error.message ||
                String(error);
            }
          }
        }
      );


    document
      .querySelector(
        "#saveCategoryCostButton"
      )
      ?.addEventListener(
        "click",
        async event => {
          const button =
            event.currentTarget;

          const messageBox =
            document.querySelector(
              "#saveCategoryCostMessage"
            );

          button.disabled =
            true;

          button.textContent =
            "保存中";

          if (messageBox) {
            messageBox.textContent =
              "";
          }

          try {
            await saveCategoryCost({
              category:
                document
                  .querySelector(
                    "#costCategory"
                  )
                  ?.value,

              amountJPY:
                document
                  .querySelector(
                    "#costAmountJPY"
                  )
                  ?.value,

              effectiveFrom:
                document
                  .querySelector(
                    "#costEffectiveFrom"
                  )
                  ?.value,

              note:
                document
                  .querySelector(
                    "#costNote"
                  )
                  ?.value
            });

            button.textContent =
              "保存済み";

            setTimeout(
              () => {
                render(
                  "more"
                );
              },
              400
            );

          } catch (error) {
            button.disabled =
              false;

            button.textContent =
              "原価を保存";

            if (messageBox) {
              messageBox.textContent =
                error.code ||
                error.message ||
                String(error);
            }
          }
        }
      );


    document
      .querySelector(
        "#saveBodyCostButton"
      )
      ?.addEventListener(
        "click",
        async event => {
          const button =
            event.currentTarget;

          const messageBox =
            document.querySelector(
              "#saveBodyCostMessage"
            );

          button.disabled =
            true;

          button.textContent =
            "保存中";

          if (messageBox) {
            messageBox.textContent =
              "";
          }

          try {
            await saveTshirtBodyCost({
              bodyId:
                document
                  .querySelector(
                    "#bodyCostBody"
                  )
                  ?.value,

              amountJPY:
                document
                  .querySelector(
                    "#bodyCostAmountJPY"
                  )
                  ?.value,

              effectiveFrom:
                document
                  .querySelector(
                    "#bodyCostEffectiveFrom"
                  )
                  ?.value,

              note:
                document
                  .querySelector(
                    "#bodyCostNote"
                  )
                  ?.value
            });

            button.textContent =
              "保存済み";

            setTimeout(
              () => {
                render(
                  "more"
                );
              },
              400
            );

          } catch (error) {
            button.disabled =
              false;

            button.textContent =
              "Body原価を保存";

            if (messageBox) {
              messageBox.textContent =
                error.code ||
                error.message ||
                String(error);
            }
          }
        }
      );


    const skuCostVariant =
      document.querySelector(
        "#skuCostVariant"
      );

    const skuCurrentCostDisplay =
      document.querySelector(
        "#skuCurrentCostDisplay"
      );


    function refreshSkuCostDisplay() {
      const variantId =
        skuCostVariant
          ?.value ||
        "";

      const variant =
        activeVariants.find(
          item =>
            (
              item.variantId ||
              item.id
            ) ===
            variantId
        );

      if (
        !skuCurrentCostDisplay
      ) {
        return;
      }

      if (!variant) {
        skuCurrentCostDisplay.textContent =
          "SKUを選択すると現在の個別原価を表示します.";

        return;
      }

      const latestCost =
        variant.latestCostJPY;

      skuCurrentCostDisplay.textContent =
        latestCost ===
          undefined ||
        latestCost ===
          null
          ? "個別原価は未設定です."
          : (
              `現在の個別原価: ${formatMoney(
                Number(
                  latestCost || 0
                ),
                "JPY"
              )} / 適用開始 ${variant.latestCostEffectiveFrom || ""}`
            );
    }


    refreshSkuCostDisplay();


    skuCostVariant
      ?.addEventListener(
        "change",
        refreshSkuCostDisplay
      );


    document
      .querySelector(
        "#saveSkuCostButton"
      )
      ?.addEventListener(
        "click",
        async event => {
          const button =
            event.currentTarget;

          const messageBox =
            document.querySelector(
              "#saveSkuCostMessage"
            );

          button.disabled =
            true;

          button.textContent =
            "保存中";

          if (messageBox) {
            messageBox.textContent =
              "";
          }

          try {
            await saveVariantCost({
              variantId:
                skuCostVariant
                  ?.value,

              amountJPY:
                document
                  .querySelector(
                    "#skuCostAmountJPY"
                  )
                  ?.value,

              effectiveFrom:
                document
                  .querySelector(
                    "#skuCostEffectiveFrom"
                  )
                  ?.value,

              note:
                document
                  .querySelector(
                    "#skuCostNote"
                  )
                  ?.value
            });

            button.textContent =
              "保存済み";

            setTimeout(
              () => {
                render(
                  "more"
                );
              },
              400
            );

          } catch (error) {
            button.disabled =
              false;

            button.textContent =
              "SKU原価を保存";

            if (messageBox) {
              messageBox.textContent =
                error.code ||
                error.message ||
                String(error);
            }
          }
        }
      );


    document
      .querySelector("#syncAccessoryCatalogButton")
      ?.addEventListener("click", async event => {
        const button = event.currentTarget;
        const message = document.querySelector(
          "#syncAccessoryCatalogMessage"
        );

        button.disabled = true;
        button.textContent = "登録中";

        if (message) {
          message.textContent = "";
        }

        try {
          const result = await syncAccessoryCatalogRows(
            accessoryUnregistered
          );

          if (message) {
            message.textContent =
              `${result.processed} SKUを登録しました。`;
          }

          button.textContent = "登録済み";

          setTimeout(
            () => render("more"),
            700
          );

        } catch (error) {
          button.disabled = false;
          button.textContent =
            "現在在庫のアクセサリーSKUを商品登録";

          if (message) {
            message.textContent =
              error.code ||
              error.message ||
              String(error);
          }
        }
      });

    const bodySelect = document.querySelector("#tshirtBody");
    const colorSelect = document.querySelector("#tshirtColor");

    function refreshColorOptions() {
      const bodyId = bodySelect?.value || "";

      const filtered = tshirtOptions.colors.filter(
        item => !item.bodyId || item.bodyId === bodyId
      );

      if (colorSelect) {
        colorSelect.innerHTML = optionList(filtered);
      }
    }

    refreshColorOptions();
    bodySelect?.addEventListener("change", refreshColorOptions);

    colorSelect?.addEventListener("change", () => {
      const selected = tshirtOptions.colors.find(
        item => item.id === colorSelect.value
      );

      if (selected?.bodyId && bodySelect) {
        bodySelect.value = selected.bodyId;
        refreshColorOptions();
        colorSelect.value = selected.id;
      }
    });

    document.querySelector("#registerTshirtVariantButton")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      const message = document.querySelector("#registerTshirtMessage");

      button.disabled = true;
      button.textContent = "登録中";
      if (message) message.textContent = "";

      try {
        const row = await tshirtAdapter.buildVariantDraft({
          bodyId: document.querySelector("#tshirtBody")?.value,
          designId: document.querySelector("#tshirtDesign")?.value,
          colorId: document.querySelector("#tshirtColor")?.value,
          sizeId: document.querySelector("#tshirtSize")?.value
        });

        await registerTshirtVariant(row);

        if (message) {
          message.textContent = `${row.design} / ${row.body} / ${row.color} / ${row.size} を登録しました。`;
        }

        button.textContent = "登録済み";

        setTimeout(() => render("more"), 700);

      } catch (error) {
        button.disabled = false;
        button.textContent = "TシャツSKUを登録";

        if (message) {
          message.textContent = error.code || error.message || String(error);
        }
      }
    });

    const categorySelect = document.querySelector("#generalCategory");
    const modeSelect = document.querySelector("#generalInventoryMode");

    function applyCategoryDefaults() {
      const template = getCategoryTemplate(categorySelect?.value);

      if (template && modeSelect) {
        modeSelect.value = template.inventoryMode || "variant";
      }
    }

    applyCategoryDefaults();
    categorySelect?.addEventListener("change", applyCategoryDefaults);

    document.querySelector("#registerGeneralProductButton")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      const message = document.querySelector("#registerGeneralMessage");
      const template = getCategoryTemplate(categorySelect?.value);

      button.disabled = true;
      button.textContent = "登録中";
      if (message) message.textContent = "";

      try {
        const result = await registerGeneralProduct({
          category: template?.id,
          categoryLabel: template?.labelJa,
          posLabel: template?.posLabel,
          name: document.querySelector("#generalName")?.value,
          size: document.querySelector("#generalSize")?.value,
          variant: document.querySelector("#generalVariant")?.value,
          inventoryMode: modeSelect?.value || template?.inventoryMode || "variant",
          inventorySource: template?.inventorySource || "sales_app",
          defaultTrackingMode: template?.defaultTrackingMode || "quick",
          defaultPriceJPY: document.querySelector("#generalPrice")?.value
        });

        if (message) {
          message.textContent = `登録しました: ${result.variantId}`;
        }

        button.textContent = "登録済み";

        setTimeout(() => render("more"), 700);

      } catch (error) {
        button.disabled = false;
        button.textContent = "商品を登録";

        if (message) {
          message.textContent = error.code || error.message || String(error);
        }
      }
    });

    document.querySelector("#logoutButton")?.addEventListener("click", logout);
    syncStatus.textContent = "Firebase";

  } catch (error) {
    console.error(error);

    view.innerHTML = `
      <h1 class="page-title">More</h1>
      <div class="warning">${escapeHtml(error.code || error.message || error)}</div>
    `;
  }
}

function dateText(
  startDate,
  endDate
) {
  if (!startDate) {
    return "";
  }

  if (
    !endDate ||
    startDate === endDate
  ) {
    return startDate.replaceAll(
      "-",
      "/"
    );
  }

  return (
    startDate.replaceAll(
      "-",
      "/"
    ) +
    " 〜 " +
    endDate.replaceAll(
      "-",
      "/"
    )
  );
}

function sessionDayCount(
  startDate,
  endDate
) {
  if (!startDate) {
    return 1;
  }

  const start =
    new Date(
      `${startDate}T00:00:00`
    );

  const end =
    new Date(
      `${endDate || startDate}T00:00:00`
    );

  const diff =
    Math.floor(
      (
        end.getTime() -
        start.getTime()
      ) /
      86400000
    ) + 1;

  return Math.max(
    1,
    diff
  );
}

function transactionTimeText(
  value
) {
  if (!value) {
    return "";
  }

  try {
    const date =
      typeof value.toDate ===
      "function"
        ? value.toDate()
        : (
            value.seconds
              ? new Date(
                  Number(
                    value.seconds
                  ) * 1000
                )
              : null
          );

    if (!date) {
      return "";
    }

    return new Intl.DateTimeFormat(
      "ja-JP",
      {
        month:
          "2-digit",
        day:
          "2-digit",
        hour:
          "2-digit",
        minute:
          "2-digit"
      }
    ).format(date);

  } catch (error) {
    return "";
  }
}

function categorySalesSummary(
  transactions
) {
  const map =
    new Map();

  transactions.forEach(
    transaction => {
      (
        transaction.items ||
        []
      ).forEach(
        item => {
          const category =
            item.category ||
            "other";

          const label =
            item.label ||
            POS_CATEGORY_LABELS[
              category
            ] ||
            category;

          const quantity =
            Number(
              item.quantity || 0
            );

          const sales =
            Number(
              item.netLineTotal ??
              item.grossLineTotal ??
              (
                Number(
                  item.unitPrice || 0
                ) *
                quantity
              )
            );

          const current =
            map.get(
              category
            ) || {
              category,
              label,
              quantity:
                0,
              sales:
                0
            };

          current.quantity +=
            quantity;

          current.sales +=
            sales;

          map.set(
            category,
            current
          );
        }
      );
    }
  );

  return Array
    .from(
      map.values()
    )
    .sort(
      (a, b) =>
        b.sales -
        a.sales
    );
}

const EVENT_EXPENSE_LABELS = {
  boothFee:
    "出店料",
  flight:
    "航空券",
  hotel:
    "宿泊費",
  shipping:
    "送料",
  transport:
    "交通費",
  interpreter:
    "通訳費",
  other:
    "その他"
};

const EVENT_EXPENSE_ORDER = [
  "boothFee",
  "flight",
  "hotel",
  "shipping",
  "transport",
  "interpreter",
  "other"
];

function sessionExpenseTotalJPY(
  session
) {
  return Number(
    session
      ?.expenseSummary
      ?.totalJPY || 0
  );
}

function sessionNetSalesJPY(
  session
) {
  if (
    session?.currency ===
    "JPY"
  ) {
    return Number(
      session
        ?.salesSummary
        ?.netSales || 0
    );
  }

  const stored =
    Number(
      session
        ?.salesSummary
        ?.netSalesJPY || 0
    );

  if (stored > 0) {
    return stored;
  }

  const rate =
    Number(
      session?.fxRateToJPY || 0
    );

  if (rate > 0) {
    return (
      Number(
        session
          ?.salesSummary
          ?.netSales || 0
      ) *
      rate
    );
  }

  return 0;
}



const EVENT_COUNT_TRACKED_CATEGORIES =
  new Set([
    "tshirt",
    "pierce",
    "earring",
    "drop_pierce",
    "drop_earring"
  ]);

function countTimestampText(
  value
) {
  if (!value) {
    return "";
  }

  try {
    const date =
      typeof value.toDate ===
      "function"
        ? value.toDate()
        : (
            value.seconds
              ? new Date(
                  Number(
                    value.seconds
                  ) *
                  1000
                )
              : new Date(value)
          );

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return "";
    }

    return new Intl.DateTimeFormat(
      "ja-JP",
      {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }
    ).format(date);

  } catch (error) {
    return "";
  }
}

function buildEventInventorySnapshotRows({
  tshirtSnapshot,
  accessorySnapshot,
  variants
}) {
  const variantMap =
    new Map(
      (
        Array.isArray(variants)
          ? variants
          : []
      ).map(
        item => [
          item.variantId ||
          item.id,
          item
        ]
      )
    );

  const rows = [];

  (
    tshirtSnapshot
      ?.rows ||
    []
  ).forEach(
    row => {
      const variant =
        variantMap.get(
          row.variantId
        ) || {};

      const displayDesign =
        variant.design ||
        row.design ||
        "Tシャツ";

      const body =
        variant.body ||
        row.body ||
        "";

      const color =
        variant.color ||
        row.color ||
        "";

      const size =
        variant.size ||
        row.size ||
        "";

      rows.push({
        variantId:
          row.variantId,

        category:
          "tshirt",

        inventorySource:
          "tshirt",

        inventoryKey:
          variant.inventoryKey ||
          row.stockTargetId ||
          "",

        sku:
          variant.pinkoiSku ||
          variant.sku ||
          "",

        label:
          displayDesign,

        body,

        color,

        size,

        detail:
          [
            body,
            color,
            size
          ]
            .filter(Boolean)
            .join(" / "),

        openingQty:
          Math.max(
            0,
            Math.floor(
              Number(
                row.quantity ||
                0
              )
            )
          )
      });
    }
  );

  (
    accessorySnapshot
      ?.rows ||
    []
  ).forEach(
    row => {
      const variant =
        variantMap.get(
          row.variantId
        ) || {};

      rows.push({
        variantId:
          row.variantId,

        category:
          row.category,

        inventorySource:
          "accessory",

        inventoryKey:
          variant.inventoryKey ||
          row.inventoryKey ||
          "",

        sku:
          variant.sku ||
          "",

        label:
          variant.design ||
          variant.displayName ||
          row.displayName ||
          row.design ||
          "アクセサリー",

        body: "",
        color: "",
        size: "",

        detail:
          POS_CATEGORY_LABELS[
            row.category
          ] ||
          row.categoryLabel ||
          row.category ||
          "",

        openingQty:
          Math.max(
            0,
            Math.floor(
              Number(
                row.quantity ||
                0
              )
            )
          )
      });
    }
  );

  return rows
    .filter(
      row =>
        row.variantId &&
        row.openingQty > 0
    )
    .sort(
      (a, b) => {
        const categoryCompare =
          (
            POS_CATEGORY_LABELS[
              a.category
            ] ||
            a.category
          ).localeCompare(
            POS_CATEGORY_LABELS[
              b.category
            ] ||
            b.category,
            "ja"
          );

        if (
          categoryCompare
        ) {
          return categoryCompare;
        }

        return (
          `${a.label} ${a.detail}`
        ).localeCompare(
          `${b.label} ${b.detail}`,
          "ja"
        );
      }
    );
}

const EVENT_TSHIRT_SIZE_ORDER = [
  "S",
  "M",
  "L",
  "XL",
  "XXL"
];

function eventTshirtSizeRank(
  value
) {
  const textValue =
    String(
      value || ""
    ).trim();

  const index =
    EVENT_TSHIRT_SIZE_ORDER
      .indexOf(
        textValue
      );

  return index >= 0
    ? index
    : 999;
}

function groupEventTshirtCarryRows(
  rows
) {
  const groups =
    new Map();

  (
    Array.isArray(rows)
      ? rows
      : []
  )
    .filter(
      row =>
        row.category ===
        "tshirt"
    )
    .forEach(
      row => {
        const key =
          [
            row.label || "",
            row.body || "",
            row.color || ""
          ].join("||");

        if (
          !groups.has(
            key
          )
        ) {
          groups.set(
            key,
            {
              key,
              design:
                row.label ||
                "Tシャツ",
              body:
                row.body ||
                "",
              color:
                row.color ||
                "",
              items: []
            }
          );
        }

        groups
          .get(
            key
          )
          .items
          .push(
            row
          );
      }
    );

  return Array.from(
    groups.values()
  )
    .map(
      group => ({
        ...group,

        items:
          group.items
            .slice()
            .sort(
              (a, b) =>
                eventTshirtSizeRank(
                  a.size
                ) -
                eventTshirtSizeRank(
                  b.size
                ) ||
                String(
                  a.size || ""
                ).localeCompare(
                  String(
                    b.size || ""
                  ),
                  "ja"
                )
            )
      })
    )
    .sort(
      (a, b) =>
        a.design.localeCompare(
          b.design,
          "ja"
        ) ||
        a.body.localeCompare(
          b.body,
          "ja"
        ) ||
        a.color.localeCompare(
          b.color,
          "ja"
        )
    );
}

function eventCarryCategoryGroup(
  category
) {
  if (
    category ===
    "tshirt"
  ) {
    return "tshirt";
  }

  if (
    category ===
      "pierce" ||
    category ===
      "earring"
  ) {
    return category;
  }

  if (
    category ===
      "drop_pierce" ||
    category ===
      "drop_earring"
  ) {
    return "drop";
  }

  return category;
}


function currentInventoryMap(
  rows
) {
  return new Map(
    (
      Array.isArray(rows)
        ? rows
        : []
    ).map(
      row => [
        row.variantId,
        Math.max(
          0,
          Math.floor(
            Number(
              row.openingQty ??
              row.quantity ??
              0
            )
          )
        )
      ]
    )
  );
}

function sessionInventorySalesBreakdown(
  transactions,
  openingIds
) {
  const exactByVariant =
    new Map();

  const quickByCategory =
    new Map();

  let exactTotal = 0;
  let quickTotal = 0;
  let otherUnallocated = 0;

  (
    Array.isArray(transactions)
      ? transactions
      : []
  )
    .filter(
      transaction =>
        transaction.status !==
        "voided"
    )
    .forEach(
      transaction => {
        (
          transaction.items ||
          []
        ).forEach(
          item => {
            const quantity =
              Math.max(
                0,
                Math.floor(
                  Number(
                    item?.quantity ||
                    0
                  )
                )
              );

            if (
              quantity <= 0
            ) {
              return;
            }

            const variantId =
              String(
                item?.variantId ||
                ""
              ).trim();

            const category =
              String(
                item?.category ||
                ""
              ).trim();

            if (
              variantId &&
              openingIds.has(
                variantId
              )
            ) {
              exactByVariant.set(
                variantId,
                (
                  exactByVariant.get(
                    variantId
                  ) ||
                  0
                ) +
                quantity
              );

              exactTotal +=
                quantity;

              return;
            }

            if (
              !variantId &&
              EVENT_COUNT_TRACKED_CATEGORIES
                .has(
                  category
                )
            ) {
              quickByCategory.set(
                category,
                (
                  quickByCategory.get(
                    category
                  ) ||
                  0
                ) +
                quantity
              );

              quickTotal +=
                quantity;

              return;
            }

            if (
              variantId &&
              EVENT_COUNT_TRACKED_CATEGORIES
                .has(
                  category
                )
            ) {
              otherUnallocated +=
                quantity;
            }
          }
        );
      }
    );

  return {
    exactByVariant,
    quickByCategory,
    exactTotal,
    quickTotal,
    otherUnallocated
  };
}

function closingCountMap(
  countData
) {
  return new Map(
    (
      countData
        ?.closing
        ?.items ||
      []
    ).map(
      item => [
        item.variantId,
        item
      ]
    )
  );
}

function eventInventoryCountSummary({
  openingItems,
  closingMap,
  sales
}) {
  let openingTotal = 0;
  let exactSalesTotal = 0;
  let recordedReductionTotal = 0;
  let stockAdjustmentTotal = 0;
  let actualTotal = 0;
  let countedCount = 0;

  (
    openingItems ||
    []
  ).forEach(
    opening => {
      const openingQty =
        Math.max(
          0,
          Number(
            opening.openingQty ||
            0
          )
        );

      openingTotal +=
        openingQty;

      exactSalesTotal +=
        sales.exactByVariant.get(
          opening.variantId
        ) ||
        0;

      const closing =
        closingMap.get(
          opening.variantId
        ) || {};

      recordedReductionTotal +=
        Math.max(
          0,
          Number(
            closing.loss ||
            0
          )
        ) +
        Math.max(
          0,
          Number(
            closing.theft ||
            0
          )
        ) +
        Math.max(
          0,
          Number(
            closing.damage ||
            0
          )
        ) +
        Math.max(
          0,
          Number(
            closing.gift ||
            0
          )
        ) +
        Math.max(
          0,
          Number(
            closing.sample ||
            0
          )
        );

      stockAdjustmentTotal +=
        Number(
          closing.stockAdjustment ||
          0
        );

      if (
        closing.closingQty !==
          null &&
        closing.closingQty !==
          undefined &&
        closing.closingQty !==
          ""
      ) {
        actualTotal +=
          Math.max(
            0,
            Number(
              closing.closingQty ||
              0
            )
          );

        countedCount +=
          1;
      }
    }
  );

  const expectedTotal =
    openingTotal -
    exactSalesTotal -
    sales.quickTotal -
    recordedReductionTotal +
    stockAdjustmentTotal;

  const complete =
    openingItems.length > 0 &&
    countedCount ===
      openingItems.length;

  const unclassifiedDifference =
    complete
      ? expectedTotal -
        actualTotal
      : null;

  return {
    openingTotal,
    exactSalesTotal,
    quickSalesTotal:
      sales.quickTotal,
    recordedReductionTotal,
    stockAdjustmentTotal,
    expectedTotal,
    actualTotal,
    countedCount,
    totalSkuCount:
      openingItems.length,
    incompleteCount:
      Math.max(
        0,
        openingItems.length -
        countedCount
      ),
    complete,
    unclassifiedDifference
  };
}

function eventOpeningDisplayParts(
  item
) {
  const detailParts =
    String(
      item?.detail ||
      ""
    )
      .split("/")
      .map(
        part =>
          part.trim()
      )
      .filter(Boolean);

  if (
    item?.category ===
    "tshirt"
  ) {
    return {
      design:
        item?.label ||
        "Tシャツ",

      body:
        detailParts[0] ||
        "",

      color:
        detailParts[1] ||
        "",

      size:
        detailParts[2] ||
        ""
    };
  }

  return {
    design:
      item?.label ||
      "商品",

    body:
      "",

    color:
      item?.detail ||
      "",

    size:
      ""
  };
}

function eventExpectedRemainingRows({
  openingItems,
  sales,
  closingMap
}) {
  return (
    Array.isArray(
      openingItems
    )
      ? openingItems
      : []
  )
    .map(
      opening => {
        const openingQty =
          Math.max(
            0,
            Math.floor(
              Number(
                opening
                  ?.openingQty ||
                0
              )
            )
          );

        const soldQty =
          Math.max(
            0,
            Math.floor(
              Number(
                sales
                  ?.exactByVariant
                  ?.get(
                    opening
                      ?.variantId
                  ) ||
                0
              )
            )
          );

        const closing =
          closingMap
            ?.get(
              opening
                ?.variantId
            ) ||
          {};

        const recordedReduction =
          Math.max(
            0,
            Number(
              closing.loss ||
              0
            )
          ) +
          Math.max(
            0,
            Number(
              closing.theft ||
              0
            )
          ) +
          Math.max(
            0,
            Number(
              closing.damage ||
              0
            )
          ) +
          Math.max(
            0,
            Number(
              closing.gift ||
              0
            )
          ) +
          Math.max(
            0,
            Number(
              closing.sample ||
              0
            )
          );

        const stockAdjustment =
          Number(
            closing
              .stockAdjustment ||
            0
          );

        const remainingQty =
          Math.max(
            0,
            openingQty -
            soldQty -
            recordedReduction +
            stockAdjustment
          );

        const parts =
          eventOpeningDisplayParts(
            opening
          );

        return {
          variantId:
            opening
              ?.variantId ||
            "",

          category:
            opening
              ?.category ||
            "",

          sku:
            opening
              ?.sku ||
            "",

          label:
            opening
              ?.label ||
            "",

          detail:
            opening
              ?.detail ||
            "",

          design:
            parts.design,

          body:
            parts.body,

          color:
            parts.color,

          size:
            parts.size,

          openingQty,
          soldQty,
          recordedReduction,
          stockAdjustment,
          remainingQty
        };
      }
    );
}

function groupEventRemainingTshirts(
  rows
) {
  const groups =
    new Map();

  (
    Array.isArray(rows)
      ? rows
      : []
  )
    .filter(
      row =>
        row.category ===
        "tshirt"
    )
    .forEach(
      row => {
        const key =
          [
            row.design ||
              "",
            row.body ||
              "",
            row.color ||
              ""
          ].join(
            "||"
          );

        if (
          !groups.has(
            key
          )
        ) {
          groups.set(
            key,
            {
              design:
                row.design ||
                "Tシャツ",
              body:
                row.body ||
                "",
              color:
                row.color ||
                "",
              items: []
            }
          );
        }

        groups
          .get(
            key
          )
          .items
          .push(
            row
          );
      }
    );

  return Array.from(
    groups.values()
  )
    .sort(
      (a, b) =>
        a.design.localeCompare(
          b.design,
          "ja"
        ) ||
        a.body.localeCompare(
          b.body,
          "ja"
        ) ||
        a.color.localeCompare(
          b.color,
          "ja"
        )
    );
}

function eventPerSkuDifferenceCount({
  openingItems,
  closingMap,
  sales
}) {
  return (
    Array.isArray(
      openingItems
    )
      ? openingItems
      : []
  ).reduce(
    (
      count,
      opening
    ) => {
      const closing =
        closingMap.get(
          opening.variantId
        );

      if (
        !closing ||
        closing.closingQty ===
          null ||
        closing.closingQty ===
          undefined ||
        closing.closingQty ===
          ""
      ) {
        return count + 1;
      }

      const reductions =
        [
          "loss",
          "theft",
          "damage",
          "gift",
          "sample"
        ].reduce(
          (
            sum,
            key
          ) =>
            sum +
            Math.max(
              0,
              Number(
                closing?.[
                  key
                ] ||
                0
              )
            ),
          0
        );

      const expected =
        Math.max(
          0,
          Number(
            opening
              ?.openingQty ||
            0
          )
        ) -
        Math.max(
          0,
          Number(
            sales
              ?.exactByVariant
              ?.get(
                opening
                  .variantId
              ) ||
            0
          )
        ) -
        reductions +
        Number(
          closing
            ?.stockAdjustment ||
          0
        );

      const actual =
        Math.max(
          0,
          Number(
            closing
              .closingQty ||
            0
          )
        );

      return (
        expected ===
        actual
      )
        ? count
        : count + 1;
    },
    0
  );
}


function countDifferenceLabel(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "未確定";
  }

  const number =
    Number(value || 0);

  if (number === 0) {
    return "0";
  }

  if (number > 0) {
    return `不足 ${number}`;
  }

  return `超過 ${Math.abs(
    number
  )}`;
}


async function renderSessions(
  sequence
) {
  view.innerHTML = `
    <h1 class="page-title">
      Sessions
    </h1>

    <p class="page-note">
      販売セッションを読み込んでいます
    </p>
  `;

  try {
    const sessions =
      await listSalesSessions();

    const selectedDetailSession =
      sessions.find(
        session =>
          session.sessionId ===
          sessionDetailId
      ) || null;

    const sessionTransactions =
      selectedDetailSession
        ? await listSessionTransactions(
            selectedDetailSession.sessionId
          )
        : [];

    const activeSessionTransactions =
      sessionTransactions.filter(
        transaction =>
          transaction.status !==
          "voided"
      );

    const selectedInventoryCountSession =
      sessions.find(
        session =>
          session.sessionId ===
          sessionInventoryCountId
      ) || null;

    let inventoryCountData = null;
    let eventCurrentInventoryRows = [];
    let eventInventoryTransactions = [];

    if (
      selectedInventoryCountSession
    ) {
      const [
        countData,
        tshirtSnapshot,
        accessorySnapshot,
        inventoryVariants,
        countTransactions
      ] =
        await Promise.all([
          loadEventInventoryCount(
            selectedInventoryCountSession
              .sessionId
          ),

          tshirtAdapter
            .getInventorySnapshot(),

          accessoryAdapter
            .getCatalogSnapshot(),

          listAllProductVariants(),

          selectedDetailSession &&
          selectedDetailSession
            .sessionId ===
            selectedInventoryCountSession
              .sessionId
            ? Promise.resolve(
                sessionTransactions
              )
            : listSessionTransactions(
                selectedInventoryCountSession
                  .sessionId
              )
        ]);

      inventoryCountData =
        countData;

      eventCurrentInventoryRows =
        buildEventInventorySnapshotRows({
          tshirtSnapshot,
          accessorySnapshot,
          variants:
            inventoryVariants
        });

      eventInventoryTransactions =
        countTransactions;
    }

    const categoryCostHistories =
      selectedDetailSession
        ? await loadAllCategoryCostHistories()
        : {};

    const detailVariantIds =
      selectedDetailSession
        ? Array.from(
            new Set(
              activeSessionTransactions
                .flatMap(
                  transaction =>
                    transaction.items ||
                    []
                )
                .map(
                  item =>
                    String(
                      item?.variantId ||
                      ""
                    ).trim()
                )
                .filter(Boolean)
            )
          )
        : [];

    const [
      tshirtBodyCostHistories,
      detailVariantCostHistories,
      detailVariants
    ] =
      selectedDetailSession
        ? await Promise.all([
            loadTshirtBodyCostHistories(),
            loadVariantCostHistories(
              detailVariantIds
            ),
            detailVariantIds.length
              ? listAllProductVariants()
              : []
          ])
        : [
            {},
            {},
            []
          ];

    const detailVariantsById =
      new Map(
        detailVariants.map(
          item => [
            item.variantId ||
            item.id,
            item
          ]
        )
      );

    if (
      sequence !==
      renderSequence
    ) {
      return;
    }

    const openSessions =
      sessions.filter(
        session =>
          session.status ===
          "open"
      );

    const archivedSessions =
      sessions.filter(
        session =>
          session.status ===
          "archived"
      );

    const closedSessions =
      sessions.filter(
        session =>
          session.status ===
          "closed"
      );

    view.innerHTML = `
      <h1 class="page-title">
        Sessions
      </h1>

      <p class="page-note">
        Event
      </p>


      <section class="card">

        <div class="card-title">
          新しいイベント
        </div>


        <div
          style="
            display:grid;
            gap:10px;
          "
        >

          <input
            id="sessionEventName"
            type="text"
            placeholder="イベント名"
            style="${inputStyle()}"
          >


          <div
            style="
              display:grid;
              grid-template-columns:
                repeat(
                  2,
                  minmax(0,1fr)
                );
              gap:10px;
            "
          >

            <input
              id="sessionCountry"
              type="text"
              placeholder="国"
              style="${inputStyle()}"
            >

            <input
              id="sessionCity"
              type="text"
              placeholder="都市"
              style="${inputStyle()}"
            >

          </div>


          <div
            style="
              display:grid;
              grid-template-columns:
                repeat(
                  2,
                  minmax(0,1fr)
                );
              gap:10px;
            "
          >

            <label>
              <div
                class="muted"
                style="
                  margin-bottom:5px;
                "
              >
                開始日
              </div>

              <input
                id="sessionStartDate"
                type="date"
                style="${inputStyle()}"
              >
            </label>


            <label>
              <div
                class="muted"
                style="
                  margin-bottom:5px;
                "
              >
                終了日
              </div>

              <input
                id="sessionEndDate"
                type="date"
                style="${inputStyle()}"
              >
            </label>

          </div>


          <div
            style="
              display:grid;
              grid-template-columns:
                120px
                minmax(0,1fr);
              gap:10px;
            "
          >

            <select
              id="sessionCurrency"
              style="${selectStyle()}"
            >
              ${SESSION_CURRENCIES.map(
                currency => `
                  <option
                    value="${currency}"
                  >
                    ${currency}
                  </option>
                `
              ).join("")}
            </select>


            <input
              id="sessionFxRate"
              type="number"
              min="0"
              step="0.0001"
              inputmode="decimal"
              placeholder="1通貨あたりの円換算レート"
              style="${inputStyle()}"
            >

          </div>


          <div
            class="muted"
            style="
              line-height:1.55;
            "
          >
            為替レートは後から収支計算時に設定しても大丈夫です。
          </div>


          <button
            id="createEventSessionButton"
            class="button"
            type="button"
            style="
              width:100%;
              min-height:52px;
            "
          >
            イベントを作成
          </button>


          <div
            id="createEventSessionMessage"
            class="muted"
          ></div>

        </div>

      </section>


      ${
        editingSessionId
          ? (() => {
              const editing =
                openSessions.find(
                  session =>
                    session.sessionId ===
                    editingSessionId
                );

              if (!editing) {
                return "";
              }

              return `
                <section
                  class="card"
                  id="sessionEditCard"
                >

                  <div
                    style="
                      display:flex;
                      justify-content:space-between;
                      gap:10px;
                      align-items:center;
                      margin-bottom:12px;
                    "
                  >
                    <div class="card-title">
                      イベントを編集
                      <span
                        class="muted"
                        style="
                          margin-left:8px;
                          font-size:12px;
                          font-weight:400;
                        "
                      >
                        ${escapeHtml(
                          editing.eventName
                        )}
                      </span>
                    </div>

                    <button
                      id="cancelSessionEditButton"
                      class="button button-secondary"
                      type="button"
                      style="
                        min-height:38px;
                        padding:0 14px;
                      "
                    >
                      キャンセル
                    </button>
                  </div>


                  <div
                    style="
                      display:grid;
                      gap:10px;
                    "
                  >

                    <input
                      id="editSessionEventName"
                      type="text"
                      value="${escapeHtml(
                        editing.eventName
                      )}"
                      placeholder="イベント名"
                      style="${inputStyle()}"
                    >


                    <div
                      style="
                        display:grid;
                        grid-template-columns:
                          repeat(
                            2,
                            minmax(0,1fr)
                          );
                        gap:10px;
                      "
                    >

                      <input
                        id="editSessionCountry"
                        type="text"
                        value="${escapeHtml(
                          editing.country
                        )}"
                        placeholder="国"
                        style="${inputStyle()}"
                      >

                      <input
                        id="editSessionCity"
                        type="text"
                        value="${escapeHtml(
                          editing.city
                        )}"
                        placeholder="都市"
                        style="${inputStyle()}"
                      >

                    </div>


                    <div
                      style="
                        display:grid;
                        grid-template-columns:
                          repeat(
                            2,
                            minmax(0,1fr)
                          );
                        gap:10px;
                      "
                    >

                      <label>
                        <div
                          class="muted"
                          style="margin-bottom:5px;"
                        >
                          開始日
                        </div>

                        <input
                          id="editSessionStartDate"
                          type="date"
                          value="${escapeHtml(
                            editing.startDate
                          )}"
                          style="${inputStyle()}"
                        >
                      </label>


                      <label>
                        <div
                          class="muted"
                          style="margin-bottom:5px;"
                        >
                          終了日
                        </div>

                        <input
                          id="editSessionEndDate"
                          type="date"
                          value="${escapeHtml(
                            editing.endDate
                          )}"
                          style="${inputStyle()}"
                        >
                      </label>

                    </div>


                    <div
                      style="
                        display:grid;
                        grid-template-columns:
                          120px
                          minmax(0,1fr);
                        gap:10px;
                      "
                    >

                      <select
                        id="editSessionCurrency"
                        style="${selectStyle()}"
                      >
                        ${SESSION_CURRENCIES.map(
                          currency => `
                            <option
                              value="${currency}"
                              ${
                                currency ===
                                editing.currency
                                  ? "selected"
                                  : ""
                              }
                            >
                              ${currency}
                            </option>
                          `
                        ).join("")}
                      </select>


                      <input
                        id="editSessionFxRate"
                        type="number"
                        min="0"
                        step="0.0001"
                        inputmode="decimal"
                        value="${
                          editing.fxRateToJPY ??
                          ""
                        }"
                        placeholder="1通貨あたりの円換算レート"
                        style="${inputStyle()}"
                      >

                    </div>


                    <button
                      id="saveSessionEditButton"
                      class="button"
                      type="button"
                      style="
                        width:100%;
                        min-height:52px;
                      "
                    >
                      変更を保存
                    </button>


                    <div
                      id="saveSessionEditMessage"
                      class="muted"
                    ></div>

                  </div>

                </section>
              `;
            })()
          : ""
      }


      <section class="card">

        <div
          style="
            display:flex;
            justify-content:space-between;
            gap:10px;
            align-items:center;
            margin-bottom:10px;
          "
        >
          <div class="card-title">
            Open Sessions
          </div>

          <strong>
            ${openSessions.length}
          </strong>
        </div>


        ${
          openSessions.length
            ? openSessions.map(
                session => `
                  <div
                    style="
                      padding:14px 0;
                      border-bottom:1px solid #ecece7;
                    "
                  >

                    <div
                      style="
                        display:flex;
                        justify-content:space-between;
                        gap:12px;
                        align-items:flex-start;
                      "
                    >

                      <div
                        style="
                          min-width:0;
                          flex:1;
                        "
                      >

                        <div
                          style="
                            font-weight:800;
                            font-size:16px;
                          "
                        >
                          ${escapeHtml(
                            session.eventName
                          )}
                        </div>


                        <div
                          class="muted"
                          style="
                            margin-top:5px;
                            line-height:1.5;
                          "
                        >
                          ${escapeHtml(
                            [
                              session.city,
                              session.country
                            ]
                              .filter(Boolean)
                              .join(", ")
                          )}

                          <br>

                          ${escapeHtml(
                            dateText(
                              session.startDate,
                              session.endDate
                            )
                          )}

                          <br>

                          ${escapeHtml(
                            session.currency
                          )}

                          ${
                            session.fxRateToJPY
                              ? `
                                /
                                1 ${escapeHtml(
                                  session.currency
                                )}
                                =
                                ${escapeHtml(
                                  session.fxRateToJPY
                                )}
                                JPY
                              `
                              : ""
                          }
                        </div>

                        ${
                          session
                            ?.salesSummary
                            ?.transactionCount > 0
                            ? `
                              <div
                                style="
                                  margin-top:8px;
                                  font-weight:700;
                                "
                              >
                                売上
                                ${escapeHtml(
                                  new Intl.NumberFormat(
                                    session.currency === "JPY"
                                      ? "ja-JP"
                                      : "en-US",
                                    {
                                      style:
                                        "currency",
                                      currency:
                                        session.currency,
                                      maximumFractionDigits:
                                        session.currency === "JPY"
                                          ? 0
                                          : 2
                                    }
                                  ).format(
                                    session
                                      .salesSummary
                                      .netSales
                                  )
                                )}

                                /
                                ${session
                                  .salesSummary
                                  .transactionCount}
                                会計
                              </div>
                            `
                            : ""
                        }

                      </div>


                      <div
                        style="
                          display:grid;
                          gap:7px;
                          min-width:92px;
                        "
                      >
                        <button
                          type="button"
                          class="sessionUseButton button ${
                            session.sessionId ===
                            activeSessionId
                              ? "button-secondary"
                              : ""
                          }"
                          data-session-id="${escapeHtml(
                            session.sessionId
                          )}"
                          style="
                            min-height:44px;
                            padding:0 12px;
                          "
                        >
                          ${
                            session.sessionId ===
                            activeSessionId
                              ? "使用中"
                              : "POSで使用"
                          }
                        </button>

                        <button
                          type="button"
                          class="sessionEditButton button button-secondary"
                          data-session-id="${escapeHtml(
                            session.sessionId
                          )}"
                          style="
                            min-height:40px;
                            padding:0 12px;
                          "
                        >
                          編集
                        </button>

                        <button
                          type="button"
                          class="sessionDetailButton button button-secondary"
                          data-session-id="${escapeHtml(
                            session.sessionId
                          )}"
                          style="
                            min-height:40px;
                            padding:0 12px;
                          "
                        >
                          売上詳細
                        </button>

                        <button
                          type="button"
                          class="sessionInventoryCountButton button button-secondary"
                          data-session-id="${escapeHtml(
                            session.sessionId
                          )}"
                          style="
                            min-height:40px;
                            padding:0 12px;
                          "
                        >
                          在庫確認
                        </button>

                        <button
                          type="button"
                          class="sessionLifecycleButton"
                          data-session-id="${escapeHtml(
                            session.sessionId
                          )}"
                          data-original-label="削除 / アーカイブ"
                          style="
                            min-height:40px;
                            padding:0 12px;
                            border:1px solid #deded9;
                            border-radius:10px;
                            background:#fff;
                            color:#6f3f3f;
                            font-weight:700;
                          "
                        >
                          削除 / アーカイブ
                        </button>
                      </div>

                    </div>

                  </div>
                `
              ).join("")
            : `
              <div
                class="muted"
                style="
                  padding:16px 0;
                  text-align:center;
                "
              >
                まだ販売セッションはありません。
              </div>
            `
        }

      </section>


      ${
        closedSessions.length
          ? `
            <details
              class="card"
              open
              style="
                margin-top:14px;
              "
            >
              <summary
                style="
                  cursor:pointer;
                  font-weight:800;
                  font-size:16px;
                  padding:2px 0 8px;
                "
              >
                終了済みイベント
                (${closedSessions.length})
              </summary>

              <div
                class="muted"
                style="
                  margin:6px 0 10px;
                  line-height:1.5;
                "
              >
                イベント終了後はPOS販売と在庫カウントの編集を停止します。売上・在庫履歴はそのまま確認できます。
              </div>

              ${closedSessions.map(
                session => `
                  <div
                    style="
                      padding:12px 0;
                      border-bottom:1px solid #ecece7;
                    "
                  >
                    <div
                      style="
                        display:flex;
                        justify-content:space-between;
                        gap:12px;
                        align-items:flex-start;
                      "
                    >
                      <div
                        style="
                          min-width:0;
                          flex:1;
                        "
                      >
                        <div
                          style="
                            font-weight:800;
                          "
                        >
                          ${escapeHtml(
                            session.eventName
                          )}
                        </div>

                        <div
                          class="muted"
                          style="
                            margin-top:4px;
                            line-height:1.45;
                          "
                        >
                          ${escapeHtml(
                            [
                              session.city,
                              session.country
                            ]
                              .filter(Boolean)
                              .join(", ")
                          )}

                          <br>

                          ${escapeHtml(
                            dateText(
                              session.startDate,
                              session.endDate
                            )
                          )}

                          ${
                            session
                              ?.eventCloseSummary
                              ?.closingTotal !==
                              undefined
                              ? `
                                <br>
                                終了在庫
                                ${Number(
                                  session
                                    .eventCloseSummary
                                    .closingTotal ||
                                  0
                                )} 点
                              `
                              : ""
                          }
                        </div>
                      </div>

                      <div
                        style="
                          display:grid;
                          gap:7px;
                          min-width:92px;
                        "
                      >
                        <button
                          type="button"
                          class="sessionDetailButton button button-secondary"
                          data-session-id="${escapeHtml(
                            session.sessionId
                          )}"
                          style="
                            min-height:40px;
                            padding:0 12px;
                          "
                        >
                          売上詳細
                        </button>

                        <button
                          type="button"
                          class="sessionInventoryCountButton button button-secondary"
                          data-session-id="${escapeHtml(
                            session.sessionId
                          )}"
                          style="
                            min-height:40px;
                            padding:0 12px;
                          "
                        >
                          在庫確認
                        </button>

                        <button
                          type="button"
                          class="sessionLifecycleButton"
                          data-session-id="${escapeHtml(
                            session.sessionId
                          )}"
                          data-original-label="アーカイブ"
                          style="
                            min-height:40px;
                            padding:0 12px;
                            border:1px solid #deded9;
                            border-radius:10px;
                            background:#fff;
                            color:#6f3f3f;
                            font-weight:700;
                          "
                        >
                          アーカイブ
                        </button>
                      </div>
                    </div>
                  </div>
                `
              ).join("")}
            </details>
          `
          : ""
      }


      ${
        archivedSessions.length
          ? `
            <details
              class="card"
              style="
                margin-top:14px;
              "
            >
              <summary
                style="
                  cursor:pointer;
                  font-weight:800;
                  font-size:16px;
                  padding:2px 0 8px;
                "
              >
                アーカイブ済みイベント
                (${archivedSessions.length})
              </summary>

              <div
                class="muted"
                style="
                  margin:6px 0 10px;
                  line-height:1.5;
                "
              >
                売上・在庫・経費などの記録があるイベントは削除せず、ここに保存します。
              </div>

              ${archivedSessions.map(
                session => `
                  <div
                    style="
                      padding:12px 0;
                      border-bottom:1px solid #ecece7;
                    "
                  >
                    <div
                      style="
                        display:flex;
                        justify-content:space-between;
                        gap:12px;
                        align-items:flex-start;
                      "
                    >
                      <div
                        style="
                          min-width:0;
                          flex:1;
                        "
                      >
                        <div
                          style="
                            font-weight:800;
                          "
                        >
                          ${escapeHtml(
                            session.eventName
                          )}
                        </div>

                        <div
                          class="muted"
                          style="
                            margin-top:4px;
                            line-height:1.45;
                          "
                        >
                          ${escapeHtml(
                            [
                              session.city,
                              session.country
                            ]
                              .filter(Boolean)
                              .join(", ")
                          )}

                          <br>

                          ${escapeHtml(
                            dateText(
                              session.startDate,
                              session.endDate
                            )
                          )}
                        </div>
                      </div>

                      <div
                        style="
                          display:grid;
                          gap:7px;
                          min-width:92px;
                        "
                      >
                        <button
                          type="button"
                          class="sessionDetailButton button button-secondary"
                          data-session-id="${escapeHtml(
                            session.sessionId
                          )}"
                          style="
                            min-height:40px;
                            padding:0 12px;
                          "
                        >
                          売上詳細
                        </button>

                        <button
                          type="button"
                          class="restoreArchivedSessionButton button button-secondary"
                          data-session-id="${escapeHtml(
                            session.sessionId
                          )}"
                          style="
                            min-height:40px;
                            padding:0 12px;
                          "
                        >
                          復元
                        </button>
                      </div>
                    </div>
                  </div>
                `
              ).join("")}
            </details>
          `
          : ""
      }


      ${
        selectedInventoryCountSession
          ? (() => {
              const openingItems =
                inventoryCountData
                  ?.opening
                  ?.items ||
                [];

              const currentMap =
                currentInventoryMap(
                  eventCurrentInventoryRows
                );

              const openingIds =
                new Set(
                  openingItems.map(
                    item =>
                      item.variantId
                  )
                );

              const sales =
                sessionInventorySalesBreakdown(
                  eventInventoryTransactions,
                  openingIds
                );

              const closingMap =
                closingCountMap(
                  inventoryCountData
                );

              const countSummary =
                eventInventoryCountSummary({
                  openingItems,
                  closingMap,
                  sales
                });

              const remainingRows =
                eventExpectedRemainingRows({
                  openingItems,
                  sales,
                  closingMap
                });

              const tshirtRemainingGroups =
                groupEventRemainingTshirts(
                  remainingRows
                );

              const accessoryRemainingRows =
                remainingRows.filter(
                  row =>
                    row.category !==
                    "tshirt"
                );

              const skuExpectedRemainingTotal =
                remainingRows.reduce(
                  (sum, row) =>
                    sum +
                    Number(
                      row.remainingQty ||
                      0
                    ),
                  0
                );

              const perSkuDifferenceCount =
                eventPerSkuDifferenceCount({
                  openingItems,
                  closingMap,
                  sales
                });

              const inventorySessionClosed =
                selectedInventoryCountSession
                  ?.status ===
                "closed";

              const activeInventoryTransactions =
                eventInventoryTransactions
                  .filter(
                    transaction =>
                      transaction.status !==
                      "voided"
                  );

              const openingInventoryLocked =
                activeInventoryTransactions.length >
                0;

              const openingEditMode =
                !inventorySessionClosed &&
                !openingInventoryLocked &&
                Boolean(
                  inventoryCountData
                    ?.opening
                ) &&
                sessionOpeningEditId ===
                  selectedInventoryCountSession
                    .sessionId;

              const savedOpeningQtyByVariant =
                new Map(
                  openingItems.map(
                    item => [
                      item.variantId,
                      Number(
                        item.openingQty ||
                        0
                      )
                    ]
                  )
                );

              const savedOpeningTotal =
                openingItems.reduce(
                  (sum, item) =>
                    sum +
                    Number(
                      item.openingQty ||
                      0
                    ),
                  0
                );

              const savedOpeningSkuCount =
                openingItems.length;

              const eventReadyToClose =
                !inventorySessionClosed &&
                Boolean(
                  inventoryCountData
                    ?.closing
                ) &&
                countSummary.complete &&
                countSummary.quickSalesTotal ===
                  0 &&
                sales.otherUnallocated ===
                  0 &&
                perSkuDifferenceCount ===
                  0;

              const currentTotal =
                eventCurrentInventoryRows
                  .reduce(
                    (sum, row) =>
                      sum +
                      Number(
                        row.openingQty ||
                        0
                      ),
                    0
                  );

              const currentTshirtTotal =
                eventCurrentInventoryRows
                  .filter(
                    row =>
                      row.category ===
                      "tshirt"
                  )
                  .reduce(
                    (sum, row) =>
                      sum +
                      Number(
                        row.openingQty ||
                        0
                      ),
                    0
                  );

              const currentAccessoryTotal =
                eventCurrentInventoryRows
                  .filter(
                    row =>
                      row.category !==
                      "tshirt"
                  )
                  .reduce(
                    (sum, row) =>
                      sum +
                      Number(
                        row.openingQty ||
                        0
                      ),
                    0
                  );

              return `
                <section
                  class="card"
                  id="sessionInventoryCountPanel"
                >
                  <div
                    style="
                      display:flex;
                      justify-content:space-between;
                      gap:10px;
                      align-items:flex-start;
                      margin-bottom:12px;
                    "
                  >
                    <div>
                      <div class="card-title">
                        イベント在庫確認
                      </div>

                      <div
                        style="
                          margin-top:4px;
                          font-weight:800;
                        "
                      >
                        ${escapeHtml(
                          selectedInventoryCountSession
                            .eventName
                        )}
                      </div>
                    </div>

                    <button
                      id="closeInventoryCountButton"
                      class="button button-secondary"
                      type="button"
                      style="
                        min-height:38px;
                        padding:0 14px;
                      "
                    >
                      閉じる
                    </button>
                  </div>

                  ${
                    !inventoryCountData
                      ?.opening ||
                    openingEditMode
                      ? `
                        <div
                          class="warning"
                          style="
                            margin-bottom:12px;
                          "
                        >
                          ${
                            openingEditMode
                              ? "保存済みの開始在庫を編集しています。会社全体の実在庫ではなく、このイベントへ持参する数量だけを設定してください。保存すると終了在庫カウントはクリアされます。"
                              : "イベントへ実際に持って行く数量だけを開始在庫として保存します。日本に残す在庫や他の販売先分は含めません。"
                          }
                        </div>

                        ${
                          openingEditMode
                            ? `
                              <button
                                id="cancelOpeningInventoryEditButton"
                                type="button"
                                class="button button-secondary"
                                style="
                                  width:100%;
                                  min-height:42px;
                                  margin-bottom:10px;
                                "
                              >
                                編集をキャンセル
                              </button>
                            `
                            : ""
                        }

                        <div class="list-row">
                          <span>
                            現在のTシャツ実在庫
                          </span>

                          <strong>
                            ${currentTshirtTotal}
                          </strong>
                        </div>

                        <div class="list-row">
                          <span>
                            現在のアクセサリー実在庫
                          </span>

                          <strong>
                            ${currentAccessoryTotal}
                          </strong>
                        </div>

                        <div class="list-row">
                          <span>
                            現在の実在庫合計
                          </span>

                          <strong>
                            ${currentTotal}
                          </strong>
                        </div>

                        <div class="list-row">
                          <span>
                            実在庫のあるSKU
                          </span>

                          <strong>
                            ${eventCurrentInventoryRows.length}
                          </strong>
                        </div>

                        <div
                          style="
                            display:grid;
                            grid-template-columns:
                              repeat(2,minmax(0,1fr));
                            gap:8px;
                            margin-top:12px;
                          "
                        >
                          <div
                            style="
                              padding:12px;
                              border:1px solid #ecece7;
                              border-radius:14px;
                            "
                          >
                            <div
                              id="eventCarrySelectedQty"
                              style="
                                font-size:22px;
                                font-weight:800;
                              "
                            >
                              ${
                                openingEditMode
                                  ? savedOpeningTotal
                                  : 0
                              }
                            </div>

                            <div class="muted">
                              イベント持参点数
                            </div>
                          </div>

                          <div
                            style="
                              padding:12px;
                              border:1px solid #ecece7;
                              border-radius:14px;
                            "
                          >
                            <div
                              id="eventCarrySelectedSku"
                              style="
                                font-size:22px;
                                font-weight:800;
                              "
                            >
                              ${
                                openingEditMode
                                  ? savedOpeningSkuCount
                                  : 0
                              }
                            </div>

                            <div class="muted">
                              持参SKU
                            </div>
                          </div>
                        </div>

                        ${
                          openingInventoryLocked
                            ? `
                              <div
                                class="warning"
                                style="
                                  margin-top:12px;
                                "
                              >
                                有効な売上が ${activeInventoryTransactions.length} 件あるため、開始在庫はロックされています。開始在庫を変更する場合は、先に該当売上を取消してください。
                              </div>
                            `
                            : ""
                        }

                        <div
                          style="
                            display:grid;
                            grid-template-columns:
                              repeat(2,minmax(0,1fr));
                            gap:8px;
                            margin-top:14px;
                          "
                        >
                          <button
                            id="copyAllStockToCarryButton"
                            type="button"
                            class="button button-secondary"
                            style="
                              min-height:44px;
                            "
                          >
                            全数を持参にコピー
                          </button>

                          <button
                            id="clearAllCarryButton"
                            type="button"
                            class="button button-secondary"
                            style="
                              min-height:44px;
                            "
                          >
                            すべて0
                          </button>

                          <button
                            id="copyVisibleStockToCarryButton"
                            type="button"
                            class="button button-secondary"
                            style="
                              min-height:44px;
                            "
                          >
                            表示中だけ全数コピー
                          </button>

                          <button
                            id="clearVisibleCarryButton"
                            type="button"
                            class="button button-secondary"
                            style="
                              min-height:44px;
                            "
                          >
                            表示中だけ0
                          </button>
                        </div>

                        <div
                          style="
                            display:flex;
                            gap:7px;
                            overflow-x:auto;
                            padding:2px 0 4px;
                            margin-top:12px;
                          "
                        >
                          ${[
                            ["all", "すべて"],
                            ["tshirt", "Tシャツ"],
                            ["pierce", "ピアス"],
                            ["earring", "イヤリング"],
                            ["drop", "ドロップ"]
                          ].map(
                            ([value, label]) => `
                              <button
                                type="button"
                                class="eventCarryCategoryFilter"
                                data-category-filter="${value}"
                                style="
                                  flex:0 0 auto;
                                  min-height:38px;
                                  padding:0 13px;
                                  border:1px solid #deded9;
                                  border-radius:999px;
                                  background:${
                                    value === "all"
                                      ? "#1f1f1f"
                                      : "#fff"
                                  };
                                  color:${
                                    value === "all"
                                      ? "#fff"
                                      : "#1f1f1f"
                                  };
                                  font-weight:700;
                                "
                              >
                                ${label}
                              </button>
                            `
                          ).join("")}
                        </div>

                        <input
                          id="eventCarrySearch"
                          type="search"
                          placeholder="SKU、商品名、色、サイズで検索"
                          style="
                            ${inputStyle()}
                            margin-top:10px;
                          "
                        >

                        <label
                          style="
                            display:flex;
                            align-items:center;
                            gap:8px;
                            margin-top:10px;
                            font-size:14px;
                          "
                        >
                          <input
                            id="eventCarryOnlySelected"
                            type="checkbox"
                          >
                          持参数ありだけ表示
                        </label>

                        <div
                          class="muted"
                          style="
                            margin-top:8px;
                            line-height:1.5;
                          "
                        >
                          Tシャツはデザインを縦、サイズを横に並べています。Body・Colorが違う場合は別行です。在庫0はグレー表示され入力できません。「この色を全在庫追加」は各色ごとに表示し、「デザイン全体を追加」は同じDesignにつき1つだけ表示します。
                        </div>

                        <div
                          id="eventCarryRows"
                          style="
                            margin-top:10px;
                          "
                        >
                          <div
                            class="eventCarryTshirtSection"
                            data-category-group="tshirt"
                          >
                            <div
                              style="
                                font-weight:800;
                                margin:4px 0 8px;
                              "
                            >
                              Tシャツ
                            </div>

                            <div
                              style="
                                overflow-x:auto;
                                border:1px solid #ecece7;
                                border-radius:14px;
                              "
                            >
                              <div
                                style="
                                  min-width:420px;
                                "
                              >
                                <div
                                  style="
                                    display:grid;
                                    grid-template-columns:
                                      140px
                                      repeat(5,56px);
                                    gap:0;
                                    background:#f7f7f4;
                                    border-bottom:1px solid #ecece7;
                                    font-size:12px;
                                    font-weight:800;
                                  "
                                >
                                  <div
                                    style="
                                      position:sticky;
                                      left:0;
                                      z-index:4;
                                      padding:8px;
                                      background:#f7f7f4;
                                      border-right:1px solid #e7e7e2;
                                      box-shadow:3px 0 6px rgba(0,0,0,.04);
                                    "
                                  >
                                    Design / Body / Color
                                  </div>

                                  ${EVENT_TSHIRT_SIZE_ORDER.map(
                                    size => `
                                      <div
                                        style="
                                          padding:9px 4px;
                                          text-align:center;
                                        "
                                      >
                                        ${size}
                                      </div>
                                    `
                                  ).join("")}
                                </div>

                                ${groupEventTshirtCarryRows(
                                  eventCurrentInventoryRows
                                ).map(
                                  (
                                    group,
                                    groupIndex,
                                    allGroups
                                  ) => {
                                    const isFirstDesignRow =
                                      groupIndex === 0 ||
                                      allGroups[
                                        groupIndex - 1
                                      ].design !==
                                        group.design;
                                    const groupSearch =
                                      [
                                        group.design,
                                        group.body,
                                        group.color,
                                        ...group.items.map(
                                          item =>
                                            [
                                              item.sku,
                                              item.size
                                            ]
                                              .filter(Boolean)
                                              .join(" ")
                                        )
                                      ]
                                        .filter(Boolean)
                                        .join(" ")
                                        .toLocaleLowerCase();

                                    return `
                                      <div
                                        class="eventCarryMatrixRow"
                                        data-category-group="tshirt"
                                        data-design-key="${escapeHtml(
                                          group.design
                                        )}"
                                        data-search="${escapeHtml(
                                          groupSearch
                                        )}"
                                        style="
                                          display:grid;
                                          grid-template-columns:
                                            140px
                                            repeat(5,56px);
                                          gap:0;
                                          border-bottom:1px solid #ecece7;
                                        "
                                      >
                                        <div
                                          style="
                                            position:sticky;
                                            left:0;
                                            z-index:3;
                                            padding:8px;
                                            min-width:0;
                                            background:#fff;
                                            border-right:1px solid #e7e7e2;
                                            box-shadow:3px 0 6px rgba(0,0,0,.04);
                                          "
                                        >
                                          <div
                                            style="
                                              font-weight:800;
                                              font-size:14px;
                                              line-height:1.2;
                                              overflow-wrap:anywhere;
                                            "
                                          >
                                            ${escapeHtml(
                                              group.design
                                            )}
                                          </div>

                                          <div
                                            class="muted"
                                            style="
                                              margin-top:3px;
                                              line-height:1.25;
                                              font-size:10px;
                                              overflow-wrap:anywhere;
                                            "
                                          >
                                            ${escapeHtml(
                                              [
                                                group.body,
                                                group.color
                                              ]
                                                .filter(Boolean)
                                                .join(" / ")
                                            )}
                                          </div>

                                          <div
                                            style="
                                              display:grid;
                                              grid-template-columns:
                                                minmax(0,1fr);
                                              gap:5px;
                                              margin-top:7px;
                                            "
                                          >
                                            <button
                                              type="button"
                                              class="eventCarryColorAllStockButton"
                                              style="
                                                min-height:32px;
                                                padding:0 8px;
                                                border:1px solid #deded9;
                                                border-radius:8px;
                                                background:#fff;
                                                font-size:10px;
                                                font-weight:700;
                                                line-height:1.25;
                                              "
                                            >
                                              この色を全在庫追加
                                            </button>

                                            ${
                                              isFirstDesignRow
                                                ? `
                                                  <button
                                                    type="button"
                                                    class="eventCarryDesignAllStockButton"
                                                    data-design-key="${escapeHtml(
                                                      group.design
                                                    )}"
                                                    style="
                                                      min-height:32px;
                                                      padding:0 8px;
                                                      border:1px solid #deded9;
                                                      border-radius:8px;
                                                      background:#1f1f1f;
                                                      color:#fff;
                                                      font-size:10px;
                                                      font-weight:700;
                                                      line-height:1.25;
                                                    "
                                                  >
                                                    デザイン全体を追加
                                                  </button>
                                                `
                                                : ""
                                            }
                                          </div>
                                        </div>

                                        ${EVENT_TSHIRT_SIZE_ORDER.map(
                                          size => {
                                            const item =
                                              group.items.find(
                                                candidate =>
                                                  candidate.size ===
                                                  size
                                              );

                                            if (!item) {
                                              return `
                                                <div
                                                  class="eventCarryOutOfStockCell"
                                                  style="
                                                    padding:8px 4px;
                                                    text-align:center;
                                                    color:#b7b7b2;
                                                    background:#f3f3f0;
                                                    border-left:1px solid #ecece7;
                                                  "
                                                >
                                                  —
                                                </div>
                                              `;
                                            }

                                            const outOfStock =
                                              Number(
                                                item.openingQty ||
                                                0
                                              ) <= 0;

                                            return `
                                              <div
                                                class="eventCarryRow ${
                                                  outOfStock
                                                    ? "eventCarryOutOfStockCell"
                                                    : ""
                                                }"
                                                data-search="${escapeHtml(
                                                  [
                                                    item.sku,
                                                    item.label,
                                                    item.body,
                                                    item.color,
                                                    item.size
                                                  ]
                                                    .filter(Boolean)
                                                    .join(" ")
                                                    .toLocaleLowerCase()
                                                )}"
                                                data-category-group="tshirt"
                                                data-variant-id="${escapeHtml(
                                                  item.variantId
                                                )}"
                                                data-category="${escapeHtml(
                                                  item.category
                                                )}"
                                                data-inventory-source="${escapeHtml(
                                                  item.inventorySource
                                                )}"
                                                data-inventory-key="${escapeHtml(
                                                  item.inventoryKey
                                                )}"
                                                data-sku="${escapeHtml(
                                                  item.sku
                                                )}"
                                                data-label="${escapeHtml(
                                                  item.label
                                                )}"
                                                data-detail="${escapeHtml(
                                                  item.detail
                                                )}"
                                                data-current-qty="${item.openingQty}"
                                                style="
                                                  padding:7px 4px;
                                                  border-left:1px solid #f0f0ec;
                                                  text-align:center;
                                                  ${
                                                    outOfStock
                                                      ? "background:#f3f3f0;color:#b7b7b2;"
                                                      : ""
                                                  }
                                                "
                                              >
                                                <div
                                                  class="muted"
                                                  style="
                                                    font-size:10px;
                                                    margin-bottom:3px;
                                                    ${
                                                      outOfStock
                                                        ? "color:#b7b7b2;"
                                                        : ""
                                                    }
                                                  "
                                                >
                                                  在${item.openingQty}
                                                </div>

                                                <input
                                                  class="eventCarryQtyInput"
                                                  data-variant-id="${escapeHtml(
                                                    item.variantId
                                                  )}"
                                                  type="number"
                                                  min="0"
                                                  max="${item.openingQty}"
                                                  step="1"
                                                  inputmode="numeric"
                                                  value="${
                                                    openingEditMode
                                                      ? (
                                                          savedOpeningQtyByVariant.get(
                                                            item.variantId
                                                          ) ||
                                                          ""
                                                        )
                                                      : ""
                                                  }"
                                                  placeholder="0"
                                                  ${outOfStock ? "disabled" : ""}
                                                  aria-label="${escapeHtml(
                                                    `${group.design} ${group.body} ${group.color} ${size} イベント持参数`
                                                  )}"
                                                  style="
                                                    width:46px;
                                                    min-height:38px;
                                                    padding:0 3px;
                                                    border:1px solid ${
                                                      outOfStock
                                                        ? "#e4e4df"
                                                        : "#deded9"
                                                    };
                                                    border-radius:8px;
                                                    text-align:center;
                                                    font-size:15px;
                                                    ${
                                                      outOfStock
                                                        ? "background:#ededE9;color:#aaa;opacity:.72;"
                                                        : ""
                                                    }
                                                  "
                                                >
                                              </div>
                                            `;
                                          }
                                        ).join("")}
                                      </div>
                                    `;
                                  }
                                ).join("")}
                              </div>
                            </div>
                          </div>

                          <div
                            class="eventCarryAccessorySection"
                            style="
                              margin-top:16px;
                            "
                          >
                            <div
                              style="
                                font-weight:800;
                                margin:4px 0 8px;
                              "
                            >
                              アクセサリー
                            </div>

                            ${eventCurrentInventoryRows
                              .filter(
                                row =>
                                  row.category !==
                                  "tshirt"
                              )
                              .map(
                                row => {
                                  const searchText =
                                    [
                                      row.sku,
                                      row.label,
                                      row.detail,
                                      POS_CATEGORY_LABELS[
                                        row.category
                                      ] ||
                                      row.category
                                    ]
                                      .filter(Boolean)
                                      .join(" ")
                                      .toLocaleLowerCase();

                                  return `
                                    <div
                                      class="eventCarryRow eventCarryAccessoryRow"
                                      data-search="${escapeHtml(
                                        searchText
                                      )}"
                                      data-category-group="${escapeHtml(
                                        eventCarryCategoryGroup(
                                          row.category
                                        )
                                      )}"
                                      data-variant-id="${escapeHtml(
                                        row.variantId
                                      )}"
                                      data-category="${escapeHtml(
                                        row.category
                                      )}"
                                      data-inventory-source="${escapeHtml(
                                        row.inventorySource
                                      )}"
                                      data-inventory-key="${escapeHtml(
                                        row.inventoryKey
                                      )}"
                                      data-sku="${escapeHtml(
                                        row.sku
                                      )}"
                                      data-label="${escapeHtml(
                                        row.label
                                      )}"
                                      data-detail="${escapeHtml(
                                        row.detail
                                      )}"
                                      data-current-qty="${row.openingQty}"
                                      style="
                                        padding:12px;
                                        margin:0 -4px;
                                        border-bottom:1px solid #ecece7;
                                        border-radius:10px;
                                        ${
                                          Number(
                                            row.openingQty ||
                                            0
                                          ) <= 0
                                            ? "background:#f3f3f0;color:#b7b7b2;opacity:.72;"
                                            : ""
                                        }
                                      "
                                    >
                                      <div
                                        style="
                                          display:grid;
                                          grid-template-columns:
                                            minmax(0,1fr)
                                            110px;
                                          gap:10px;
                                          align-items:center;
                                        "
                                      >
                                        <div
                                          style="
                                            min-width:0;
                                          "
                                        >
                                          <div
                                            style="
                                              font-weight:800;
                                            "
                                          >
                                            ${escapeHtml(
                                              row.label
                                            )}
                                          </div>

                                          <div
                                            class="muted"
                                            style="
                                              margin-top:3px;
                                              line-height:1.45;
                                            "
                                          >
                                            ${escapeHtml(
                                              row.detail
                                            )}

                                            ${
                                              row.sku
                                                ? `
                                                  <br>
                                                  ${escapeHtml(
                                                    row.sku
                                                  )}
                                                `
                                                : ""
                                            }

                                            <br>
                                            実在庫
                                            <strong>
                                              ${row.openingQty}
                                            </strong>
                                          </div>
                                        </div>

                                        <label>
                                          <div
                                            class="muted"
                                            style="
                                              font-size:12px;
                                              margin-bottom:4px;
                                            "
                                          >
                                            イベント持参数
                                          </div>

                                          <input
                                            class="eventCarryQtyInput"
                                            data-variant-id="${escapeHtml(
                                              row.variantId
                                            )}"
                                            type="number"
                                            min="0"
                                            max="${row.openingQty}"
                                            step="1"
                                            inputmode="numeric"
                                            value="${
                                              openingEditMode
                                                ? (
                                                    savedOpeningQtyByVariant.get(
                                                      row.variantId
                                                    ) ||
                                                    ""
                                                  )
                                                : ""
                                            }"
                                            placeholder="0"
                                            ${
                                              Number(
                                                row.openingQty ||
                                                0
                                              ) <= 0
                                                ? "disabled"
                                                : ""
                                            }
                                            style="${
                                              Number(
                                                row.openingQty ||
                                                0
                                              ) <= 0
                                                ? `${inputStyle()} background:#ededE9;color:#aaa;opacity:.72;`
                                                : inputStyle()
                                            }"
                                          >
                                        </label>
                                      </div>
                                    </div>
                                  `;
                                }
                              ).join("")}
                          </div>
                        </div>

                        <button
                          id="captureOpeningInventoryButton"
                          class="button"
                          type="button"
                          data-overwrite="${
                            openingEditMode
                              ? "true"
                              : "false"
                          }"
                          ${
                            openingInventoryLocked
                              ? "disabled"
                              : ""
                          }
                          style="
                            width:100%;
                            min-height:52px;
                            margin-top:14px;
                            ${
                              openingInventoryLocked
                                ? "opacity:.45;"
                                : ""
                            }
                          "
                        >
                          ${
                            openingEditMode
                              ? "開始在庫の変更を保存"
                              : "入力した持参数を開始在庫として保存"
                          }
                        </button>

                        <div
                          id="inventoryCountMessage"
                          class="muted"
                          style="
                            margin-top:10px;
                          "
                        ></div>
                      `
                      : `
                        <div
                          class="muted"
                          style="
                            margin-bottom:10px;
                          "
                        >
                          開始在庫
                          ${
                            countTimestampText(
                              inventoryCountData
                                ?.opening
                                ?.capturedAt
                            ) ||
                            "保存済み"
                          }
                        </div>

                        <div
                          class="grid grid-2"
                          style="
                            margin-bottom:12px;
                          "
                        >
                          <div
                            style="
                              padding:12px;
                              border:1px solid #ecece7;
                              border-radius:14px;
                            "
                          >
                            <div
                              style="
                                font-size:22px;
                                font-weight:800;
                              "
                            >
                              ${countSummary.openingTotal}
                            </div>

                            <div class="muted">
                              開始在庫
                            </div>
                          </div>

                          <div
                            style="
                              padding:12px;
                              border:1px solid #ecece7;
                              border-radius:14px;
                            "
                          >
                            <div
                              style="
                                font-size:22px;
                                font-weight:800;
                              "
                            >
                              ${countSummary.exactSalesTotal}
                            </div>

                            <div class="muted">
                              SKU販売
                            </div>
                          </div>

                          <div
                            style="
                              padding:12px;
                              border:1px solid #ecece7;
                              border-radius:14px;
                            "
                          >
                            <div
                              style="
                                font-size:22px;
                                font-weight:800;
                              "
                            >
                              ${countSummary.quickSalesTotal}
                            </div>

                            <div class="muted">
                              Quick未割当販売
                            </div>
                          </div>

                          <div
                            style="
                              padding:12px;
                              border:1px solid #ecece7;
                              border-radius:14px;
                            "
                          >
                            <div
                              style="
                                font-size:22px;
                                font-weight:800;
                              "
                            >
                              ${countSummary.expectedTotal}
                            </div>

                            <div class="muted">
                              計算上残数
                            </div>
                          </div>

                          <div
                            style="
                              padding:12px;
                              border:1px solid #ecece7;
                              border-radius:14px;
                            "
                          >
                            <div
                              style="
                                font-size:22px;
                                font-weight:800;
                              "
                            >
                              ${
                                countSummary.complete
                                  ? countSummary.actualTotal
                                  : `${countSummary.countedCount}/${countSummary.totalSkuCount}`
                              }
                            </div>

                            <div class="muted">
                              ${
                                countSummary.complete
                                  ? "終了実数"
                                  : "カウント済みSKU"
                              }
                            </div>
                          </div>

                          <div
                            style="
                              padding:12px;
                              border:1px solid #ecece7;
                              border-radius:14px;
                            "
                          >
                            <div
                              style="
                                font-size:22px;
                                font-weight:800;
                              "
                            >
                              ${escapeHtml(
                                countDifferenceLabel(
                                  countSummary
                                    .unclassifiedDifference
                                )
                              )}
                            </div>

                            <div class="muted">
                              未分類差異
                            </div>
                          </div>
                        </div>

                        ${
                          inventorySessionClosed
                            ? `
                              <div
                                style="
                                  margin-top:12px;
                                  padding:12px;
                                  border:1px solid #d9e4d7;
                                  border-radius:12px;
                                  background:#f5faf4;
                                  line-height:1.5;
                                  font-weight:700;
                                "
                              >
                                このイベントは終了済みです。在庫確認は閲覧のみで、POS販売・開始在庫・終了在庫の変更はできません。
                              </div>
                            `
                            : ""
                        }

                        ${
                          countSummary.recordedReductionTotal >
                            0 ||
                          countSummary.stockAdjustmentTotal !==
                            0
                            ? `
                              <div class="list-row">
                                <span>
                                  記録済み減少
                                </span>

                                <strong>
                                  ${countSummary.recordedReductionTotal}
                                </strong>
                              </div>

                              <div class="list-row">
                                <span>
                                  在庫調整
                                </span>

                                <strong>
                                  ${
                                    countSummary.stockAdjustmentTotal >
                                    0
                                      ? "+"
                                      : ""
                                  }${countSummary.stockAdjustmentTotal}
                                </strong>
                              </div>
                            `
                            : ""
                        }

                        <details
                          style="
                            margin-top:14px;
                            border:1px solid #ecece7;
                            border-radius:14px;
                            padding:10px 12px;
                          "
                        >
                          <summary
                            style="
                              cursor:pointer;
                              font-weight:800;
                              padding:4px 0;
                            "
                          >
                            現在のSKU別在庫残数を見る
                            （${skuExpectedRemainingTotal}点）
                          </summary>

                          <div
                            class="muted"
                            style="
                              margin-top:8px;
                              line-height:1.5;
                              font-size:12px;
                            "
                          >
                            開始在庫 − SKU販売 − 記録済み減少 ＋ 在庫調整 で計算しています。Design / Body / Color列は固定され、サイズだけ横にスクロールできます。
                          </div>

                          ${
                            countSummary.quickSalesTotal >
                            0
                              ? `
                                <div
                                  class="warning"
                                  style="
                                    margin-top:8px;
                                  "
                                >
                                  Quick販売 ${countSummary.quickSalesTotal} 点はSKUに割り当てられていないため、このSKU別残数には配分していません。上の「計算上残数」には反映されています。
                                </div>
                              `
                              : ""
                          }

                          ${
                            tshirtRemainingGroups.length
                              ? `
                                <div
                                  style="
                                    margin-top:14px;
                                    font-weight:800;
                                  "
                                >
                                  Tシャツ
                                </div>

                                <div
                                  style="
                                    overflow-x:auto;
                                    margin-top:8px;
                                    border:1px solid #ecece7;
                                    border-radius:12px;
                                  "
                                >
                                  <div
                                    style="
                                      min-width:420px;
                                    "
                                  >
                                    <div
                                      style="
                                        display:grid;
                                        grid-template-columns:
                                          140px
                                          repeat(5,56px);
                                        background:#f7f7f4;
                                        border-bottom:1px solid #ecece7;
                                        font-size:12px;
                                        font-weight:800;
                                      "
                                    >
                                      <div
                                        style="
                                          padding:8px;
                                        "
                                      >
                                        Design / Body / Color
                                      </div>

                                      ${EVENT_TSHIRT_SIZE_ORDER.map(
                                        size => `
                                          <div
                                            style="
                                              padding:9px 4px;
                                              text-align:center;
                                            "
                                          >
                                            ${size}
                                          </div>
                                        `
                                      ).join("")}
                                    </div>

                                    ${tshirtRemainingGroups.map(
                                      group => `
                                        <div
                                          style="
                                            display:grid;
                                            grid-template-columns:
                                              140px
                                              repeat(5,56px);
                                            border-bottom:1px solid #ecece7;
                                          "
                                        >
                                          <div
                                            style="
                                              padding:8px;
                                              min-width:0;
                                            "
                                          >
                                            <div
                                              style="
                                                font-weight:800;
                                                font-size:14px;
                                                line-height:1.2;
                                                overflow-wrap:anywhere;
                                              "
                                            >
                                              ${escapeHtml(
                                                group.design
                                              )}
                                            </div>

                                            <div
                                              class="muted"
                                              style="
                                                margin-top:3px;
                                                font-size:10px;
                                                line-height:1.25;
                                                overflow-wrap:anywhere;
                                              "
                                            >
                                              ${escapeHtml(
                                                [
                                                  group.body,
                                                  group.color
                                                ]
                                                  .filter(Boolean)
                                                  .join(" / ")
                                              )}
                                            </div>
                                          </div>

                                          ${EVENT_TSHIRT_SIZE_ORDER.map(
                                            size => {
                                              const item =
                                                group.items.find(
                                                  row =>
                                                    row.size ===
                                                    size
                                                );

                                              if (!item) {
                                                return `
                                                  <div
                                                    style="
                                                      display:flex;
                                                      align-items:center;
                                                      justify-content:center;
                                                      min-height:62px;
                                                      border-left:1px solid #f0f0ec;
                                                      background:#f3f3f0;
                                                      color:#bbb;
                                                    "
                                                  >
                                                    —
                                                  </div>
                                                `;
                                              }

                                              const soldOut =
                                                item.remainingQty <=
                                                0;

                                              return `
                                                <div
                                                  style="
                                                    min-height:62px;
                                                    padding:7px 4px;
                                                    border-left:1px solid #f0f0ec;
                                                    text-align:center;
                                                    background:${
                                                      soldOut
                                                        ? "#f3f3f0"
                                                        : "#fff"
                                                    };
                                                    color:${
                                                      soldOut
                                                        ? "#aaa"
                                                        : "#1f1f1f"
                                                    };
                                                  "
                                                >
                                                  <div
                                                    style="
                                                      font-size:18px;
                                                      font-weight:800;
                                                    "
                                                  >
                                                    ${item.remainingQty}
                                                  </div>

                                                  <div
                                                    style="
                                                      margin-top:2px;
                                                      font-size:10px;
                                                      color:#888;
                                                      line-height:1.25;
                                                    "
                                                  >
                                                    開${item.openingQty}
                                                    ${
                                                      item.soldQty >
                                                      0
                                                        ? ` / 売${item.soldQty}`
                                                        : ""
                                                    }
                                                  </div>
                                                </div>
                                              `;
                                            }
                                          ).join("")}
                                        </div>
                                      `
                                    ).join("")}
                                  </div>
                                </div>
                              `
                              : ""
                          }

                          ${
                            accessoryRemainingRows.length
                              ? `
                                <div
                                  style="
                                    margin-top:14px;
                                    font-weight:800;
                                  "
                                >
                                  アクセサリー
                                </div>

                                <div
                                  style="
                                    margin-top:6px;
                                  "
                                >
                                  ${accessoryRemainingRows.map(
                                    row => `
                                      <div
                                        style="
                                          display:grid;
                                          grid-template-columns:
                                            minmax(0,1fr)
                                            auto;
                                          gap:10px;
                                          align-items:center;
                                          padding:10px 0;
                                          border-bottom:1px solid #ecece7;
                                          ${
                                            row.remainingQty <=
                                            0
                                              ? "color:#aaa;"
                                              : ""
                                          }
                                        "
                                      >
                                        <div
                                          style="
                                            min-width:0;
                                          "
                                        >
                                          <div
                                            style="
                                              font-weight:800;
                                            "
                                          >
                                            ${escapeHtml(
                                              row.label
                                            )}
                                          </div>

                                          <div
                                            class="muted"
                                            style="
                                              margin-top:2px;
                                              font-size:12px;
                                              line-height:1.4;
                                            "
                                          >
                                            ${escapeHtml(
                                              row.detail
                                            )}
                                            ${
                                              row.sku
                                                ? `<br>${escapeHtml(
                                                    row.sku
                                                  )}`
                                                : ""
                                            }
                                          </div>
                                        </div>

                                        <div
                                          style="
                                            min-width:82px;
                                            text-align:right;
                                          "
                                        >
                                          <div
                                            style="
                                              font-size:20px;
                                              font-weight:800;
                                            "
                                          >
                                            ${row.remainingQty}
                                          </div>

                                          <div
                                            class="muted"
                                            style="
                                              margin-top:2px;
                                              font-size:10px;
                                            "
                                          >
                                            開${row.openingQty}
                                            ${
                                              row.soldQty >
                                              0
                                                ? ` / 売${row.soldQty}`
                                                : ""
                                            }
                                          </div>
                                        </div>
                                      </div>
                                    `
                                  ).join("")}
                                </div>
                              `
                              : ""
                          }
                        </details>

                        ${
                          countSummary.quickSalesTotal >
                          0
                            ? `
                              <div
                                class="warning"
                                style="
                                  margin-top:12px;
                                "
                              >
                                Quick販売
                                ${countSummary.quickSalesTotal}
                                点はSKUが特定されていないため、合計残数には反映しますがSKU別には自動配分しません。
                              </div>
                            `
                            : ""
                        }

                        ${
                          !inventorySessionClosed
                            ? `
                              <div
                                style="
                                  margin-top:14px;
                                  padding:14px;
                                  border:1px solid ${
                                    eventReadyToClose
                                      ? "#d9e4d7"
                                      : "#ead796"
                                  };
                                  border-radius:14px;
                                  background:${
                                    eventReadyToClose
                                      ? "#f5faf4"
                                      : "#fff8df"
                                  };
                                "
                              >
                                <div
                                  style="
                                    font-weight:800;
                                    font-size:16px;
                                  "
                                >
                                  イベント終了確定
                                </div>

                                <div
                                  style="
                                    margin-top:7px;
                                    line-height:1.55;
                                    font-size:13px;
                                  "
                                >
                                  ${
                                    eventReadyToClose
                                      ? `
                                        終了在庫はすべて入力済みで、SKU別の未分類差異は0です。終了確定するとPOS販売を停止し、紛失・盗難・破損・プレゼント・サンプル・在庫調整を正式実在庫へ一度だけ反映します。
                                      `
                                      : `
                                        終了するには、全SKUの終了実数を入力し、SKU別の差異を0にしてください。
                                      `
                                  }
                                </div>

                                ${
                                  !eventReadyToClose
                                    ? `
                                      <div
                                        class="muted"
                                        style="
                                          margin-top:8px;
                                          line-height:1.5;
                                        "
                                      >
                                        未入力 ${
                                          countSummary.incompleteCount
                                        } SKU /
                                        Quick未割当 ${
                                          countSummary.quickSalesTotal
                                        } 点 /
                                        開始在庫外SKU販売 ${
                                          sales.otherUnallocated
                                        } 点 /
                                        SKU別差異 ${
                                          perSkuDifferenceCount
                                        } 件
                                      </div>
                                    `
                                    : ""
                                }

                                <button
                                  id="finalizeEventSessionButton"
                                  type="button"
                                  class="button"
                                  ${
                                    eventReadyToClose
                                      ? ""
                                      : "disabled"
                                  }
                                  style="
                                    width:100%;
                                    min-height:52px;
                                    margin-top:12px;
                                    ${
                                      eventReadyToClose
                                        ? ""
                                        : "opacity:.45;"
                                    }
                                  "
                                >
                                  イベントを終了して在庫を確定
                                </button>

                                <div
                                  id="eventFinalizeMessage"
                                  class="muted"
                                  style="
                                    margin-top:8px;
                                    line-height:1.5;
                                  "
                                ></div>
                              </div>
                            `
                            : ""
                        }

                        <details
                          style="
                            margin-top:14px;
                            ${
                              inventorySessionClosed
                                ? "display:none;"
                                : ""
                            }
                          "
                        >
                          <summary
                            style="
                              cursor:pointer;
                              font-weight:800;
                              padding:8px 0;
                            "
                          >
                            終了在庫を数える
                          </summary>

                          <div
                            style="
                              margin-top:10px;
                            "
                          >
                            <div
                              class="muted"
                              style="
                                line-height:1.55;
                              "
                            >
                              「終了実数」には会場で実際に数えた数量を入力します。会社全体の実在庫ではなく、このイベントの「計算残数」を基準に確認してください。
                            </div>

                            <div
                              style="
                                display:grid;
                                grid-template-columns:
                                  repeat(
                                    2,
                                    minmax(0,1fr)
                                  );
                                gap:8px;
                                margin-top:10px;
                              "
                            >
                              <button
                                id="copyCalculatedStockToClosingButton"
                                type="button"
                                class="button button-secondary"
                                style="
                                  min-height:44px;
                                "
                              >
                                計算残数を終了実数へコピー
                              </button>

                              <button
                                id="clearClosingCountButton"
                                type="button"
                                class="button button-secondary"
                                style="
                                  min-height:44px;
                                "
                              >
                                終了実数をクリア
                              </button>
                            </div>

                            <input
                              id="inventoryCountSearch"
                              type="search"
                              placeholder="SKU、商品名、色、サイズで検索"
                              style="
                                ${inputStyle()}
                                margin-top:10px;
                              "
                            >

                            <div
                              id="inventoryCountRows"
                              style="
                                margin-top:8px;
                              "
                            >
                              ${openingItems.map(
                                opening => {
                                  const closing =
                                    closingMap.get(
                                      opening.variantId
                                    ) || {};

                                  const skuSales =
                                    sales.exactByVariant.get(
                                      opening.variantId
                                    ) || 0;

                                  const systemQty =
                                    currentMap.get(
                                      opening.variantId
                                    ) || 0;

                                  const reasonTotal =
                                    Number(
                                      closing.loss ||
                                      0
                                    ) +
                                    Number(
                                      closing.theft ||
                                      0
                                    ) +
                                    Number(
                                      closing.damage ||
                                      0
                                    ) +
                                    Number(
                                      closing.gift ||
                                      0
                                    ) +
                                    Number(
                                      closing.sample ||
                                      0
                                    );

                                  const rowExpected =
                                    Number(
                                      opening.openingQty ||
                                      0
                                    ) -
                                    skuSales -
                                    reasonTotal +
                                    Number(
                                      closing.stockAdjustment ||
                                      0
                                    );

                                  const searchText =
                                    [
                                      opening.sku,
                                      opening.label,
                                      opening.detail,
                                      POS_CATEGORY_LABELS[
                                        opening.category
                                      ] ||
                                      opening.category
                                    ]
                                      .filter(Boolean)
                                      .join(" ")
                                      .toLocaleLowerCase();

                                  return `
                                    <div
                                      class="inventoryCountRow"
                                      data-search="${escapeHtml(
                                        searchText
                                      )}"
                                      data-variant-id="${escapeHtml(
                                        opening.variantId
                                      )}"
                                      data-calculated-qty="${Math.max(
                                        0,
                                        rowExpected
                                      )}"
                                      data-global-stock-qty="${systemQty}"
                                      style="
                                        padding:12px 0;
                                        border-bottom:1px solid #ecece7;
                                      "
                                    >
                                      <div
                                        style="
                                          display:flex;
                                          justify-content:space-between;
                                          gap:10px;
                                          align-items:flex-start;
                                        "
                                      >
                                        <div
                                          style="
                                            min-width:0;
                                            flex:1;
                                          "
                                        >
                                          <div
                                            style="
                                              font-weight:800;
                                            "
                                          >
                                            ${escapeHtml(
                                              opening.label
                                            )}
                                          </div>

                                          <div
                                            class="muted"
                                            style="
                                              margin-top:3px;
                                              line-height:1.45;
                                            "
                                          >
                                            ${escapeHtml(
                                              opening.detail
                                            )}

                                            ${
                                              opening.sku
                                                ? `
                                                  <br>
                                                  ${escapeHtml(
                                                    opening.sku
                                                  )}
                                                `
                                                : ""
                                            }
                                          </div>
                                        </div>

                                        <div
                                          style="
                                            text-align:right;
                                            white-space:nowrap;
                                            font-size:12px;
                                          "
                                        >
                                          <div>
                                            開始
                                            <strong>
                                              ${opening.openingQty}
                                            </strong>
                                          </div>

                                          <div>
                                            販売
                                            <strong>
                                              ${skuSales}
                                            </strong>
                                          </div>

                                          <div>
                                            イベント残数
                                            <strong
                                              style="
                                                font-size:15px;
                                              "
                                            >
                                              ${Math.max(
                                                0,
                                                rowExpected
                                              )}
                                            </strong>
                                          </div>

                                          <div
                                            class="muted"
                                            style="
                                              margin-top:2px;
                                              font-size:10px;
                                            "
                                          >
                                            会社実在庫
                                            ${systemQty}
                                            （参考）
                                          </div>
                                        </div>
                                      </div>

                                      <label
                                        style="
                                          display:grid;
                                          grid-template-columns:
                                            minmax(0,1fr)
                                            110px;
                                          gap:8px;
                                          align-items:center;
                                          margin-top:10px;
                                        "
                                      >
                                        <span
                                          style="
                                            font-weight:700;
                                          "
                                        >
                                          終了実数
                                        </span>

                                        <input
                                          class="inventoryClosingQty"
                                          data-variant-id="${escapeHtml(
                                            opening.variantId
                                          )}"
                                          type="number"
                                          min="0"
                                          step="1"
                                          inputmode="numeric"
                                          value="${
                                            closing.closingQty !==
                                              null &&
                                            closing.closingQty !==
                                              undefined
                                              ? closing.closingQty
                                              : ""
                                          }"
                                          placeholder="未入力"
                                          style="${inputStyle()}"
                                        >
                                      </label>

                                      <div
                                        class="inventoryClosingDifference muted"
                                        data-variant-id="${escapeHtml(
                                          opening.variantId
                                        )}"
                                        style="
                                          margin-top:5px;
                                          font-size:12px;
                                          min-height:18px;
                                        "
                                      ></div>

                                      <details
                                        style="
                                          margin-top:8px;
                                        "
                                      >
                                        <summary
                                          style="
                                            cursor:pointer;
                                            font-size:13px;
                                            font-weight:700;
                                          "
                                        >
                                          紛失・破損などを記録
                                        </summary>

                                        <div
                                          style="
                                            display:grid;
                                            grid-template-columns:
                                              repeat(
                                                2,
                                                minmax(0,1fr)
                                              );
                                            gap:8px;
                                            margin-top:8px;
                                          "
                                        >
                                          ${[
                                            ["loss", "紛失", false],
                                            ["theft", "盗難", false],
                                            ["damage", "破損", false],
                                            ["gift", "プレゼント", false],
                                            ["sample", "サンプル", false],
                                            ["stockAdjustment", "在庫調整", true]
                                          ].map(
                                            ([key, label, signed]) => `
                                              <label>
                                                <div
                                                  class="muted"
                                                  style="
                                                    margin-bottom:4px;
                                                    font-size:12px;
                                                  "
                                                >
                                                  ${label}
                                                </div>

                                                <input
                                                  class="inventoryReasonInput"
                                                  data-variant-id="${escapeHtml(
                                                    opening.variantId
                                                  )}"
                                                  data-reason="${key}"
                                                  type="number"
                                                  ${
                                                    signed
                                                      ? ""
                                                      : 'min="0"'
                                                  }
                                                  step="1"
                                                  inputmode="${
                                                    signed
                                                      ? "decimal"
                                                      : "numeric"
                                                  }"
                                                  value="${
                                                    Number(
                                                      closing[
                                                        key
                                                      ] ||
                                                      0
                                                    ) ||
                                                    ""
                                                  }"
                                                  placeholder="0"
                                                  style="${inputStyle()}"
                                                >
                                              </label>
                                            `
                                          ).join("")}
                                        </div>

                                        <div
                                          class="muted"
                                          style="
                                            margin-top:7px;
                                            font-size:11px;
                                          "
                                        >
                                          在庫調整は増加を＋、減少を−で入力できます。「終了在庫・理由を保存」では記録だけを行い、「イベントを終了して在庫を確定」を押した時に正式実在庫へ一度だけ反映します。
                                        </div>
                                      </details>
                                    </div>
                                  `;
                                }
                              ).join("")}
                            </div>

                            <button
                              id="saveClosingInventoryButton"
                              type="button"
                              class="button"
                              style="
                                width:100%;
                                min-height:52px;
                                margin-top:14px;
                              "
                            >
                              終了在庫・理由を保存
                            </button>

                            <div
                              id="inventoryCountMessage"
                              class="muted"
                              style="
                                margin-top:10px;
                              "
                            ></div>
                          </div>
                        </details>

                        ${
                          !inventorySessionClosed
                            ? `
                              <div
                                style="
                                  margin-top:14px;
                                  padding:12px;
                                  border:1px solid #ecece7;
                                  border-radius:14px;
                                "
                              >
                                <div
                                  style="
                                    font-weight:800;
                                  "
                                >
                                  開始在庫の編集
                                </div>

                                ${
                                  openingInventoryLocked
                                    ? `
                                      <div
                                        class="warning"
                                        style="
                                          margin-top:8px;
                                        "
                                      >
                                        有効な売上が ${activeInventoryTransactions.length} 件あるため、開始在庫は変更・リセットできません。売上取消後に操作できます。
                                      </div>
                                    `
                                    : `
                                      <div
                                        class="muted"
                                        style="
                                          margin-top:6px;
                                          line-height:1.5;
                                        "
                                      >
                                        保存済みの持参数を編集できます。会社全在庫を自動取得する処理は行いません。変更すると保存済みの終了在庫はクリアされます。
                                      </div>

                                      <div
                                        style="
                                          display:grid;
                                          grid-template-columns:
                                            repeat(2,minmax(0,1fr));
                                          gap:8px;
                                          margin-top:10px;
                                        "
                                      >
                                        <button
                                          id="editOpeningInventoryButton"
                                          type="button"
                                          class="button button-secondary"
                                          style="
                                            min-height:44px;
                                          "
                                        >
                                          開始在庫を編集
                                        </button>

                                        <button
                                          id="resetOpeningInventoryButton"
                                          type="button"
                                          style="
                                            min-height:44px;
                                            border:1px solid #e0c9c9;
                                            border-radius:10px;
                                            background:#fff;
                                            color:#824747;
                                            font-weight:800;
                                          "
                                        >
                                          開始在庫をリセット
                                        </button>
                                      </div>
                                    `
                                }
                              </div>
                            `
                            : ""
                        }
                      `
                  }
                </section>
              `;
            })()
          : ""
      }


      ${
        selectedDetailSession
          ? (() => {
              const summary =
                selectedDetailSession
                  .salesSummary || {};

              const netSales =
                Number(
                  summary.netSales || 0
                );

              const transactionCount =
                Number(
                  summary.transactionCount || 0
                );

              const itemCount =
                Number(
                  summary.itemCount || 0
                );

              const dayCount =
                sessionDayCount(
                  selectedDetailSession.startDate,
                  selectedDetailSession.endDate
                );

              const averageOrder =
                transactionCount > 0
                  ? netSales /
                    transactionCount
                  : 0;

              const salesPerDay =
                dayCount > 0
                  ? netSales /
                    dayCount
                  : 0;

              const totalExpensesJPY =
                sessionExpenseTotalJPY(
                  selectedDetailSession
                );

              const netSalesJPY =
                sessionNetSalesJPY(
                  selectedDetailSession
                );

              const eventBalanceJPY =
                netSalesJPY -
                totalExpensesJPY;

              const expenseRate =
                netSalesJPY > 0
                  ? (
                      totalExpensesJPY /
                      netSalesJPY
                    ) *
                    100
                  : 0;

              const cogs =
                calculateResolvedCogs({
                  transactions:
                    activeSessionTransactions,

                  categoryHistories:
                    categoryCostHistories,

                  bodyHistories:
                    tshirtBodyCostHistories,

                  variantHistories:
                    detailVariantCostHistories,

                  variantsById:
                    detailVariantsById,

                  fallbackDate:
                    selectedDetailSession.startDate
                });

              const costComplete =
                cogs.missingQuantity ===
                0;

              const grossProfitJPY =
                costComplete
                  ? (
                      netSalesJPY -
                      cogs.totalCostJPY
                    )
                  : null;

              const grossMargin =
                costComplete &&
                netSalesJPY > 0
                  ? (
                      grossProfitJPY /
                      netSalesJPY
                    ) *
                    100
                  : null;

              const finalProfitJPY =
                costComplete
                  ? (
                      netSalesJPY -
                      cogs.totalCostJPY -
                      totalExpensesJPY
                    )
                  : null;

              const finalMargin =
                costComplete &&
                netSalesJPY > 0
                  ? (
                      finalProfitJPY /
                      netSalesJPY
                    ) *
                    100
                  : null;

              const categories =
                categorySalesSummary(
                  activeSessionTransactions
                );

              return `
                <section
                  class="card"
                  id="sessionSalesDetail"
                >

                  <div
                    style="
                      display:flex;
                      justify-content:space-between;
                      gap:10px;
                      align-items:flex-start;
                      margin-bottom:12px;
                    "
                  >
                    <div>
                      <div class="card-title">
                        売上詳細
                      </div>

                      <div
                        style="
                          margin-top:4px;
                          font-weight:800;
                        "
                      >
                        ${escapeHtml(
                          selectedDetailSession.eventName
                        )}
                      </div>
                    </div>

                    <button
                      id="closeSessionDetailButton"
                      class="button button-secondary"
                      type="button"
                      style="
                        min-height:38px;
                        padding:0 14px;
                      "
                    >
                      閉じる
                    </button>
                  </div>


                  <div
                    class="grid grid-2"
                    style="
                      margin-bottom:14px;
                    "
                  >

                    <div
                      style="
                        padding:14px;
                        border:1px solid #ecece7;
                        border-radius:14px;
                      "
                    >
                      <div
                        style="
                          font-size:22px;
                          font-weight:800;
                        "
                      >
                        ${formatMoney(
                          netSales,
                          selectedDetailSession.currency
                        )}
                      </div>

                      <div class="muted">
                        総売上
                      </div>
                    </div>


                    <div
                      style="
                        padding:14px;
                        border:1px solid #ecece7;
                        border-radius:14px;
                      "
                    >
                      <div
                        style="
                          font-size:22px;
                          font-weight:800;
                        "
                      >
                        ${transactionCount}
                      </div>

                      <div class="muted">
                        会計数
                      </div>
                    </div>


                    <div
                      style="
                        padding:14px;
                        border:1px solid #ecece7;
                        border-radius:14px;
                      "
                    >
                      <div
                        style="
                          font-size:22px;
                          font-weight:800;
                        "
                      >
                        ${formatMoney(
                          averageOrder,
                          selectedDetailSession.currency
                        )}
                      </div>

                      <div class="muted">
                        客単価
                      </div>
                    </div>


                    <div
                      style="
                        padding:14px;
                        border:1px solid #ecece7;
                        border-radius:14px;
                      "
                    >
                      <div
                        style="
                          font-size:22px;
                          font-weight:800;
                        "
                      >
                        ${formatMoney(
                          salesPerDay,
                          selectedDetailSession.currency
                        )}
                      </div>

                      <div class="muted">
                        1日あたり売上
                      </div>
                    </div>

                  </div>


                  <div class="list-row">
                    <span>
                      販売点数
                    </span>

                    <strong>
                      ${itemCount}
                    </strong>
                  </div>


                  <div class="list-row">
                    <span>
                      値引
                    </span>

                    <strong>
                      ${formatMoney(
                        Number(
                          summary.discount || 0
                        ),
                        selectedDetailSession.currency
                      )}
                    </strong>
                  </div>


                  ${
                    selectedDetailSession.fxRateToJPY
                      ? `
                        <div class="list-row">
                          <span>
                            円換算売上
                          </span>

                          <strong>
                            ${formatMoney(
                              Number(
                                summary.netSalesJPY || 0
                              ),
                              "JPY"
                            )}
                          </strong>
                        </div>
                      `
                      : ""
                  }


                  <div
                    style="
                      margin-top:14px;
                      padding-top:12px;
                      border-top:1px solid #ecece7;
                    "
                  >
                    <div
                      style="
                        display:flex;
                        justify-content:space-between;
                        gap:10px;
                        align-items:center;
                        margin-bottom:6px;
                      "
                    >
                      <div class="card-title">
                        イベント経費
                      </div>

                      <strong>
                        ${formatMoney(
                          totalExpensesJPY,
                          "JPY"
                        )}
                      </strong>
                    </div>

                    ${EVENT_EXPENSE_ORDER.map(
                      key => {
                        const item =
                          selectedDetailSession
                            ?.expenses
                            ?.[key] || {
                              amount: 0,
                              currency: "JPY",
                              amountJPY: 0
                            };

                        return `
                          <div class="list-row">
                            <span>
                              ${escapeHtml(
                                EVENT_EXPENSE_LABELS[
                                  key
                                ]
                              )}
                            </span>

                            <span
                              style="
                                text-align:right;
                              "
                            >
                              <strong>
                                ${formatMoney(
                                  Number(
                                    item.amount || 0
                                  ),
                                  item.currency || "JPY"
                                )}
                              </strong>

                              ${
                                item.currency !== "JPY" &&
                                Number(
                                  item.amount || 0
                                ) > 0
                                  ? `
                                    <div class="muted">
                                      ${formatMoney(
                                        Number(
                                          item.amountJPY || 0
                                        ),
                                        "JPY"
                                      )}
                                    </div>
                                  `
                                  : ""
                              }
                            </span>
                          </div>
                        `;
                      }
                    ).join("")}

                    <div
                      class="list-row"
                      style="
                        margin-top:8px;
                        font-size:18px;
                      "
                    >
                      <strong>
                        経費差引収支
                      </strong>

                      <strong>
                        ${formatMoney(
                          eventBalanceJPY,
                          "JPY"
                        )}
                      </strong>
                    </div>

                    <div class="list-row">
                      <span>
                        イベント費用率
                      </span>

                      <strong>
                        ${expenseRate.toFixed(1)}%
                      </strong>
                    </div>

                    <div
                      style="
                        margin-top:14px;
                        padding-top:12px;
                        border-top:1px solid #ecece7;
                      "
                    >
                      <div class="card-title">
                        利益
                      </div>

                      <div
                        class="muted"
                        style="
                          margin:4px 0 8px;
                          font-size:12px;
                          line-height:1.45;
                        "
                      >
                        新しい売上は会計時の原価を固定保存します。原価マスターを後から変更しても、その売上の原価は変わりません。
                      </div>

                      <div class="list-row">
                        <span>
                          商品原価
                        </span>

                        <strong>
                          ${formatMoney(
                            cogs.totalCostJPY,
                            "JPY"
                          )}
                        </strong>
                      </div>

                      ${
                        cogs.missingQuantity > 0
                          ? `
                            <div
                              class="warning"
                              style="
                                margin-top:10px;
                              "
                            >
                              原価未設定の商品が
                              ${cogs.missingQuantity}
                              点あります。
                              粗利益と最終利益はまだ確定しません。
                            </div>
                          `
                          : `
                            <div class="list-row">
                              <span>
                                粗利益
                              </span>

                              <strong>
                                ${formatMoney(
                                  grossProfitJPY,
                                  "JPY"
                                )}
                              </strong>
                            </div>

                            <div class="list-row">
                              <span>
                                粗利益率
                              </span>

                              <strong>
                                ${
                                  Number.isFinite(
                                    grossMargin
                                  )
                                    ? `${grossMargin.toFixed(
                                        1
                                      )}%`
                                    : "—"
                                }
                              </strong>
                            </div>

                            <div
                              class="list-row"
                              style="
                                margin-top:8px;
                                font-size:18px;
                              "
                            >
                              <strong>
                                最終利益
                              </strong>

                              <strong>
                                ${formatMoney(
                                  finalProfitJPY,
                                  "JPY"
                                )}
                              </strong>
                            </div>

                            <div class="list-row">
                              <span>
                                最終利益率
                              </span>

                              <strong>
                                ${
                                  Number.isFinite(
                                    finalMargin
                                  )
                                    ? `${finalMargin.toFixed(
                                        1
                                      )}%`
                                    : "—"
                                }
                              </strong>
                            </div>
                          `
                      }

                      <div
                        class="muted"
                        style="
                          margin-top:10px;
                          line-height:1.55;
                        "
                      >
                        原価は SKU、Body、カテゴリ標準原価の順で優先します。Quick会計でSKU未指定の場合はカテゴリ標準原価を使用します。
                      </div>
                    </div>

                    <details
                      style="
                        margin-top:14px;
                      "
                    >
                      <summary
                        style="
                          cursor:pointer;
                          font-weight:800;
                          padding:10px 0;
                        "
                      >
                        経費を編集
                      </summary>

                      <div
                        style="
                          display:grid;
                          gap:10px;
                          margin-top:8px;
                        "
                      >
                        ${EVENT_EXPENSE_ORDER.map(
                          key => {
                            const item =
                              selectedDetailSession
                                ?.expenses
                                ?.[key] || {
                                  amount: 0,
                                  currency: "JPY"
                                };

                            const localCurrency =
                              selectedDetailSession.currency;

                            return `
                              <div
                                style="
                                  display:grid;
                                  grid-template-columns:
                                    minmax(0,1fr)
                                    120px
                                    92px;
                                  gap:8px;
                                  align-items:center;
                                "
                              >
                                <div>
                                  ${escapeHtml(
                                    EVENT_EXPENSE_LABELS[
                                      key
                                    ]
                                  )}
                                </div>

                                <input
                                  class="eventExpenseAmount"
                                  data-expense-key="${key}"
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  inputmode="decimal"
                                  value="${
                                    Number(
                                      item.amount || 0
                                    ) || ""
                                  }"
                                  placeholder="0"
                                  style="
                                    width:100%;
                                    min-height:42px;
                                    padding:0 8px;
                                    border:1px solid #deded9;
                                    border-radius:10px;
                                    text-align:right;
                                  "
                                >

                                <select
                                  class="eventExpenseCurrency"
                                  data-expense-key="${key}"
                                  style="
                                    width:100%;
                                    min-height:42px;
                                    padding:0 6px;
                                    border:1px solid #deded9;
                                    border-radius:10px;
                                    background:white;
                                  "
                                >
                                  <option
                                    value="JPY"
                                    ${
                                      item.currency === "JPY"
                                        ? "selected"
                                        : ""
                                    }
                                  >
                                    JPY
                                  </option>

                                  ${
                                    localCurrency !== "JPY"
                                      ? `
                                        <option
                                          value="${escapeHtml(
                                            localCurrency
                                          )}"
                                          ${
                                            item.currency ===
                                            localCurrency
                                              ? "selected"
                                              : ""
                                          }
                                        >
                                          ${escapeHtml(
                                            localCurrency
                                          )}
                                        </option>
                                      `
                                      : ""
                                  }
                                </select>
                              </div>
                            `;
                          }
                        ).join("")}

                        <button
                          id="saveEventExpensesButton"
                          class="button"
                          type="button"
                          style="
                            width:100%;
                            min-height:50px;
                            margin-top:4px;
                          "
                        >
                          経費を保存
                        </button>

                        <div
                          id="saveEventExpensesMessage"
                          class="muted"
                        ></div>
                      </div>
                    </details>
                  </div>


                  ${
                    categories.length
                      ? `
                        <div
                          style="
                            margin-top:14px;
                            padding-top:12px;
                            border-top:1px solid #ecece7;
                          "
                        >
                          <div
                            class="card-title"
                            style="
                              margin-bottom:6px;
                            "
                          >
                            カテゴリ別
                          </div>

                          ${categories.map(
                            item => `
                              <div class="list-row">
                                <span>
                                  ${escapeHtml(
                                    item.label
                                  )}

                                  <span class="muted">
                                    ${item.quantity}点
                                  </span>
                                </span>

                                <strong>
                                  ${formatMoney(
                                    item.sales,
                                    selectedDetailSession.currency
                                  )}
                                </strong>
                              </div>
                            `
                          ).join("")}
                        </div>
                      `
                      : ""
                  }


                  <div
                    style="
                      margin-top:16px;
                      padding-top:12px;
                      border-top:1px solid #ecece7;
                    "
                  >

                    <div
                      class="card-title"
                      style="
                        margin-bottom:6px;
                      "
                    >
                      会計履歴
                    </div>


                    ${
                      sessionTransactions.length
                        ? sessionTransactions.map(
                            transaction => `
                              <div
                                style="
                                  padding:12px 0;
                                  border-bottom:1px solid #ecece7;
                                  ${
                                    transaction.status === "voided"
                                      ? "opacity:.58;"
                                      : ""
                                  }
                                "
                              >
                                <div
                                  style="
                                    display:flex;
                                    justify-content:space-between;
                                    gap:10px;
                                    align-items:flex-start;
                                  "
                                >
                                  <div>
                                    <div
                                      style="
                                        font-weight:700;
                                      "
                                    >
                                      ${transactionTimeText(
                                        transaction.createdAt
                                      ) || "保存済み"}

                                      ${
                                        transaction.status === "voided"
                                          ? `
                                            <span
                                              style="
                                                display:inline-block;
                                                margin-left:6px;
                                                padding:2px 7px;
                                                border-radius:999px;
                                                background:#ecece7;
                                                font-size:11px;
                                              "
                                            >
                                              取消済み
                                            </span>
                                          `
                                          : ""
                                      }
                                    </div>

                                    <div
                                      class="muted"
                                      style="
                                        margin-top:4px;
                                      "
                                    >
                                      ${transaction.itemCount}
                                      点
                                      /
                                      ${transaction.mode}
                                    </div>
                                  </div>

                                  <div
                                    style="
                                      text-align:right;
                                    "
                                  >
                                    <div
                                      style="
                                        font-weight:800;
                                        ${
                                          transaction.status === "voided"
                                            ? "text-decoration:line-through;"
                                            : ""
                                        }
                                      "
                                    >
                                      ${formatMoney(
                                        transaction.netSales,
                                        transaction.currency
                                      )}
                                    </div>

                                    ${
                                      transaction.discount > 0
                                        ? `
                                          <div class="muted">
                                            値引合計
                                            ${formatMoney(
                                              transaction.discount,
                                              transaction.currency
                                            )}
                                          </div>

                                          ${
                                            transaction.setDiscount > 0
                                              ? `
                                                <div class="muted">
                                                  セット
                                                  ${formatMoney(
                                                    transaction.setDiscount,
                                                    transaction.currency
                                                  )}
                                                </div>
                                              `
                                              : ""
                                          }

                                          ${
                                            transaction.lineDiscount > 0
                                              ? `
                                                <div class="muted">
                                                  個別
                                                  ${formatMoney(
                                                    transaction.lineDiscount,
                                                    transaction.currency
                                                  )}
                                                </div>
                                              `
                                              : ""
                                          }

                                          ${
                                            transaction.orderDiscount > 0
                                              ? `
                                                <div class="muted">
                                                  会計全体
                                                  ${formatMoney(
                                                    transaction.orderDiscount,
                                                    transaction.currency
                                                  )}
                                                </div>
                                              `
                                              : ""
                                          }
                                        `
                                        : ""
                                    }
                                  </div>
                                </div>

                                <div
                                  class="muted"
                                  style="
                                    margin-top:5px;
                                    word-break:break-all;
                                    font-size:11px;
                                  "
                                >
                                  ${escapeHtml(
                                    transaction.transactionId
                                  )}
                                </div>

                                ${
                                  transaction.status !== "voided"
                                    ? `
                                      <button
                                        type="button"
                                        class="voidSaleTransactionButton"
                                        data-transaction-id="${escapeHtml(
                                          transaction.transactionId
                                        )}"
                                        style="
                                          width:100%;
                                          min-height:42px;
                                          margin-top:10px;
                                          border:1px solid #d8d8d3;
                                          border-radius:12px;
                                          background:#fff;
                                          font-weight:700;
                                        "
                                      >
                                        この会計を取消
                                      </button>
                                    `
                                    : `
                                      <div
                                        class="muted"
                                        style="
                                          margin-top:7px;
                                          font-size:11px;
                                        "
                                      >
                                        ${
                                          transaction.voidedAt
                                            ? `取消日時 ${transactionTimeText(
                                                transaction.voidedAt
                                              )}`
                                            : "取消済み"
                                        }
                                      </div>
                                    `
                                }
                              </div>
                            `
                          ).join("")
                        : `
                          <div
                            class="muted"
                            style="
                              padding:14px 0;
                            "
                          >
                            まだ会計履歴はありません。
                          </div>
                        `
                    }

                  </div>

                </section>
              `;
            })()
          : ""
      }


      <section class="card">

        <div class="card-title">
          次の段階
        </div>

        <div
          class="muted"
          style="
            line-height:1.6;
          "
        >
          委託販売と卸売も同じ販売セッション構造に追加します。
        </div>

      </section>
    `;


    const currencySelect =
      document.querySelector(
        "#sessionCurrency"
      );


    const rateInput =
      document.querySelector(
        "#sessionFxRate"
      );


    function refreshRateField() {
      if (
        !currencySelect ||
        !rateInput
      ) {
        return;
      }

      if (
        currencySelect.value ===
        "JPY"
      ) {
        rateInput.value =
          "1";

        rateInput.disabled =
          true;
      } else {
        rateInput.disabled =
          false;

        if (
          rateInput.value ===
          "1"
        ) {
          rateInput.value =
            "";
        }
      }
    }


    refreshRateField();


    currencySelect
      ?.addEventListener(
        "change",
        refreshRateField
      );


    document
      .querySelector(
        "#createEventSessionButton"
      )
      ?.addEventListener(
        "click",
        async event => {

          const button =
            event.currentTarget;

          const messageBox =
            document.querySelector(
              "#createEventSessionMessage"
            );


          button.disabled =
            true;

          button.textContent =
            "作成中";


          if (messageBox) {
            messageBox.textContent =
              "";
          }


          try {
            const created =
              await createEventSession({
                eventName:
                  document
                    .querySelector(
                      "#sessionEventName"
                    )
                    ?.value,

                country:
                  document
                    .querySelector(
                      "#sessionCountry"
                    )
                    ?.value,

                city:
                  document
                    .querySelector(
                      "#sessionCity"
                    )
                    ?.value,

                startDate:
                  document
                    .querySelector(
                      "#sessionStartDate"
                    )
                    ?.value,

                endDate:
                  document
                    .querySelector(
                      "#sessionEndDate"
                    )
                    ?.value,

                currency:
                  currencySelect
                    ?.value ||
                  "JPY",

                fxRateToJPY:
                  rateInput
                    ?.value ||
                  null
              });


            activeSessionId =
              created.sessionId;

            localStorage.setItem(
              "icelolly-sales-active-session",
              activeSessionId
            );


            posCurrency =
              created.currency;

            localStorage.setItem(
              "icelolly-sales-pos-currency",
              posCurrency
            );


            posCart =
              new Map();

            posOrderDiscount =
              0;


            await renderSessions(
              ++renderSequence
            );


          } catch (error) {
            button.disabled =
              false;

            button.textContent =
              "イベントを作成";

            if (messageBox) {
              messageBox.textContent =
                error.code ||
                error.message ||
                String(error);
            }
          }
        }
      );


    document
      .querySelectorAll(
        ".sessionUseButton"
      )
      .forEach(
        button => {
          button.addEventListener(
            "click",
            () => {
              const session =
                openSessions.find(
                  item =>
                    item.sessionId ===
                    button.dataset.sessionId
                );

              if (!session) {
                return;
              }

              activeSessionId =
                session.sessionId;

              localStorage.setItem(
                "icelolly-sales-active-session",
                activeSessionId
              );

              posCurrency =
                session.currency;

              localStorage.setItem(
                "icelolly-sales-pos-currency",
                posCurrency
              );

              posCart =
                new Map();

              posOrderDiscount =
                0;

              render(
                "pos"
              );
            }
          );
        }
      );


    function clearSessionUiState(
      sessionId
    ) {
      if (
        activeSessionId ===
        sessionId
      ) {
        activeSessionId =
          "";

        localStorage.removeItem(
          "icelolly-sales-active-session"
        );
      }

      if (
        editingSessionId ===
        sessionId
      ) {
        editingSessionId =
          "";
      }

      if (
        sessionDetailId ===
        sessionId
      ) {
        sessionDetailId =
          "";
      }

      if (
        sessionInventoryCountId ===
        sessionId
      ) {
        sessionInventoryCountId =
          "";
      }

      if (
        sessionOpeningEditId ===
        sessionId
      ) {
        sessionOpeningEditId =
          "";
      }
    }


    function sessionRemovalReasonText(
      inspection
    ) {
      const labels = {
        sales:
          "売上履歴",

        inventory_movements:
          "在庫移動履歴",

        transaction_locks:
          "会計処理履歴",

        inventory_count:
          "イベント在庫確認",

        expenses:
          "経費",

        sales_summary:
          "売上集計"
      };

      return (
        inspection
          ?.reasons ||
        []
      )
        .map(
          reason =>
            labels[reason] ||
            reason
        )
        .filter(Boolean)
        .join("、");
    }


    document
      .querySelectorAll(
        ".sessionLifecycleButton"
      )
      .forEach(
        button => {
          button.addEventListener(
            "click",
            async () => {
              const sessionId =
                button.dataset.sessionId ||
                "";

              const session =
                sessions.find(
                  item =>
                    item.sessionId ===
                    sessionId
                );

              if (
                !session
              ) {
                return;
              }

              button.disabled =
                true;

              button.textContent =
                "確認中";

              try {
                const inspection =
                  await inspectEventSessionRemoval(
                    sessionId
                  );

                if (
                  inspection.canDelete
                ) {
                  const confirmed =
                    window.confirm(
                      `「${session.eventName}」を完全に削除しますか？\n\nこのイベントには売上・在庫確認・経費などの記録がないため削除できます。\nこの操作は元に戻せません。`
                    );

                  if (
                    !confirmed
                  ) {
                    button.disabled =
                      false;

                    button.textContent =
                      button.dataset
                        .originalLabel ||
                      "削除 / アーカイブ";

                    return;
                  }

                  await deleteEventSession(
                    sessionId
                  );

                  clearSessionUiState(
                    sessionId
                  );

                  await renderSessions(
                    ++renderSequence
                  );

                  return;
                }

                const reasonText =
                  sessionRemovalReasonText(
                    inspection
                  );

                const confirmed =
                  window.confirm(
                    `「${session.eventName}」には${reasonText || "保存済みデータ"}があります。\n\n関連履歴を残すため完全削除はせず、アーカイブしますか？\nアーカイブは後から復元できます。`
                  );

                if (
                  !confirmed
                ) {
                  button.disabled =
                    false;

                  button.textContent =
                    "削除 / アーカイブ";

                  return;
                }

                await archiveEventSession(
                  sessionId,
                  {
                    archivedByEmail:
                      currentUser
                        ?.email ||
                      ""
                  }
                );

                clearSessionUiState(
                  sessionId
                );

                await renderSessions(
                  ++renderSequence
                );

              } catch (error) {
                button.disabled =
                  false;

                button.textContent =
                  button.dataset
                    .originalLabel ||
                  "削除 / アーカイブ";

                window.alert(
                  error.code ||
                  error.message ||
                  String(error)
                );
              }
            }
          );
        }
      );


    document
      .querySelectorAll(
        ".restoreArchivedSessionButton"
      )
      .forEach(
        button => {
          button.addEventListener(
            "click",
            async () => {
              const sessionId =
                button.dataset.sessionId ||
                "";

              const session =
                sessions.find(
                  item =>
                    item.sessionId ===
                    sessionId
                );

              const confirmed =
                window.confirm(
                  `「${session?.eventName || "イベント"}」をアーカイブから復元しますか？`
                );

              if (
                !confirmed
              ) {
                return;
              }

              button.disabled =
                true;

              button.textContent =
                "復元中";

              try {
                await restoreArchivedEventSession(
                  sessionId
                );

                await renderSessions(
                  ++renderSequence
                );

              } catch (error) {
                button.disabled =
                  false;

                button.textContent =
                  "復元";

                window.alert(
                  error.code ||
                  error.message ||
                  String(error)
                );
              }
            }
          );
        }
      );


    document
      .querySelectorAll(
        ".sessionInventoryCountButton"
      )
      .forEach(
        button => {
          button.addEventListener(
            "click",
            () => {
              sessionInventoryCountId =
                button.dataset.sessionId ||
                "";

              sessionDetailId =
                "";

              renderSessions(
                ++renderSequence
              );

              setTimeout(
                () => {
                  document
                    .querySelector(
                      "#sessionInventoryCountPanel"
                    )
                    ?.scrollIntoView({
                      behavior:
                        "smooth",
                      block:
                        "start"
                    });
                },
                100
              );
            }
          );
        }
      );


    document
      .querySelector(
        "#closeInventoryCountButton"
      )
      ?.addEventListener(
        "click",
        () => {
          sessionInventoryCountId =
            "";

          sessionOpeningEditId =
            "";

          renderSessions(
            ++renderSequence
          );
        }
      );


    function readEventCarryRowsFromDom() {
      return Array.from(
        document.querySelectorAll(
          ".eventCarryRow"
        )
      )
        .map(
          row => {
            const input =
              row.querySelector(
                ".eventCarryQtyInput"
              );

            const currentQty =
              Math.max(
                0,
                Math.floor(
                  Number(
                    row.dataset.currentQty ||
                    0
                  )
                )
              );

            const requestedQty =
              Math.max(
                0,
                Math.floor(
                  Number(
                    input?.value ||
                    0
                  )
                )
              );

            if (
              requestedQty >
              currentQty
            ) {
              throw new Error(
                `${row.dataset.label || "商品"} の持参数が実在庫 ${currentQty} を超えています。`
              );
            }

            return {
              variantId:
                row.dataset.variantId ||
                "",

              category:
                row.dataset.category ||
                "",

              inventorySource:
                row.dataset.inventorySource ||
                "",

              inventoryKey:
                row.dataset.inventoryKey ||
                "",

              sku:
                row.dataset.sku ||
                "",

              label:
                row.dataset.label ||
                "",

              detail:
                row.dataset.detail ||
                "",

              openingQty:
                requestedQty
            };
          }
        )
        .filter(
          item =>
            item.variantId &&
            item.openingQty > 0
        );
    }


    function updateEventCarrySummary() {
      let totalQty = 0;
      let skuCount = 0;

      document
        .querySelectorAll(
          ".eventCarryQtyInput"
        )
        .forEach(
          input => {
            const value =
              Math.max(
                0,
                Math.floor(
                  Number(
                    input.value ||
                    0
                  )
                )
              );

            if (
              value > 0
            ) {
              skuCount += 1;
              totalQty +=
                value;
            }
          }
        );

      const qtyTarget =
        document.querySelector(
          "#eventCarrySelectedQty"
        );

      const skuTarget =
        document.querySelector(
          "#eventCarrySelectedSku"
        );

      if (qtyTarget) {
        qtyTarget.textContent =
          String(totalQty);
      }

      if (skuTarget) {
        skuTarget.textContent =
          String(skuCount);
      }
    }


    async function captureOpeningInventory(
      overwrite
    ) {
      if (
        !selectedInventoryCountSession
      ) {
        return;
      }

      const button =
        document.querySelector(
          "#captureOpeningInventoryButton"
        );

      const message =
        document.querySelector(
          "#inventoryCountMessage"
        );

      if (
        overwrite
      ) {
        const confirmed =
          window.confirm(
            "開始在庫の変更を保存しますか？\n\n保存済みの終了在庫カウントはクリアされます。会社全体の実在庫は変更しません。"
          );

        if (!confirmed) {
          return;
        }
      }

      if (
        button
      ) {
        button.disabled =
          true;

        button.textContent =
          "保存中";
      }

      if (
        message
      ) {
        message.textContent =
          "";
      }

      try {
        await saveEventOpeningInventory({
          sessionId:
            selectedInventoryCountSession
              .sessionId,

          items:
            readEventCarryRowsFromDom(),

          capturedByEmail:
            currentUser?.email ||
            "",

          overwrite
        });

        sessionOpeningEditId =
          "";

        await renderSessions(
          ++renderSequence
        );

        setTimeout(
          () => {
            document
              .querySelector(
                "#sessionInventoryCountPanel"
              )
              ?.scrollIntoView({
                behavior:
                  "smooth",
                block:
                  "start"
              });
          },
          100
        );

      } catch (error) {
        if (
          button
        ) {
          button.disabled =
            false;

          button.textContent =
            overwrite
              ? "開始在庫の変更を保存"
              : "入力した持参数を開始在庫として保存";
        }

        if (
          message
        ) {
          message.textContent =
            error.code ||
            error.message ||
            String(error);
        }
      }
    }


    document
      .querySelectorAll(
        ".eventCarryQtyInput"
      )
      .forEach(
        input => {
          input.addEventListener(
            "input",
            event => {
              const max =
                Math.max(
                  0,
                  Math.floor(
                    Number(
                      event.target.max ||
                      0
                    )
                  )
                );

              const value =
                Math.max(
                  0,
                  Math.floor(
                    Number(
                      event.target.value ||
                      0
                    )
                  )
                );

              if (
                value > max
              ) {
                event.target.value =
                  String(max);
              }

              updateEventCarrySummary();
              applyEventCarryFilters();
            }
          );
        }
      );


    document
      .querySelectorAll(
        ".eventCarryColorAllStockButton"
      )
      .forEach(
        button => {
          button.addEventListener(
            "click",
            () => {
              const matrixRow =
                button.closest(
                  ".eventCarryMatrixRow"
                );

              if (!matrixRow) {
                return;
              }

              matrixRow
                .querySelectorAll(
                  ".eventCarryRow"
                )
                .forEach(
                  cell => {
                    const input =
                      cell.querySelector(
                        ".eventCarryQtyInput"
                      );

                    if (
                      !input ||
                      input.disabled
                    ) {
                      return;
                    }

                    input.value =
                      cell.dataset.currentQty ||
                      "0";
                  }
                );

              updateEventCarrySummary();
              applyEventCarryFilters();
            }
          );
        }
      );


    document
      .querySelectorAll(
        ".eventCarryDesignAllStockButton"
      )
      .forEach(
        button => {
          button.addEventListener(
            "click",
            () => {
              const designKey =
                button.dataset.designKey ||
                "";

              if (!designKey) {
                return;
              }

              document
                .querySelectorAll(
                  ".eventCarryMatrixRow"
                )
                .forEach(
                  matrixRow => {
                    if (
                      matrixRow.dataset
                        .designKey !==
                      designKey
                    ) {
                      return;
                    }

                    matrixRow
                      .querySelectorAll(
                        ".eventCarryRow"
                      )
                      .forEach(
                        cell => {
                          const input =
                            cell.querySelector(
                              ".eventCarryQtyInput"
                            );

                          if (
                            !input ||
                            input.disabled
                          ) {
                            return;
                          }

                          input.value =
                            cell.dataset.currentQty ||
                            "0";
                        }
                      );
                  }
                );

              updateEventCarrySummary();
              applyEventCarryFilters();
            }
          );
        }
      );


    document
      .querySelector(
        "#copyAllStockToCarryButton"
      )
      ?.addEventListener(
        "click",
        () => {
          document
            .querySelectorAll(
              ".eventCarryRow"
            )
            .forEach(
              row => {
                const input =
                  row.querySelector(
                    ".eventCarryQtyInput"
                  );

                if (
                  input &&
                  !input.disabled
                ) {
                  input.value =
                    row.dataset.currentQty ||
                    "0";
                }
              }
            );

          updateEventCarrySummary();
          applyEventCarryFilters();
        }
      );


    document
      .querySelector(
        "#clearAllCarryButton"
      )
      ?.addEventListener(
        "click",
        () => {
          document
            .querySelectorAll(
              ".eventCarryQtyInput"
            )
            .forEach(
              input => {
                input.value =
                  "";
              }
            );

          updateEventCarrySummary();
          applyEventCarryFilters();
        }
      );


    function visibleCarryRows() {
      return Array.from(
        document.querySelectorAll(
          ".eventCarryRow"
        )
      )
        .filter(
          row => {
            const matrixParent =
              row.closest(
                ".eventCarryMatrixRow"
              );

            if (
              matrixParent
            ) {
              return (
                matrixParent.style
                  .display !==
                "none"
              );
            }

            return (
              row.style.display !==
              "none"
            );
          }
        );
    }


    document
      .querySelector(
        "#copyVisibleStockToCarryButton"
      )
      ?.addEventListener(
        "click",
        () => {
          visibleCarryRows()
            .forEach(
              row => {
                const input =
                  row.querySelector(
                    ".eventCarryQtyInput"
                  );

                if (
                  input &&
                  !input.disabled
                ) {
                  input.value =
                    row.dataset.currentQty ||
                    "0";
                }
              }
            );

          updateEventCarrySummary();
          applyEventCarryFilters();
        }
      );


    document
      .querySelector(
        "#clearVisibleCarryButton"
      )
      ?.addEventListener(
        "click",
        () => {
          visibleCarryRows()
            .forEach(
              row => {
                const input =
                  row.querySelector(
                    ".eventCarryQtyInput"
                  );

                if (input) {
                  input.value =
                    "";
                }
              }
            );

          updateEventCarrySummary();
          applyEventCarryFilters();
        }
      );


    let eventCarryCategoryFilterValue =
      "all";

    function applyEventCarryFilters() {
      const query =
        String(
          document
            .querySelector(
              "#eventCarrySearch"
            )
            ?.value ||
          ""
        )
          .trim()
          .toLocaleLowerCase();

      const onlySelected =
        Boolean(
          document
            .querySelector(
              "#eventCarryOnlySelected"
            )
            ?.checked
        );

      document
        .querySelectorAll(
          ".eventCarryAccessoryRow"
        )
        .forEach(
          row => {
            const categoryMatch =
              eventCarryCategoryFilterValue ===
                "all" ||
              row.dataset
                .categoryGroup ===
                eventCarryCategoryFilterValue;

            const searchMatch =
              !query ||
              String(
                row.dataset.search ||
                ""
              )
                .toLocaleLowerCase()
                .includes(
                  query
                );

            const selectedMatch =
              !onlySelected ||
              Number(
                row.querySelector(
                  ".eventCarryQtyInput"
                )?.value ||
                0
              ) > 0;

            row.style.display =
              categoryMatch &&
              searchMatch &&
              selectedMatch
                ? ""
                : "none";
          }
        );

      document
        .querySelectorAll(
          ".eventCarryMatrixRow"
        )
        .forEach(
          row => {
            const categoryMatch =
              eventCarryCategoryFilterValue ===
                "all" ||
              eventCarryCategoryFilterValue ===
                "tshirt";

            const groupSearch =
              String(
                row.dataset.search ||
                ""
              )
                .toLocaleLowerCase();

            const cellSearchMatch =
              Array.from(
                row.querySelectorAll(
                  ".eventCarryRow"
                )
              ).some(
                cell =>
                  String(
                    cell.dataset.search ||
                    ""
                  )
                    .toLocaleLowerCase()
                    .includes(
                      query
                    )
              );

            const searchMatch =
              !query ||
              groupSearch.includes(
                query
              ) ||
              cellSearchMatch;

            const selectedMatch =
              !onlySelected ||
              Array.from(
                row.querySelectorAll(
                  ".eventCarryQtyInput"
                )
              ).some(
                input =>
                  Number(
                    input.value ||
                    0
                  ) > 0
              );

            row.style.display =
              categoryMatch &&
              searchMatch &&
              selectedMatch
                ? "grid"
                : "none";
          }
        );

      const tshirtVisible =
        Array.from(
          document
            .querySelectorAll(
              ".eventCarryMatrixRow"
            )
        ).some(
          row =>
            row.style.display !==
            "none"
        );

      const accessoryVisible =
        Array.from(
          document
            .querySelectorAll(
              ".eventCarryAccessoryRow"
            )
        ).some(
          row =>
            row.style.display !==
            "none"
        );

      const tshirtSection =
        document.querySelector(
          ".eventCarryTshirtSection"
        );

      const accessorySection =
        document.querySelector(
          ".eventCarryAccessorySection"
        );

      if (tshirtSection) {
        tshirtSection.style.display =
          tshirtVisible
            ? ""
            : "none";
      }

      if (accessorySection) {
        accessorySection.style.display =
          accessoryVisible
            ? ""
            : "none";
      }

      document
        .querySelectorAll(
          ".eventCarryCategoryFilter"
        )
        .forEach(
          button => {
            const active =
              button.dataset
                .categoryFilter ===
              eventCarryCategoryFilterValue;

            button.style.background =
              active
                ? "#1f1f1f"
                : "#fff";

            button.style.color =
              active
                ? "#fff"
                : "#1f1f1f";
          }
        );
    }


    document
      .querySelectorAll(
        ".eventCarryCategoryFilter"
      )
      .forEach(
        button => {
          button.addEventListener(
            "click",
            () => {
              eventCarryCategoryFilterValue =
                button.dataset
                  .categoryFilter ||
                "all";

              applyEventCarryFilters();
            }
          );
        }
      );


    document
      .querySelector(
        "#eventCarrySearch"
      )
      ?.addEventListener(
        "input",
        () => {
          applyEventCarryFilters();
        }
      );


    document
      .querySelector(
        "#eventCarryOnlySelected"
      )
      ?.addEventListener(
        "change",
        () => {
          applyEventCarryFilters();
        }
      );


    document
      .querySelector(
        "#captureOpeningInventoryButton"
      )
      ?.addEventListener(
        "click",
        event =>
          captureOpeningInventory(
            event.currentTarget
              ?.dataset
              ?.overwrite ===
            "true"
          )
      );


    document
      .querySelector(
        "#editOpeningInventoryButton"
      )
      ?.addEventListener(
        "click",
        () => {
          if (
            !selectedInventoryCountSession ||
            openingInventoryLocked
          ) {
            return;
          }

          sessionOpeningEditId =
            selectedInventoryCountSession
              .sessionId;

          renderSessions(
            ++renderSequence
          );

          setTimeout(
            () => {
              document
                .querySelector(
                  "#sessionInventoryCountPanel"
                )
                ?.scrollIntoView({
                  behavior:
                    "smooth",
                  block:
                    "start"
                });
            },
            100
          );
        }
      );


    document
      .querySelector(
        "#cancelOpeningInventoryEditButton"
      )
      ?.addEventListener(
        "click",
        () => {
          sessionOpeningEditId =
            "";

          renderSessions(
            ++renderSequence
          );
        }
      );


    document
      .querySelector(
        "#resetOpeningInventoryButton"
      )
      ?.addEventListener(
        "click",
        async event => {
          if (
            !selectedInventoryCountSession ||
            openingInventoryLocked
          ) {
            return;
          }

          const confirmed =
            window.confirm(
              "開始在庫をリセットしますか？\n\n開始在庫と保存済み終了在庫をクリアします。売上や会社全体の実在庫は変更しません。"
            );

          if (
            !confirmed
          ) {
            return;
          }

          const button =
            event.currentTarget;

          button.disabled =
            true;

          button.textContent =
            "リセット中";

          try {
            await resetEventOpeningInventory({
              sessionId:
                selectedInventoryCountSession
                  .sessionId,

              resetByEmail:
                currentUser
                  ?.email ||
                ""
            });

            sessionOpeningEditId =
              "";

            await renderSessions(
              ++renderSequence
            );

          } catch (error) {
            button.disabled =
              false;

            button.textContent =
              "開始在庫をリセット";

            window.alert(
              error.code ||
              error.message ||
              String(error)
            );
          }
        }
      );


    function updateClosingDifference(
      row
    ) {
      const input =
        row.querySelector(
          ".inventoryClosingQty"
        );

      const differenceBox =
        row.querySelector(
          ".inventoryClosingDifference"
        );

      if (
        !input ||
        !differenceBox
      ) {
        return;
      }

      if (
        input.value ===
        ""
      ) {
        differenceBox.textContent =
          "";

        return;
      }

      const calculatedQty =
        Number(
          row.dataset
            .calculatedQty ||
          0
        );

      const actualQty =
        Math.max(
          0,
          Number(
            input.value ||
            0
          )
        );

      const difference =
        calculatedQty -
        actualQty;

      if (
        difference ===
        0
      ) {
        differenceBox.textContent =
          "計算残数と一致";

        return;
      }

      differenceBox.textContent =
        difference > 0
          ? `差異：${difference} 点不足`
          : `差異：${Math.abs(
              difference
            )} 点超過`;
    }


    document
      .querySelector(
        "#copyCalculatedStockToClosingButton"
      )
      ?.addEventListener(
        "click",
        () => {
          document
            .querySelectorAll(
              ".inventoryCountRow"
            )
            .forEach(
              row => {
                const input =
                  row.querySelector(
                    ".inventoryClosingQty"
                  );

                if (
                  input
                ) {
                  input.value =
                    row.dataset
                      .calculatedQty ||
                    "0";

                  updateClosingDifference(
                    row
                  );
                }
              }
            );
        }
      );


    document
      .querySelectorAll(
        ".inventoryClosingQty"
      )
      .forEach(
        input => {
          input.addEventListener(
            "input",
            () => {
              const row =
                input.closest(
                  ".inventoryCountRow"
                );

              if (
                row
              ) {
                updateClosingDifference(
                  row
                );
              }
            }
          );

          const row =
            input.closest(
              ".inventoryCountRow"
            );

          if (
            row
          ) {
            updateClosingDifference(
              row
            );
          }
        }
      );


    document
      .querySelector(
        "#clearClosingCountButton"
      )
      ?.addEventListener(
        "click",
        () => {
          document
            .querySelectorAll(
              ".inventoryClosingQty"
            )
            .forEach(
              input => {
                input.value =
                  "";
              }
            );

          document
            .querySelectorAll(
              ".inventoryClosingDifference"
            )
            .forEach(
              box => {
                box.textContent =
                  "";
              }
            );
        }
      );


    document
      .querySelector(
        "#inventoryCountSearch"
      )
      ?.addEventListener(
        "input",
        event => {
          const query =
            String(
              event.target.value ||
              ""
            )
              .trim()
              .toLocaleLowerCase();

          document
            .querySelectorAll(
              ".inventoryCountRow"
            )
            .forEach(
              row => {
                const haystack =
                  String(
                    row.dataset.search ||
                    ""
                  ).toLocaleLowerCase();

                row.style.display =
                  !query ||
                  haystack.includes(
                    query
                  )
                    ? ""
                    : "none";
              }
            );
        }
      );


    document
      .querySelector(
        "#finalizeEventSessionButton"
      )
      ?.addEventListener(
        "click",
        async event => {
          if (
            !selectedInventoryCountSession
          ) {
            return;
          }

          const sessionId =
            selectedInventoryCountSession
              .sessionId;

          const button =
            event.currentTarget;

          const message =
            document.querySelector(
              "#eventFinalizeMessage"
            );

          const confirmed =
            window.confirm(
              `「${selectedInventoryCountSession.eventName}」を終了しますか？\n\n終了後はこのイベントでPOS販売できません。\n紛失・盗難・破損・プレゼント・サンプル・在庫調整がある場合は、正式実在庫へ一度だけ反映します。`
            );

          if (
            !confirmed
          ) {
            return;
          }

          button.disabled =
            true;

          button.textContent =
            "終了処理中";

          if (message) {
            message.textContent =
              "";
          }

          try {
            const result =
              await finalizeEventSession({
                sessionId,

                closedByEmail:
                  currentUser
                    ?.email ||
                  ""
              });

            if (
              activeSessionId ===
              sessionId
            ) {
              activeSessionId =
                "";

              localStorage.removeItem(
                "icelolly-sales-active-session"
              );
            }

            sessionInventoryCountId =
              "";

            sessionOpeningEditId =
              "";

            editingSessionId =
              "";

            await renderSessions(
              ++renderSequence
            );

            window.alert(
              result?.duplicate
                ? "このイベントはすでに終了済みです。"
                : `イベントを終了しました。終了在庫 ${result?.closingTotal ?? "-"} 点、正式在庫への調整 ${result?.movementCount ?? 0} 件です。`
            );

          } catch (error) {
            button.disabled =
              false;

            button.textContent =
              "イベントを終了して在庫を確定";

            if (message) {
              message.textContent =
                error.code ||
                error.message ||
                String(error);
            }
          }
        }
      );


    document
      .querySelector(
        "#saveClosingInventoryButton"
      )
      ?.addEventListener(
        "click",
        async event => {
          if (
            !selectedInventoryCountSession
          ) {
            return;
          }

          const button =
            event.currentTarget;

          const message =
            document.querySelector(
              "#inventoryCountMessage"
            );

          const openingItems =
            inventoryCountData
              ?.opening
              ?.items ||
            [];

          const rows =
            openingItems.map(
              opening => {
                const closingInput =
                  document.querySelector(
                    `.inventoryClosingQty[data-variant-id="${CSS.escape(
                      opening.variantId
                    )}"]`
                  );

                const reasonValue =
                  key => {
                    const input =
                      document.querySelector(
                        `.inventoryReasonInput[data-variant-id="${CSS.escape(
                          opening.variantId
                        )}"][data-reason="${key}"]`
                      );

                    return Number(
                      input?.value ||
                      0
                    );
                  };

                return {
                  variantId:
                    opening.variantId,

                  closingQty:
                    closingInput &&
                    closingInput.value !==
                      ""
                      ? Number(
                          closingInput.value
                        )
                      : null,

                  loss:
                    reasonValue(
                      "loss"
                    ),

                  theft:
                    reasonValue(
                      "theft"
                    ),

                  damage:
                    reasonValue(
                      "damage"
                    ),

                  gift:
                    reasonValue(
                      "gift"
                    ),

                  sample:
                    reasonValue(
                      "sample"
                    ),

                  stockAdjustment:
                    reasonValue(
                      "stockAdjustment"
                    )
                };
              }
            );

          button.disabled =
            true;

          button.textContent =
            "保存中";

          if (
            message
          ) {
            message.textContent =
              "";
          }

          try {
            await saveEventClosingInventory({
              sessionId:
                selectedInventoryCountSession
                  .sessionId,

              items:
                rows,

              savedByEmail:
                currentUser?.email ||
                ""
            });

            await renderSessions(
              ++renderSequence
            );

            setTimeout(
              () => {
                document
                  .querySelector(
                    "#sessionInventoryCountPanel"
                  )
                  ?.scrollIntoView({
                    behavior:
                      "smooth",
                    block:
                      "start"
                  });
              },
              100
            );

          } catch (error) {
            button.disabled =
              false;

            button.textContent =
              "終了在庫・理由を保存";

            if (
              message
            ) {
              message.textContent =
                error.code ||
                error.message ||
                String(error);
            }
          }
        }
      );


    document
      .querySelectorAll(
        ".sessionDetailButton"
      )
      .forEach(
        button => {
          button.addEventListener(
            "click",
            () => {
              sessionDetailId =
                button.dataset.sessionId ||
                "";

              sessionInventoryCountId =
                "";

              renderSessions(
                ++renderSequence
              );

              setTimeout(
                () => {
                  document
                    .querySelector(
                      "#sessionSalesDetail"
                    )
                    ?.scrollIntoView({
                      behavior:
                        "smooth",
                      block:
                        "start"
                    });
                },
                100
              );
            }
          );
        }
      );


    document
      .querySelector(
        "#saveEventExpensesButton"
      )
      ?.addEventListener(
        "click",
        async event => {
          if (!selectedDetailSession) {
            return;
          }

          const button =
            event.currentTarget;

          const messageBox =
            document.querySelector(
              "#saveEventExpensesMessage"
            );

          button.disabled =
            true;

          button.textContent =
            "保存中";

          if (messageBox) {
            messageBox.textContent =
              "";
          }

          const expenseInput = {};

          EVENT_EXPENSE_ORDER.forEach(
            key => {
              const amountInput =
                document.querySelector(
                  `.eventExpenseAmount[data-expense-key="${key}"]`
                );

              const currencyInput =
                document.querySelector(
                  `.eventExpenseCurrency[data-expense-key="${key}"]`
                );

              expenseInput[key] = {
                amount:
                  Number(
                    amountInput
                      ?.value || 0
                  ),
                currency:
                  currencyInput
                    ?.value || "JPY"
              };
            }
          );

          try {
            await updateEventExpenses(
              selectedDetailSession.sessionId,
              expenseInput
            );

            button.textContent =
              "保存済み";

            setTimeout(
              () => {
                renderSessions(
                  ++renderSequence
                );
              },
              400
            );

          } catch (error) {
            button.disabled =
              false;

            button.textContent =
              "経費を保存";

            if (messageBox) {
              messageBox.textContent =
                error.code ||
                error.message ||
                String(error);
            }
          }
        }
      );


    document
      .querySelectorAll(
        ".voidSaleTransactionButton"
      )
      .forEach(
        button => {
          button.addEventListener(
            "click",
            async () => {
              const transactionId =
                button.dataset.transactionId ||
                "";

              if (!transactionId) {
                return;
              }

              const confirmed =
                window.confirm(
                  "この会計を取り消しますか？\n\n売上集計から除外し、SKU販売で減算済みの実在庫は元に戻します。\n元の会計記録は削除せず、取消済みとして残します。"
                );

              if (!confirmed) {
                return;
              }

              button.disabled =
                true;

              button.textContent =
                "取消処理中";

              try {
                await voidSaleTransaction({
                  transactionId,
                  voidedByEmail:
                    currentUser
                      ?.email ||
                    "",
                  reason:
                    "manual_void"
                });

                await renderSessions(
                  ++renderSequence
                );

                setTimeout(
                  () => {
                    document
                      .querySelector(
                        "#sessionSalesDetail"
                      )
                      ?.scrollIntoView({
                        behavior:
                          "smooth",
                        block:
                          "start"
                      });
                  },
                  100
                );

              } catch (error) {
                console.error(
                  "Sale void failed",
                  error
                );

                button.disabled =
                  false;

                button.textContent =
                  "この会計を取消";

                window.alert(
                  error.code ||
                  error.message ||
                  String(error)
                );
              }
            }
          );
        }
      );


    document
      .querySelector(
        "#closeSessionDetailButton"
      )
      ?.addEventListener(
        "click",
        () => {
          sessionDetailId =
            "";

          renderSessions(
            ++renderSequence
          );
        }
      );


    document
      .querySelectorAll(
        ".sessionEditButton"
      )
      .forEach(
        button => {
          button.addEventListener(
            "click",
            () => {
              editingSessionId =
                button.dataset.sessionId ||
                "";

              renderSessions(
                ++renderSequence
              );

              setTimeout(
                () => {
                  document
                    .querySelector(
                      "#sessionEditCard"
                    )
                    ?.scrollIntoView({
                      behavior:
                        "smooth",
                      block:
                        "start"
                    });
                },
                100
              );
            }
          );
        }
      );


    document
      .querySelector(
        "#cancelSessionEditButton"
      )
      ?.addEventListener(
        "click",
        () => {
          editingSessionId =
            "";

          renderSessions(
            ++renderSequence
          );
        }
      );


    const editCurrencySelect =
      document.querySelector(
        "#editSessionCurrency"
      );

    const editRateInput =
      document.querySelector(
        "#editSessionFxRate"
      );


    function refreshEditRateField() {
      if (
        !editCurrencySelect ||
        !editRateInput
      ) {
        return;
      }

      if (
        editCurrencySelect.value ===
        "JPY"
      ) {
        editRateInput.value =
          "1";

        editRateInput.disabled =
          true;
      } else {
        editRateInput.disabled =
          false;

        if (
          editRateInput.value ===
          "1"
        ) {
          editRateInput.value =
            "";
        }
      }
    }


    refreshEditRateField();


    editCurrencySelect
      ?.addEventListener(
        "change",
        refreshEditRateField
      );


    document
      .querySelector(
        "#saveSessionEditButton"
      )
      ?.addEventListener(
        "click",
        async event => {
          const button =
            event.currentTarget;

          const messageBox =
            document.querySelector(
              "#saveSessionEditMessage"
            );

          const before =
            openSessions.find(
              session =>
                session.sessionId ===
                editingSessionId
            );

          button.disabled =
            true;

          button.textContent =
            "保存中";

          if (messageBox) {
            messageBox.textContent =
              "";
          }

          try {
            const updated =
              await updateEventSession(
                editingSessionId,
                {
                  eventName:
                    document
                      .querySelector(
                        "#editSessionEventName"
                      )
                      ?.value,

                  country:
                    document
                      .querySelector(
                        "#editSessionCountry"
                      )
                      ?.value,

                  city:
                    document
                      .querySelector(
                        "#editSessionCity"
                      )
                      ?.value,

                  startDate:
                    document
                      .querySelector(
                        "#editSessionStartDate"
                      )
                      ?.value,

                  endDate:
                    document
                      .querySelector(
                        "#editSessionEndDate"
                      )
                      ?.value,

                  currency:
                    editCurrencySelect
                      ?.value ||
                    "JPY",

                  fxRateToJPY:
                    editRateInput
                      ?.value ||
                    null
                }
              );

            if (
              updated.sessionId ===
              activeSessionId
            ) {
              if (
                before &&
                before.currency !==
                updated.currency
              ) {
                posCart =
                  new Map();

                posOrderDiscount =
                  0;

                invalidatePendingCheckout();

                lastCheckoutResult =
                  null;
              }

              posCurrency =
                updated.currency;

              localStorage.setItem(
                "icelolly-sales-pos-currency",
                posCurrency
              );
            }

            editingSessionId =
              "";

            await renderSessions(
              ++renderSequence
            );

          } catch (error) {
            button.disabled =
              false;

            button.textContent =
              "変更を保存";

            if (messageBox) {
              messageBox.textContent =
                error.code ||
                error.message ||
                String(error);
            }
          }
        }
      );


    syncStatus.textContent =
      "Firebase";


  } catch (error) {
    console.error(
      error
    );

    view.innerHTML = `
      <h1 class="page-title">
        Sessions
      </h1>

      <div class="warning">
        ${escapeHtml(
          error.code ||
          error.message ||
          error
        )}
      </div>
    `;
  }
}

function createPendingCheckoutId() {
  if (
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID ===
      "function"
  ) {
    return (
      "sale_" +
      globalThis.crypto.randomUUID()
    );
  }

  return [
    "sale",
    Date.now(),
    Math.random()
      .toString(36)
      .slice(2, 12)
  ].join("_");
}

function invalidatePendingCheckout() {
  pendingCheckoutTransactionId =
    null;
}

function formatMoney(
  value,
  currency = posCurrency
) {
  const amount =
    Number(value || 0);

  try {
    return new Intl.NumberFormat(
      currency === "JPY"
        ? "ja-JP"
        : "en-US",
      {
        style:
          "currency",
        currency,
        maximumFractionDigits:
          currency === "JPY"
            ? 0
            : 2
      }
    ).format(amount);
  } catch (error) {
    return `${currency} ${amount}`;
  }
}

function posPrice(
  category
) {
  return Number(
    posPriceBook
      ?.[category]
      ?.[posCurrency] || 0
  );
}


function posTshirtBodyPrice(
  bodyId
) {
  return Number(
    posTshirtBodyPriceBook
      ?.[bodyId]
      ?.[posCurrency] ||
    0
  );
}

function posTshirtBodySetOfferRows(
  bodyId
) {
  const raw =
    posTshirtBodySetOfferBook
      ?.[bodyId]
      ?.[posCurrency];

  const source =
    Array.isArray(raw)
      ? raw
      : (
          raw &&
          typeof raw === "object"
        )
        ? [raw]
        : [];

  return source.map(
    offer => ({
      quantity:
        Math.max(
          0,
          Math.floor(
            Number(
              offer?.quantity ||
              0
            )
          )
        ),

      price:
        Math.max(
          0,
          Number(
            offer?.price ||
            0
          )
        )
    })
  );
}

function posTshirtMixMatchDiscountRows() {
  const raw =
    posTshirtMixMatchDiscountBook
      ?.[posCurrency];

  const source =
    Array.isArray(raw)
      ? raw
      : (
          raw &&
          typeof raw === "object"
        )
        ? [raw]
        : [];

  return source.map(
    offer => ({
      quantity:
        Math.max(
          0,
          Math.floor(
            Number(
              offer?.quantity ||
              0
            )
          )
        ),

      discount:
        Math.max(
          0,
          Number(
            offer?.discount ||
            0
          )
        )
    })
  );
}

function posTshirtMixMatchDiscounts() {
  return posTshirtMixMatchDiscountRows()
    .filter(
      offer =>
        offer.quantity >= 2 &&
        offer.discount > 0
    )
    .sort(
      (a, b) =>
        a.quantity -
        b.quantity ||
        a.discount -
        b.discount
    );
}

function posPromotionGroup(
  category
) {
  if (
    category === "sticker" ||
    category === "postcard"
  ) {
    return "sticker_postcard";
  }

  if (
    category === "pierce" ||
    category === "earring"
  ) {
    return "earrings";
  }

  if (
    category === "drop_pierce" ||
    category === "drop_earring"
  ) {
    return "drop_earrings";
  }

  if (
    category === "art_print"
  ) {
    return "art_print";
  }

  return category;
}

function posCanonicalSetCategory(
  promotionGroup
) {
  if (
    promotionGroup ===
    "sticker_postcard"
  ) {
    return "sticker";
  }

  if (
    promotionGroup ===
    "earrings"
  ) {
    return "earring";
  }

  if (
    promotionGroup ===
    "drop_earrings"
  ) {
    return "drop_earring";
  }

  return promotionGroup;
}

function posSetOffersForGroup(
  lines
) {
  const promotionGroup =
    posPromotionGroup(
      lines?.[0]?.category
    );

  const canonicalCategory =
    posCanonicalSetCategory(
      promotionGroup
    );

  const canonicalOffers =
    posSetOffers(
      canonicalCategory
    );

  if (
    canonicalOffers.length
  ) {
    return canonicalOffers;
  }

  for (
    const line of (
      Array.isArray(lines)
        ? lines
        : []
    )
  ) {
    const offers =
      posSetOffersForCartLine(
        line
      );

    if (
      offers.length
    ) {
      return offers;
    }
  }

  return [];
}


function posTshirtBodySetOffers(
  bodyId
) {
  return posTshirtBodySetOfferRows(
    bodyId
  )
    .filter(
      offer =>
        offer.quantity >= 2 &&
        offer.price > 0
    )
    .sort(
      (a, b) =>
        a.quantity -
        b.quantity ||
        a.price -
        b.price
    );
}

function posSetOffersForCartLine(
  line
) {
  const bodyId =
    line?.item
      ?.tshirtBodyKey ||
    "";

  if (
    line?.category ===
      "tshirt" &&
    bodyId
  ) {
    return posTshirtBodySetOffers(
      bodyId
    );
  }

  return posSetOffers(
    line?.category
  );
}

function quickPosItems() {
  const items = [];

  POS_CATEGORY_ORDER.forEach(
    category => {
      if (
        category !==
        "tshirt"
      ) {
        items.push({
          key:
            category,
          category,
          bodyId:
            "",
          label:
            POS_CATEGORY_LABELS[
              category
            ]
        });

        return;
      }

      TSHIRT_PRICE_BODY_ORDER
        .forEach(
          body => {
            items.push({
              key:
                `tshirt:${body.id}`,
              category:
                "tshirt",
              bodyId:
                body.id,
              label:
                body.label
            });
          }
        );
    }
  );

  return items;
}

function quickPosItemPrice(
  item
) {
  if (
    item?.category ===
      "tshirt"
  ) {
    return posTshirtBodyPrice(
      item.bodyId
    );
  }

  return posPrice(
    item?.category
  );
}

function quickPosItemSetOffers(
  item
) {
  if (
    item?.category ===
      "tshirt"
  ) {
    return posTshirtBodySetOffers(
      item.bodyId
    );
  }

  return posSetOffers(
    item?.category
  );
}

function posSetOfferRows(
  category
) {
  const raw =
    posSetOfferBook
      ?.[category]
      ?.[posCurrency];

  const source =
    Array.isArray(raw)
      ? raw
      : (
          raw &&
          typeof raw === "object"
        )
        ? [raw]
        : [];

  return source.map(
    offer => ({
      quantity:
        Math.max(
          0,
          Math.floor(
            Number(
              offer?.quantity || 0
            )
          )
        ),

      price:
        Math.max(
          0,
          Number(
            offer?.price || 0
          )
        )
    })
  );
}

function posSetOffers(
  category
) {
  return posSetOfferRows(
    category
  )
    .filter(
      offer =>
        offer.quantity >= 2 &&
        offer.price > 0
    )
    .sort(
      (a, b) =>
        a.quantity -
        b.quantity ||
        a.price -
        b.price
    );
}

/*
 * Compatibility helper.
 * Existing transaction payload can still carry one representative
 * set offer. The actual set discount is calculated per line.
 */
function posSetOffer(
  category
) {
  return (
    posSetOffers(
      category
    )[0] ||
    {
      quantity: 0,
      price: 0
    }
  );
}

function optimalSetPlan(
  quantity,
  unitPrice,
  offers
) {
  const totalQuantity =
    Math.max(
      0,
      Math.floor(
        Number(
          quantity || 0
        )
      )
    );

  const singlePrice =
    Math.max(
      0,
      Number(
        unitPrice || 0
      )
    );

  if (
    totalQuantity <= 0 ||
    singlePrice <= 0
  ) {
    return {
      total:
        totalQuantity *
        singlePrice,
      applications: []
    };
  }

  const validOffers =
    (Array.isArray(offers)
      ? offers
      : []
    )
      .filter(
        offer =>
          offer.quantity >= 2 &&
          offer.price > 0 &&
          offer.price <
            (
              offer.quantity *
              singlePrice
            )
      );

  const dp =
    Array(
      totalQuantity + 1
    ).fill(null);

  dp[0] = {
    cost: 0,
    previous: null,
    action: null
  };

  for (
    let count = 1;
    count <= totalQuantity;
    count += 1
  ) {
    let best = {
      cost:
        dp[count - 1].cost +
        singlePrice,

      previous:
        count - 1,

      action: {
        type: "single"
      }
    };

    validOffers.forEach(
      offer => {
        if (
          offer.quantity >
          count
        ) {
          return;
        }

        const candidate =
          dp[
            count -
            offer.quantity
          ].cost +
          offer.price;

        if (
          candidate <
          best.cost -
          0.000001
        ) {
          best = {
            cost:
              candidate,

            previous:
              count -
              offer.quantity,

            action: {
              type: "set",
              quantity:
                offer.quantity,
              price:
                offer.price
            }
          };
        }
      }
    );

    dp[count] =
      best;
  }

  const applicationMap =
    new Map();

  let cursor =
    totalQuantity;

  while (
    cursor > 0
  ) {
    const node =
      dp[cursor];

    if (
      !node ||
      node.previous === null
    ) {
      break;
    }

    if (
      node.action
        ?.type ===
      "set"
    ) {
      const key =
        `${node.action.quantity}|${node.action.price}`;

      const current =
        applicationMap.get(
          key
        ) ||
        {
          quantity:
            node.action.quantity,
          price:
            node.action.price,
          count: 0
        };

      current.count += 1;

      applicationMap.set(
        key,
        current
      );
    }

    cursor =
      node.previous;
  }

  return {
    total:
      dp[totalQuantity].cost,

    applications:
      Array.from(
        applicationMap.values()
      )
  };
}

function optimalFixedDiscountPlan(
  quantity,
  rules
) {
  const totalQuantity =
    Math.max(
      0,
      Math.floor(
        Number(
          quantity || 0
        )
      )
    );

  const validRules =
    (
      Array.isArray(rules)
        ? rules
        : []
    )
      .filter(
        rule =>
          rule.quantity >= 2 &&
          rule.discount > 0
      );

  const dp =
    Array(
      totalQuantity + 1
    ).fill(null);

  dp[0] = {
    discount: 0,
    previous: null,
    action: null
  };

  for (
    let count = 1;
    count <= totalQuantity;
    count += 1
  ) {
    let best = {
      discount:
        dp[count - 1].discount,

      previous:
        count - 1,

      action: {
        type: "single"
      }
    };

    validRules.forEach(
      rule => {
        if (
          rule.quantity >
          count
        ) {
          return;
        }

        const candidate =
          dp[
            count -
            rule.quantity
          ].discount +
          rule.discount;

        if (
          candidate >
          best.discount +
          0.000001
        ) {
          best = {
            discount:
              candidate,

            previous:
              count -
              rule.quantity,

            action: {
              type: "discount",
              quantity:
                rule.quantity,
              discount:
                rule.discount
            }
          };
        }
      }
    );

    dp[count] =
      best;
  }

  const applicationMap =
    new Map();

  let cursor =
    totalQuantity;

  while (
    cursor > 0
  ) {
    const node =
      dp[cursor];

    if (
      !node ||
      node.previous ===
        null
    ) {
      break;
    }

    if (
      node.action?.type ===
      "discount"
    ) {
      const key =
        `${node.action.quantity}|${node.action.discount}`;

      const current =
        applicationMap.get(
          key
        ) || {
          quantity:
            node.action.quantity,
          discount:
            node.action.discount,
          count: 0
        };

      current.count += 1;

      applicationMap.set(
        key,
        current
      );
    }

    cursor =
      node.previous;
  }

  return {
    discount:
      dp[
        totalQuantity
      ].discount,

    applications:
      Array.from(
        applicationMap.values()
      )
  };
}

function capturePosPriceSettingsFromDom() {
  document
    .querySelectorAll(
      ".posPriceInput"
    )
    .forEach(
      input => {
        const category =
          input.dataset.category;

        if (
          !category
        ) {
          return;
        }

        if (
          !posPriceBook[
            category
          ]
        ) {
          posPriceBook[
            category
          ] = {};
        }

        posPriceBook[
          category
        ][
          posCurrency
        ] =
          Math.max(
            0,
            Number(
              input.value || 0
            )
          );
      }
    );

  POS_CATEGORY_ORDER
    .forEach(
      category => {
        const rows =
          Array.from(
            document.querySelectorAll(
              `.posSetOfferRow[data-category="${category}"]`
            )
          );

        if (
          !posSetOfferBook[
            category
          ]
        ) {
          posSetOfferBook[
            category
          ] = {};
        }

        posSetOfferBook[
          category
        ][
          posCurrency
        ] =
          rows.map(
            row => ({
              quantity:
                Math.max(
                  0,
                  Math.floor(
                    Number(
                      row.querySelector(
                        ".posSetQuantityInput"
                      )?.value || 0
                    )
                  )
                ),

              price:
                Math.max(
                  0,
                  Number(
                    row.querySelector(
                      ".posSetPriceInput"
                    )?.value || 0
                  )
                )
            })
          );
      }
    );


  document
    .querySelectorAll(
      ".posTshirtBodyPriceInput"
    )
    .forEach(
      input => {
        const bodyId =
          input.dataset.bodyId;

        if (!bodyId) {
          return;
        }

        if (
          !posTshirtBodyPriceBook[
            bodyId
          ]
        ) {
          posTshirtBodyPriceBook[
            bodyId
          ] = {};
        }

        posTshirtBodyPriceBook[
          bodyId
        ][
          posCurrency
        ] =
          Math.max(
            0,
            Number(
              input.value || 0
            )
          );
      }
    );

  TSHIRT_PRICE_BODY_ORDER
    .forEach(
      body => {
        const rows =
          Array.from(
            document.querySelectorAll(
              `.posTshirtBodySetOfferRow[data-body-id="${body.id}"]`
            )
          );

        if (
          !posTshirtBodySetOfferBook[
            body.id
          ]
        ) {
          posTshirtBodySetOfferBook[
            body.id
          ] = {};
        }

        posTshirtBodySetOfferBook[
          body.id
        ][
          posCurrency
        ] =
          rows.map(
            row => ({
              quantity:
                Math.max(
                  0,
                  Math.floor(
                    Number(
                      row.querySelector(
                        ".posTshirtBodySetQuantityInput"
                      )?.value || 0
                    )
                  )
                ),

              price:
                Math.max(
                  0,
                  Number(
                    row.querySelector(
                      ".posTshirtBodySetPriceInput"
                    )?.value || 0
                  )
                )
            })
          );
      }
    );


  posTshirtMixMatchDiscountBook[
    posCurrency
  ] =
    Array.from(
      document.querySelectorAll(
        ".posTshirtMixDiscountRow"
      )
    )
      .map(
        row => ({
          quantity:
            Math.max(
              0,
              Math.floor(
                Number(
                  row.querySelector(
                    ".posTshirtMixDiscountQuantityInput"
                  )?.value || 0
                )
              )
            ),

          discount:
            Math.max(
              0,
              Number(
                row.querySelector(
                  ".posTshirtMixDiscountAmountInput"
                )?.value || 0
              )
            )
        })
      );
}

function posCartTotals() {
  const cartItems =
    Array.from(
      posCart.values()
    );

  let subtotal = 0;
  let quantity = 0;

  const baseLines =
    cartItems.map(
      item => {
        const lineQuantity =
          Math.max(
            0,
            Number(
              item.quantity || 0
            )
          );

        const unitPrice =
          Math.max(
            0,
            Number(
              item.unitPrice || 0
            )
          );

        const grossLineTotal =
          lineQuantity *
          unitPrice;

        quantity +=
          lineQuantity;

        subtotal +=
          grossLineTotal;

        return {
          item,
          key:
            item.key,
          category:
            item.category,
          quantity:
            lineQuantity,
          unitPrice,
          grossLineTotal,
          allocatedSetDiscount:
            0
        };
      }
    );

  const setSummaries = [];

  /*
   * T-shirts can be mixed across Body / Color / Size.
   * The promotion is a fixed discount (e.g. any 2 T-shirts = SGD 8 off),
   * so it works even when the unit prices are different.
   */
  const tshirtMixRules =
    posTshirtMixMatchDiscounts();

  if (
    tshirtMixRules.length
  ) {
    const tshirtLines =
      baseLines.filter(
        line =>
          line.category ===
          "tshirt"
      );

    const tshirtQuantity =
      tshirtLines.reduce(
        (sum, line) =>
          sum +
          line.quantity,
        0
      );

    const tshirtGross =
      tshirtLines.reduce(
        (sum, line) =>
          sum +
          line.grossLineTotal,
        0
      );

    const plan =
      optimalFixedDiscountPlan(
        tshirtQuantity,
        tshirtMixRules
      );

    const totalDiscount =
      Math.max(
        0,
        Math.min(
          plan.discount,
          tshirtGross
        )
      );

    if (
      totalDiscount > 0 &&
      tshirtGross > 0
    ) {
      let allocated = 0;

      tshirtLines.forEach(
        (
          line,
          index
        ) => {
          const isLast =
            index ===
            tshirtLines.length -
            1;

          const share =
            isLast
              ? (
                  totalDiscount -
                  allocated
                )
              : (
                  totalDiscount *
                  (
                    line.grossLineTotal /
                    tshirtGross
                  )
                );

          line.allocatedSetDiscount =
            Math.max(
              0,
              Math.min(
                share,
                line.grossLineTotal
              )
            );

          allocated +=
            line.allocatedSetDiscount;
        }
      );

      plan.applications.forEach(
        application => {
          setSummaries.push({
            category:
              "tshirt",
            promotionGroup:
              "tshirt_mix_match",
            promotionType:
              "fixed_discount",
            setQuantity:
              application.quantity,
            setCount:
              application.count,
            discount:
              application.discount *
              application.count
          });
        }
      );
    }
  }

  /*
   * Same-promotion items at the same unit price can be mixed.
   * Current groups:
   * Sticker + Postcard
   * Pierce + Earring
   * Drop Pierce + Drop Earring
   * Art Print
   *
   * T-shirts are handled above when a cross-body discount rule exists.
   */
  const groups =
    new Map();

  baseLines.forEach(
    line => {
      if (
        line.category ===
          "tshirt" &&
        tshirtMixRules.length
      ) {
        return;
      }

      const promotionGroup =
        posPromotionGroup(
          line.category
        );

      const groupKey =
        [
          promotionGroup,
          line.unitPrice
        ].join("|");

      if (
        !groups.has(
          groupKey
        )
      ) {
        groups.set(
          groupKey,
          []
        );
      }

      groups
        .get(
          groupKey
        )
        .push(
          line
        );
    }
  );

  groups.forEach(
    lines => {
      const category =
        lines[0]
          ?.category;

      const unitPrice =
        lines[0]
          ?.unitPrice || 0;

      const offers =
        posSetOffersForGroup(
          lines
        );

      if (
        !offers.length ||
        unitPrice <= 0
      ) {
        return;
      }

      const groupQuantity =
        lines.reduce(
          (sum, line) =>
            sum +
            line.quantity,
          0
        );

      const plan =
        optimalSetPlan(
          groupQuantity,
          unitPrice,
          offers
        );

      const regularTotal =
        groupQuantity *
        unitPrice;

      const groupSetDiscount =
        Math.max(
          0,
          regularTotal -
          plan.total
        );

      if (
        groupSetDiscount <= 0
      ) {
        return;
      }

      let allocated = 0;

      lines.forEach(
        (
          line,
          index
        ) => {
          const isLast =
            index ===
            lines.length - 1;

          const share =
            isLast
              ? (
                  groupSetDiscount -
                  allocated
                )
              : (
                  groupSetDiscount *
                  (
                    line.quantity /
                    groupQuantity
                  )
                );

          line.allocatedSetDiscount =
            Math.max(
              0,
              Math.min(
                share,
                line.grossLineTotal
              )
            );

          allocated +=
            line.allocatedSetDiscount;
        }
      );

      plan.applications
        .forEach(
          application => {
            setSummaries.push({
              category,
              promotionGroup:
                posPromotionGroup(
                  category
                ),
              promotionType:
                "set_total",
              unitPrice,
              setQuantity:
                application.quantity,
              setPrice:
                application.price,
              setCount:
                application.count,
              discount:
                application.count *
                (
                  application.quantity *
                  unitPrice -
                  application.price
                )
            });
          }
        );    }
  );

  let setDiscount = 0;
  let lineDiscount = 0;

  const pricedLines =
    baseLines.map(
      line => {
        const afterSet =
          Math.max(
            0,
            line.grossLineTotal -
            line.allocatedSetDiscount
          );

        const manualDiscount =
          Math.max(
            0,
            Math.min(
              Number(
                line.item
                  ?.manualDiscount ||
                0
              ),
              afterSet
            )
          );

        const netBeforeOrder =
          Math.max(
            0,
            afterSet -
            manualDiscount
          );

        setDiscount +=
          line.allocatedSetDiscount;

        lineDiscount +=
          manualDiscount;

        return {
          ...line,
          setDiscount:
            line.allocatedSetDiscount,
          manualDiscount,
          netBeforeOrder,
          orderDiscountAllocated:
            0,
          totalLineDiscount:
            line.allocatedSetDiscount +
            manualDiscount,
          netLineTotal:
            netBeforeOrder
        };
      }
    );

  const beforeOrderDiscount =
    Math.max(
      0,
      subtotal -
      setDiscount -
      lineDiscount
    );

  const orderDiscount =
    Math.max(
      0,
      Math.min(
        Number(
          posOrderDiscount || 0
        ),
        beforeOrderDiscount
      )
    );

  if (
    orderDiscount > 0 &&
    beforeOrderDiscount > 0
  ) {
    let allocatedOrder = 0;

    const eligible =
      pricedLines.filter(
        line =>
          line.netBeforeOrder > 0
      );

    eligible.forEach(
      (
        line,
        index
      ) => {
        const isLast =
          index ===
          eligible.length - 1;

        const allocation =
          isLast
            ? (
                orderDiscount -
                allocatedOrder
              )
            : (
                orderDiscount *
                (
                  line.netBeforeOrder /
                  beforeOrderDiscount
                )
              );

        line.orderDiscountAllocated =
          Math.max(
            0,
            Math.min(
              allocation,
              line.netBeforeOrder
            )
          );

        line.totalLineDiscount +=
          line.orderDiscountAllocated;

        line.netLineTotal =
          Math.max(
            0,
            line.netBeforeOrder -
            line.orderDiscountAllocated
          );

        allocatedOrder +=
          line.orderDiscountAllocated;
      }
    );
  }

  const discount =
    setDiscount +
    lineDiscount +
    orderDiscount;

  return {
    quantity,
    subtotal,
    setDiscount,
    lineDiscount,
    orderDiscount,
    discount,
    beforeOrderDiscount,
    total:
      Math.max(
        0,
        subtotal -
        discount
      ),
    lines:
      new Map(
        pricedLines.map(
          line => [
            line.key,
            line
          ]
        )
      ),
    setSummaries
  };
}

function addQuickItem(
  category,
  tshirtBodyKey = ""
) {
  invalidatePendingCheckout();

  const isTshirt =
    category ===
    "tshirt";

  const cleanBodyKey =
    isTshirt
      ? tshirtBodyPriceKey(
          tshirtBodyKey
        )
      : "";

  const price =
    isTshirt
      ? posTshirtBodyPrice(
          cleanBodyKey
        )
      : posPrice(
          category
        );

  if (
    price <= 0
  ) {
    return false;
  }

  const key =
    isTshirt
      ? `tshirt:${cleanBodyKey}`
      : category;

  const existing =
    posCart.get(
      key
    );

  if (existing) {
    existing.quantity += 1;
  } else {
    posCart.set(
      key,
      {
        key,
        category,

        tshirtBodyKey:
          cleanBodyKey,

        label:
          isTshirt
            ? tshirtBodyLabel(
                cleanBodyKey
              )
            : (
                POS_CATEGORY_LABELS[
                  category
                ] ||
                category
              ),

        quantity:
          1,

        unitPrice:
          price,

        manualDiscount:
          0,

        trackingMode:
          "quick"
      }
    );
  }

  return true;
}

function changePosQuantity(
  key,
  change
) {
  invalidatePendingCheckout();

  const item =
    posCart.get(
      key
    );

  if (!item) {
    return {
      success:
        false
    };
  }

  const next =
    Math.max(
      0,
      Number(
        item.quantity || 0
      ) +
      Number(
        change || 0
      )
    );

  if (
    Number(
      change || 0
    ) > 0 &&
    item.availableStock !==
      undefined &&
    item.availableStock !==
      null &&
    next >
      Number(
        item.availableStock
      )
  ) {
    return {
      success:
        false,
      message:
        `${item.label} の在庫は ${item.availableStock} 点です。`
    };
  }

  item.quantity =
    next;

  if (
    item.quantity <= 0
  ) {
    posCart.delete(
      key
    );
  }

  return {
    success:
      true
  };
}

function skuDisplayLabel(
  row
) {
  if (
    row.category ===
    "tshirt"
  ) {
    return (
      row.design ||
      "Tシャツ"
    );
  }

  return (
    row.displayName ||
    row.design ||
    POS_CATEGORY_LABELS[
      row.category
    ] ||
    row.category
  );
}

function skuDisplayDetail(
  row
) {
  if (
    row.category ===
    "tshirt"
  ) {
    return [
      row.body,
      row.color,
      row.size,
      row.pinkoiSku ||
      row.sku
        ? `SKU ${row.pinkoiSku || row.sku}`
        : ""
    ]
      .filter(Boolean)
      .join(" / ");
  }

  return (
    POS_CATEGORY_LABELS[
      row.category
    ] ||
    row.category
  );
}

function skuSalePrice(
  row
) {
  if (
    row?.category ===
      "tshirt" &&
    posCurrency ===
      "JPY"
  ) {
    const pinkoiPrice =
      Number(
        row?.pinkoiPriceJPY ||
        row?.defaultPriceJPY ||
        0
      );

    if (
      pinkoiPrice > 0
    ) {
      return pinkoiPrice;
    }
  }

  if (
    row?.category ===
    "tshirt"
  ) {
    const bodyId =
      tshirtBodyPriceKey(
        row?.body
      );

    const bodyPrice =
      posTshirtBodyPrice(
        bodyId
      );

    if (
      bodyPrice > 0
    ) {
      return bodyPrice;
    }
  }

  return posPrice(
    row?.category
  );
}

const POS_TSHIRT_SIZE_ORDER = [
  "S",
  "M",
  "L",
  "XL",
  "XXL"
];

function posTshirtSizeRank(
  value
) {
  const clean =
    String(
      value ||
      ""
    ).trim();

  const index =
    POS_TSHIRT_SIZE_ORDER
      .indexOf(
        clean
      );

  return index >= 0
    ? index
    : 999;
}

function groupPosTshirtRows(
  rows
) {
  const groups =
    new Map();

  (
    Array.isArray(rows)
      ? rows
      : []
  )
    .filter(
      row =>
        row.category ===
        "tshirt"
    )
    .forEach(
      row => {
        const key =
          [
            row.design || "",
            row.body || "",
            row.color || ""
          ].join("||");

        if (
          !groups.has(
            key
          )
        ) {
          groups.set(
            key,
            {
              key,
              design:
                row.design ||
                "Tシャツ",
              body:
                row.body ||
                "",
              color:
                row.color ||
                "",
              items: []
            }
          );
        }

        groups
          .get(
            key
          )
          .items
          .push(
            row
          );
      }
    );

  return Array.from(
    groups.values()
  )
    .map(
      group => ({
        ...group,
        items:
          group.items
            .slice()
            .sort(
              (a, b) =>
                posTshirtSizeRank(
                  a.size
                ) -
                posTshirtSizeRank(
                  b.size
                ) ||
                String(
                  a.size || ""
                ).localeCompare(
                  String(
                    b.size || ""
                  ),
                  "ja"
                )
            )
      })
    )
    .sort(
      (a, b) =>
        a.design.localeCompare(
          b.design,
          "ja"
        ) ||
        a.body.localeCompare(
          b.body,
          "ja"
        ) ||
        a.color.localeCompare(
          b.color,
          "ja"
        )
    );
}

function addSkuItem(
  row
) {
  invalidatePendingCheckout();

  const availableStock =
    Math.max(
      0,
      Number(
        row?.quantity ||
        0
      )
    );

  if (
    availableStock <= 0
  ) {
    return {
      success:
        false,
      message:
        `${skuDisplayLabel(row)} の在庫は 0 点です。`
    };
  }

  const price =
    skuSalePrice(
      row
    );

  if (
    price <= 0
  ) {
    return {
      success:
        false,
      message:
        row.category === "tshirt" &&
        posCurrency === "JPY"
          ? "Pinkoi側の日本価格を確認してください。"
          : `${POS_CATEGORY_LABELS[row.category]} の ${posCurrency} 価格を先に設定してください。`
    };
  }

  const key =
    `sku:${row.variantId}`;

  const existing =
    posCart.get(
      key
    );

  if (existing) {
    if (
      existing.quantity >=
      Number(
        row.quantity || 0
      )
    ) {
      return {
        success:
          false,
        message:
          `${existing.label} の在庫は ${row.quantity} 点です。`
      };
    }

    existing.quantity +=
      1;

    return {
      success:
        true
    };
  }

  posCart.set(
    key,
    {
      key,

      category:
        row.category,

      tshirtBodyKey:
        row.category ===
          "tshirt"
          ? tshirtBodyPriceKey(
              row.body
            )
          : "",

      label:
        skuDisplayLabel(
          row
        ),

      detail:
        skuDisplayDetail(
          row
        ),

      quantity:
        1,

      unitPrice:
        price,

      manualDiscount:
        0,

      trackingMode:
        "sku",

      variantId:
        row.variantId,

      inventoryKey:
        row.inventoryKey ||
        row.stockTargetId ||
        null,

      inventorySource:
        row.inventorySource ||
        null,

      availableStock:
        Number(
          row.quantity || 0
        )
    }
  );

  return {
    success:
      true
  };
}

async function renderPos(
  sequence
) {
  view.innerHTML = `
    <h1 class="page-title">
      EVENT POS
    </h1>

    <p class="page-note">
      Quick会計を読み込んでいます
    </p>
  `;

  try {
    if (
      !posPriceBookLoaded
    ) {
      const priceConfig =
        await loadPosPriceConfig();

      posPriceBook =
        priceConfig.prices;

      posSetOfferBook =
        priceConfig.setOffers;

      posTshirtBodyPriceBook =
        priceConfig.bodyPrices ||
        {};

      posTshirtBodySetOfferBook =
        priceConfig.bodySetOffers ||
        {};

      posTshirtMixMatchDiscountBook =
        priceConfig.tshirtMixMatchDiscounts ||
        {};

      posPriceBookLoaded =
        true;
    }

    const sessions =
      await listSalesSessions();

    const openSessions =
      sessions.filter(
        session =>
          session.status ===
          "open"
      );

    let activeSession =
      openSessions.find(
        session =>
          session.sessionId ===
          activeSessionId
      ) || null;

    if (
      activeSessionId &&
      !activeSession
    ) {
      activeSessionId =
        "";

      localStorage.removeItem(
        "icelolly-sales-active-session"
      );
    }

    if (activeSession) {
      posCurrency =
        activeSession.currency;

      localStorage.setItem(
        "icelolly-sales-pos-currency",
        posCurrency
      );
    }

    let posSkuRows = [];

    let posEventInventoryCount = {
      opening: null,
      closing: null,
      soldByVariant: {}
    };

    let posUsesEventOpeningInventory =
      false;

    let posEventOpeningTotal =
      0;

    let posEventOpeningSkuCount =
      0;

    if (
      posMode ===
      "sku"
    ) {
      const [
        tshirtInventory,
        accessoryInventory,
        registeredVariants,
        pinkoiTshirtCatalog,
        eventInventoryCount
      ] =
        await Promise.all([
          tshirtAdapter
            .getInventorySnapshot(),
          accessoryAdapter
            .getCatalogSnapshot(),
          listAllProductVariants(),
          loadPinkoiTshirtCatalog(),
          activeSession
            ? loadEventInventoryCount(
                activeSession.sessionId
              )
            : Promise.resolve({
                opening: null,
                closing: null,
                soldByVariant: {}
              })
        ]);

      posEventInventoryCount =
        eventInventoryCount || {
          opening: null,
          closing: null,
          soldByVariant: {}
        };

      const registeredMap =
        new Map(
          registeredVariants.map(
            item => [
              item.variantId ||
              item.id,
              item
            ]
          )
        );

      const tshirtRows =
        tshirtInventory.rows
          .filter(
            row =>
              registeredMap.has(
                row.variantId
              ) ||
              pinkoiTshirtCatalog
                .byVariantId
                .has(
                  row.variantId
                )
          )
          .map(
            row => {
              const registered =
                registeredMap.get(
                  row.variantId
                ) || {};

              const pinkoi =
                pinkoiTshirtCatalog
                  .byVariantId
                  .get(
                    row.variantId
                  ) || {};

              return {
                ...registered,
                ...row,
                ...pinkoi,

                quantity:
                  row.quantity,

                inventoryKey:
                  row.stockTargetId,

                inventorySource:
                  "tshirt"
              };
            }
          );

      const accessoryRows =
        accessoryInventory.rows
          .filter(
            row =>
              registeredMap.has(
                row.variantId
              )
          )
          .map(
            row => ({
              ...row,
              inventoryKey:
                row.inventoryKey,
              inventorySource:
                "accessory"
            })
          );

      const allSkuRows = [
        ...tshirtRows,
        ...accessoryRows
      ];

      const eventOpeningItems =
        Array.isArray(
          posEventInventoryCount
            ?.opening
            ?.items
        )
          ? posEventInventoryCount
              .opening
              .items
          : [];

      const eventOpeningMap =
        new Map(
          eventOpeningItems.map(
            item => [
              item.variantId,
              Math.max(
                0,
                Math.floor(
                  Number(
                    item.openingQty ||
                    0
                  )
                )
              )
            ]
          )
        );

      const soldByVariant =
        posEventInventoryCount
          ?.soldByVariant &&
        typeof posEventInventoryCount
          .soldByVariant ===
          "object"
          ? posEventInventoryCount
              .soldByVariant
          : {};

      posUsesEventOpeningInventory =
        Boolean(
          activeSession &&
          eventOpeningMap.size
        );

      posEventOpeningSkuCount =
        eventOpeningMap.size;

      posEventOpeningTotal =
        Array.from(
          eventOpeningMap.values()
        ).reduce(
          (sum, quantity) =>
            sum +
            quantity,
          0
        );

      posSkuRows =
        posUsesEventOpeningInventory
          ? allSkuRows
              .filter(
                row =>
                  eventOpeningMap.has(
                    row.variantId
                  )
              )
              .map(
                row => {
                  const openingQty =
                    eventOpeningMap.get(
                      row.variantId
                    ) ||
                    0;

                  const soldQty =
                    Math.max(
                      0,
                      Math.floor(
                        Number(
                          soldByVariant[
                            row.variantId
                          ] ||
                          0
                        )
                      )
                    );

                  return {
                    ...row,

                    globalQuantity:
                      Number(
                        row.quantity ||
                        0
                      ),

                    eventOpeningQty:
                      openingQty,

                    eventSoldQty:
                      soldQty,

                    eventInventoryActive:
                      true,

                    quantity:
                      Math.max(
                        0,
                        openingQty -
                        soldQty
                      )
                  };
                }
              )
          : allSkuRows.map(
              row => ({
                ...row,

                globalQuantity:
                  Number(
                    row.quantity ||
                    0
                  ),

                eventOpeningQty:
                  null,

                eventSoldQty:
                  0,

                eventInventoryActive:
                  false
              })
            );
    }

    if (
      sequence !==
      renderSequence
    ) {
      return;
    }

    function syncPosDiscountInputsFromDom() {
      const orderDiscountInput =
        document.querySelector(
          "#posOrderDiscount"
        );

      if (
        orderDiscountInput
      ) {
        posOrderDiscount =
          Math.max(
            0,
            Number(
              orderDiscountInput.value ||
              0
            )
          );
      }

      document
        .querySelectorAll(
          ".posLineDiscountInput"
        )
        .forEach(
          input => {
            const key =
              input.dataset.key;

            const item =
              posCart.get(
                key
              );

            if (!item) {
              return;
            }

            item.manualDiscount =
              Math.max(
                0,
                Number(
                  input.value ||
                  0
                )
              );
          }
        );
    }


    function renderPosBody(
      message = ""
    ) {
      const totals =
        posCartTotals();

      view.innerHTML = `
        <div
          style="
            display:flex;
            justify-content:space-between;
            gap:12px;
            align-items:flex-start;
            margin-bottom:14px;
          "
        >
          <div>
            <h1
              class="page-title"
              style="margin-bottom:4px;"
            >
              EVENT POS
            </h1>

            <div
              style="
                display:flex;
                gap:6px;
                margin-top:8px;
              "
            >
              <button
                id="posModeQuick"
                type="button"
                style="
                  min-height:36px;
                  padding:0 14px;
                  border:1px solid #deded9;
                  border-radius:18px;
                  ${
                    posMode === "quick"
                      ? "background:#1f1f1f;color:white;"
                      : "background:white;"
                  }
                  font-weight:700;
                "
              >
                Quick
              </button>

              <button
                id="posModeSku"
                type="button"
                style="
                  min-height:36px;
                  padding:0 14px;
                  border:1px solid #deded9;
                  border-radius:18px;
                  ${
                    posMode === "sku"
                      ? "background:#1f1f1f;color:white;"
                      : "background:white;"
                  }
                  font-weight:700;
                "
              >
                SKU
              </button>
            </div>
          </div>

          <select
            id="posCurrency"
            ${activeSession ? "disabled" : ""}
            style="
              min-height:44px;
              padding:0 12px;
              border:1px solid #deded9;
              border-radius:12px;
              background:white;
              font-weight:700;
            "
          >
            ${QUICK_PRICE_CURRENCIES.map(
              currency => `
                <option
                  value="${currency}"
                  ${
                    currency ===
                    posCurrency
                      ? "selected"
                      : ""
                  }
                >
                  ${currency}
                </option>
              `
            ).join("")}
          </select>
        </div>


        <section
          class="card"
          style="
            margin-bottom:14px;
          "
        >

          <div class="card-title">
            販売セッション
          </div>


          <select
            id="posSessionSelect"
            style="
              width:100%;
              min-height:48px;
              padding:0 12px;
              border:1px solid #deded9;
              border-radius:12px;
              background:white;
              font-weight:700;
            "
          >
            <option value="">
              販売セッションを選択
            </option>

            ${openSessions.map(
              session => `
                <option
                  value="${escapeHtml(
                    session.sessionId
                  )}"
                  ${
                    session.sessionId ===
                    activeSessionId
                      ? "selected"
                      : ""
                  }
                >
                  ${escapeHtml(
                    session.eventName
                  )}
                  /
                  ${escapeHtml(
                    session.currency
                  )}
                </option>
              `
            ).join("")}
          </select>


          ${
            activeSession
              ? `
                <div
                  class="muted"
                  style="
                    margin-top:10px;
                    line-height:1.55;
                  "
                >
                  ${escapeHtml(
                    [
                      activeSession.city,
                      activeSession.country
                    ]
                      .filter(Boolean)
                      .join(", ")
                  )}

                  <br>

                  ${escapeHtml(
                    dateText(
                      activeSession.startDate,
                      activeSession.endDate
                    )
                  )}

                  ${
                    activeSession.fxRateToJPY
                      ? `
                        <br>
                        1
                        ${escapeHtml(
                          activeSession.currency
                        )}
                        =
                        ${escapeHtml(
                          activeSession.fxRateToJPY
                        )}
                        JPY
                      `
                      : ""
                  }
                </div>
              `
              : `
                <div
                  class="muted"
                  style="
                    margin-top:10px;
                    line-height:1.55;
                  "
                >
                  Sessionsでイベントを作成すると、ここから選択できます。
                </div>

                <button
                  id="goToSessionsButton"
                  class="button button-secondary"
                  type="button"
                  style="
                    width:100%;
                    margin-top:10px;
                  "
                >
                  Sessionsを開く
                </button>
              `
          }

        </section>


        ${
          message
            ? `
              <div
                class="warning"
                style="margin-bottom:14px;"
              >
                ${escapeHtml(
                  message
                )}
              </div>
            `
            : ""
        }

        ${
          lastCheckoutResult
            ? `
              <section
                class="card"
                style="
                  margin-bottom:14px;
                  border:1px solid #cfd8cf;
                "
              >
                <div
                  style="
                    font-weight:800;
                    font-size:16px;
                  "
                >
                  会計を保存しました
                </div>

                <div
                  style="
                    margin-top:6px;
                    font-size:22px;
                    font-weight:800;
                  "
                >
                  ${formatMoney(
                    lastCheckoutResult.netSales,
                    lastCheckoutResult.currency
                  )}
                </div>

                <div
                  class="muted"
                  style="
                    margin-top:6px;
                    word-break:break-all;
                  "
                >
                  ID:
                  ${escapeHtml(
                    lastCheckoutResult.transactionId
                  )}
                </div>
              </section>
            `
            : ""
        }


        <details
          id="posPriceSettings"
          class="card"
          ${posPriceSettingsOpen ? "open" : ""}
        >

          <summary
            style="
              cursor:pointer;
              font-weight:800;
              font-size:18px;
              padding:2px 0 10px;
            "
          >
            価格設定
          </summary>

          <div class="card-title">
            ${posCurrency} 価格・セット設定
          </div>

          <div
            class="muted"
            style="margin-bottom:12px;"
          >
            TシャツはBodyごとに通常価格を設定し、割引はBody・Color・Sizeをまたいで組み合わせできます。Sticker + Postcard、Pierce + Earring、Drop Pierce + Drop Earring も同じ割引グループとして組み合わせできます。
          </div>


          ${
            posCurrency ===
            "SGD"
              ? `
                <button
                  id="applyCurrentSgdPrices"
                  type="button"
                  class="button button-secondary"
                  style="
                    width:100%;
                    margin-bottom:12px;
                    min-height:44px;
                  "
                >
                  今回のSGD価格を入力
                </button>
              `
              : ""
          }

          <div
            style="
              display:grid;
              gap:10px;
            "
          >
            ${POS_CATEGORY_ORDER.map(
              category => {
                if (
                  category ===
                  "tshirt"
                ) {
                  return `
                    <div
                      style="
                        padding:12px 0;
                        border-bottom:1px solid #ecece7;
                      "
                    >
                      <div
                        style="
                          font-weight:800;
                          margin-bottom:10px;
                        "
                      >
                        Tシャツ（Body別）
                      </div>

                      ${TSHIRT_PRICE_BODY_ORDER.map(
                        body => `
                          <div
                            style="
                              padding:11px;
                              margin-top:8px;
                              border:1px solid #ecece7;
                              border-radius:12px;
                              background:#fafaf8;
                            "
                          >
                            <div
                              style="
                                display:grid;
                                grid-template-columns:
                                  minmax(0,1fr)
                                  120px;
                                gap:8px;
                                align-items:center;
                              "
                            >
                              <div>
                                <div
                                  style="
                                    font-weight:800;
                                  "
                                >
                                  ${escapeHtml(
                                    body.label
                                  )}
                                </div>

                                <div
                                  class="muted"
                                  style="
                                    margin-top:2px;
                                    font-size:12px;
                                  "
                                >
                                  通常価格
                                </div>
                              </div>

                              <input
                                class="posTshirtBodyPriceInput"
                                data-body-id="${body.id}"
                                type="number"
                                min="0"
                                step="0.01"
                                inputmode="decimal"
                                value="${
                                  posTshirtBodyPrice(
                                    body.id
                                  ) || ""
                                }"
                                placeholder="0"
                                style="
                                  width:100%;
                                  min-height:42px;
                                  padding:0 10px;
                                  border:1px solid #deded9;
                                  border-radius:10px;
                                  text-align:right;
                                "
                              >
                            </div>
                          </div>
                        `
                      ).join("")}

                      <div
                        style="
                          padding:12px;
                          margin-top:10px;
                          border:1px solid #d9e4d7;
                          border-radius:12px;
                          background:#f5faf4;
                        "
                      >
                        <div
                          style="
                            font-weight:800;
                          "
                        >
                          Tシャツ組み合わせ割引
                        </div>

                        <div
                          class="muted"
                          style="
                            margin-top:3px;
                            font-size:12px;
                            line-height:1.45;
                          "
                        >
                          Pigment / Organic / Made in Japan を自由に組み合わせて適用します。
                        </div>

                        ${
                          (
                            posTshirtMixMatchDiscountRows()
                              .length
                              ? posTshirtMixMatchDiscountRows()
                              : [
                                  {
                                    quantity: 0,
                                    discount: 0
                                  }
                                ]
                          )
                            .map(
                              (
                                offer,
                                index
                              ) => `
                                <div
                                  class="posTshirtMixDiscountRow"
                                  data-index="${index}"
                                  style="
                                    display:grid;
                                    grid-template-columns:
                                      76px
                                      minmax(0,1fr)
                                      52px;
                                    gap:7px;
                                    align-items:center;
                                    margin-top:8px;
                                  "
                                >
                                  <input
                                    class="posTshirtMixDiscountQuantityInput"
                                    type="number"
                                    min="0"
                                    step="1"
                                    inputmode="numeric"
                                    value="${
                                      offer.quantity ||
                                      ""
                                    }"
                                    placeholder="個数"
                                    style="
                                      width:100%;
                                      min-height:40px;
                                      padding:0 7px;
                                      border:1px solid #deded9;
                                      border-radius:9px;
                                      text-align:center;
                                    "
                                  >

                                  <input
                                    class="posTshirtMixDiscountAmountInput"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    inputmode="decimal"
                                    value="${
                                      offer.discount ||
                                      ""
                                    }"
                                    placeholder="値引額"
                                    style="
                                      width:100%;
                                      min-height:40px;
                                      padding:0 8px;
                                      border:1px solid #deded9;
                                      border-radius:9px;
                                      text-align:right;
                                    "
                                  >

                                  <button
                                    type="button"
                                    class="posRemoveTshirtMixDiscountButton"
                                    data-index="${index}"
                                    style="
                                      min-height:40px;
                                      border:1px solid #deded9;
                                      border-radius:9px;
                                      background:#fff;
                                      font-size:12px;
                                      font-weight:700;
                                    "
                                  >
                                    削除
                                  </button>
                                </div>
                              `
                            )
                            .join("")
                        }

                        <button
                          type="button"
                          id="posAddTshirtMixDiscountButton"
                          style="
                            width:100%;
                            min-height:38px;
                            margin-top:8px;
                            border:1px solid #deded9;
                            border-radius:9px;
                            background:#fff;
                            font-weight:700;
                          "
                        >
                          ＋ 組み合わせ割引を追加
                        </button>
                      </div>
                    </div>
                  `;
                }

                const rawOffers =
                  posSetOfferRows(
                    category
                  );

                const displayOffers =
                  rawOffers.length
                    ? rawOffers
                    : [
                        {
                          quantity: 0,
                          price: 0
                        }
                      ];

                return `
                  <div
                    style="
                      padding:12px 0;
                      border-bottom:1px solid #ecece7;
                    "
                  >
                    <div
                      style="
                        font-weight:700;
                        margin-bottom:8px;
                      "
                    >
                      ${escapeHtml(
                        POS_CATEGORY_LABELS[
                          category
                        ]
                      )}
                    </div>

                    <div
                      style="
                        display:grid;
                        grid-template-columns:
                          minmax(0,1fr)
                          120px;
                        gap:8px;
                        align-items:center;
                      "
                    >
                      <span class="muted">
                        通常価格
                      </span>

                      <input
                        class="posPriceInput"
                        data-category="${category}"
                        type="number"
                        min="0"
                        step="0.01"
                        inputmode="decimal"
                        value="${
                          posPrice(
                            category
                          ) || ""
                        }"
                        placeholder="0"
                        style="
                          width:100%;
                          min-height:42px;
                          padding:0 10px;
                          border:1px solid #deded9;
                          border-radius:10px;
                          text-align:right;
                        "
                      >
                    </div>

                    <div
                      style="
                        margin-top:10px;
                      "
                    >
                      <div
                        class="muted"
                        style="
                          font-size:12px;
                          margin-bottom:5px;
                        "
                      >
                        セット価格
                      </div>

                      ${displayOffers.map(
                        (
                          offer,
                          index
                        ) => `
                          <div
                            class="posSetOfferRow"
                            data-category="${category}"
                            data-index="${index}"
                            style="
                              display:grid;
                              grid-template-columns:
                                68px
                                minmax(0,1fr)
                                52px;
                              gap:7px;
                              align-items:center;
                              margin-top:7px;
                            "
                          >
                            <input
                              class="posSetQuantityInput"
                              type="number"
                              min="0"
                              step="1"
                              inputmode="numeric"
                              value="${
                                offer.quantity ||
                                ""
                              }"
                              placeholder="個数"
                              aria-label="セット個数"
                              style="
                                width:100%;
                                min-height:40px;
                                padding:0 7px;
                                border:1px solid #deded9;
                                border-radius:9px;
                                text-align:center;
                              "
                            >

                            <input
                              class="posSetPriceInput"
                              type="number"
                              min="0"
                              step="0.01"
                              inputmode="decimal"
                              value="${
                                offer.price ||
                                ""
                              }"
                              placeholder="セット合計価格"
                              aria-label="セット合計価格"
                              style="
                                width:100%;
                                min-height:40px;
                                padding:0 8px;
                                border:1px solid #deded9;
                                border-radius:9px;
                                text-align:right;
                              "
                            >

                            <button
                              type="button"
                              class="posRemoveSetOfferButton"
                              data-category="${category}"
                              data-index="${index}"
                              style="
                                min-height:40px;
                                border:1px solid #deded9;
                                border-radius:9px;
                                background:#fff;
                                font-size:12px;
                                font-weight:700;
                              "
                            >
                              削除
                            </button>
                          </div>
                        `
                      ).join("")}

                      <button
                        type="button"
                        class="posAddSetOfferButton"
                        data-category="${category}"
                        style="
                          width:100%;
                          min-height:38px;
                          margin-top:8px;
                          border:1px solid #deded9;
                          border-radius:9px;
                          background:#fff;
                          font-weight:700;
                        "
                      >
                        ＋ セット価格を追加
                      </button>
                    </div>
                  </div>
                `;
              }
            ).join("")}
          </div>


          <div
            style="
              margin-top:12px;
              padding:10px 12px;
              border-radius:10px;
              background:#f7f7f4;
              font-size:12px;
              line-height:1.5;
            "
          >
            組み合わせ対象：Sticker + Postcard / Pierce + Earring / Drop Pierce + Drop Earring。Tシャツは3 Bodyすべて混在できます。
          </div>

          <button
            id="savePosPrices"
            class="button"
            type="button"
            style="
              width:100%;
              margin-top:14px;
            "
          >
            ${posCurrency} の価格を保存
          </button>


          <div
            id="posPriceMessage"
            class="muted"
            style="margin-top:10px;"
          ></div>

        </details>


        ${
          posMode === "quick"
            ? `
        <section class="card">

          <div
            style="
              display:flex;
              justify-content:space-between;
              align-items:center;
              gap:10px;
              margin-bottom:12px;
            "
          >
            <div class="card-title">
              商品をタップ
            </div>

          </div>


          <div
            style="
              display:grid;
              grid-template-columns:
                repeat(
                  2,
                  minmax(0,1fr)
                );
              gap:10px;
            "
          >
            ${quickPosItems().map(
              quickItem => {
                const category =
                  quickItem.category;

                const price =
                  quickPosItemPrice(
                    quickItem
                  );

                const cartQty =
                  posCart
                    .get(
                      quickItem.key
                    )
                    ?.quantity || 0;

                return `
                  <button
                    type="button"
                    class="posQuickCategory"
                    data-category="${category}"
                    data-tshirt-body="${escapeHtml(
                      quickItem.bodyId || ""
                    )}"
                    ${
                      price <= 0
                        ? "data-no-price=\"true\""
                        : ""
                    }
                    style="
                      position:relative;
                      min-height:92px;
                      padding:14px 12px;
                      border:1px solid #deded9;
                      border-radius:16px;
                      background:white;
                      text-align:left;
                      touch-action:manipulation;
                    "
                  >
                    ${
                      cartQty > 0
                        ? `
                          <span
                            style="
                              position:absolute;
                              right:9px;
                              top:9px;
                              min-width:28px;
                              height:28px;
                              padding:0 7px;
                              border-radius:14px;
                              background:#1f1f1f;
                              color:white;
                              display:flex;
                              align-items:center;
                              justify-content:center;
                              font-size:14px;
                              font-weight:800;
                            "
                          >
                            ${cartQty}
                          </span>
                        `
                        : ""
                    }

                    <div
                      style="
                        font-weight:800;
                        font-size:16px;
                        line-height:1.25;
                        padding-right:30px;
                      "
                    >
                      ${escapeHtml(
                        quickItem.label
                      )}
                    </div>

                    <div
                      class="muted"
                      style="
                        margin-top:9px;
                        font-size:14px;
                        line-height:1.45;
                      "
                    >
                      ${
                        price > 0
                          ? formatMoney(
                              price
                            )
                          : "価格未設定"
                      }

                      ${
                        quickPosItemSetOffers(
                          quickItem
                        )
                          .map(
                            offer => `
                              <br>
                              ${offer.quantity}点
                              ${formatMoney(
                                offer.price
                              )}
                            `
                          )
                          .join("")
                      }
                    </div>
                  </button>
                `;
              }
            ).join("")}
          </div>

        </section>



              `
            : `
              <section class="card">

                <div
                  style="
                    display:flex;
                    justify-content:space-between;
                    align-items:center;
                    gap:10px;
                    margin-bottom:12px;
                  "
                >
                  <div class="card-title">
                    SKUを選択
                  </div>

                </div>


                ${
                  activeSession
                    ? (
                        posUsesEventOpeningInventory
                          ? `
                            <div
                              style="
                                padding:10px 12px;
                                margin-bottom:10px;
                                border:1px solid #d9e4d7;
                                border-radius:12px;
                                background:#f5faf4;
                                font-size:13px;
                                line-height:1.5;
                              "
                            >
                              イベント開始在庫を使用中：
                              <strong>
                                ${posEventOpeningTotal}点
                              </strong>
                              /
                              ${posEventOpeningSkuCount} SKU
                              <br>
                              SKU在庫は「開始在庫 − このイベントのSKU販売」で表示します。
                            </div>
                          `
                          : `
                            <div
                              style="
                                padding:10px 12px;
                                margin-bottom:10px;
                                border:1px solid #ead796;
                                border-radius:12px;
                                background:#fff8df;
                                font-size:13px;
                                line-height:1.5;
                              "
                            >
                              このイベントは開始在庫が未設定です。現在は会社全体の実在庫を表示しています。
                            </div>
                          `
                      )
                    : ""
                }

                <div
                  style="
                    display:grid;
                    grid-template-columns:
                      150px
                      minmax(0,1fr);
                    gap:8px;
                    margin-bottom:10px;
                  "
                >
                  <select
                    id="posSkuCategory"
                    style="
                      width:100%;
                      min-height:44px;
                      padding:0 8px;
                      border:1px solid #deded9;
                      border-radius:11px;
                      background:white;
                    "
                  >
                    ${[
                      "tshirt",
                      "pierce",
                      "earring",
                      "drop_pierce",
                      "drop_earring"
                    ].map(
                      category => `
                        <option
                          value="${category}"
                          ${
                            category ===
                            posSkuCategory
                              ? "selected"
                              : ""
                          }
                        >
                          ${escapeHtml(
                            POS_CATEGORY_LABELS[
                              category
                            ]
                          )}
                        </option>
                      `
                    ).join("")}
                  </select>

                  <input
                    id="posSkuSearch"
                    type="search"
                    value="${escapeHtml(
                      posSkuSearch
                    )}"
                    placeholder="商品名、色、サイズで検索"
                    style="
                      width:100%;
                      min-height:44px;
                      padding:0 10px;
                      border:1px solid #deded9;
                      border-radius:11px;
                    "
                  >
                </div>


                ${
                  (() => {
                    const query =
                      posSkuSearch
                        .trim()
                        .toLocaleLowerCase();

                    const rows =
                      posSkuRows.filter(
                        row => {
                          if (
                            row.category !==
                            posSkuCategory
                          ) {
                            return false;
                          }

                          if (!query) {
                            return true;
                          }

                          const text =
                            [
                              skuDisplayLabel(
                                row
                              ),
                              skuDisplayDetail(
                                row
                              ),
                              row.body,
                              row.design,
                              row.color,
                              row.size
                            ]
                              .filter(Boolean)
                              .join(" ")
                              .toLocaleLowerCase();

                          return text.includes(
                            query
                          );
                        }
                      );

                    if (!rows.length) {
                      return `
                        <div
                          class="muted"
                          style="
                            padding:18px 0;
                            text-align:center;
                          "
                        >
                          ${
                            posUsesEventOpeningInventory
                              ? "イベント開始在庫に登録された該当SKUがありません。"
                              : "在庫のある登録済みSKUがありません。"
                          }
                        </div>
                      `;
                    }

                    if (
                      posSkuCategory ===
                      "tshirt"
                    ) {
                      const groups =
                        groupPosTshirtRows(
                          rows
                        );

                      return `
                        <div
                          style="
                            overflow-x:auto;
                            border:1px solid #ecece7;
                            border-radius:14px;
                          "
                        >
                          <div
                            style="
                              min-width:420px;
                            "
                          >
                            <div
                              style="
                                display:grid;
                                grid-template-columns:
                                  140px
                                  repeat(5,56px);
                                background:#f7f7f4;
                                border-bottom:1px solid #ecece7;
                                font-size:12px;
                                font-weight:800;
                              "
                            >
                              <div
                                style="
                                  position:sticky;
                                  left:0;
                                  z-index:4;
                                  padding:8px;
                                  background:#f7f7f4;
                                  border-right:1px solid #e7e7e2;
                                  box-shadow:3px 0 6px rgba(0,0,0,.04);
                                "
                              >
                                Design / Body / Color
                              </div>

                              ${POS_TSHIRT_SIZE_ORDER.map(
                                size => `
                                  <div
                                    style="
                                      padding:9px 4px;
                                      text-align:center;
                                    "
                                  >
                                    ${size}
                                  </div>
                                `
                              ).join("")}
                            </div>

                            ${groups.map(
                              group => `
                                <div
                                  style="
                                    display:grid;
                                    grid-template-columns:
                                      140px
                                      repeat(5,56px);
                                    border-bottom:1px solid #ecece7;
                                  "
                                >
                                  <div
                                    style="
                                      position:sticky;
                                      left:0;
                                      z-index:3;
                                      padding:8px;
                                      min-width:0;
                                      background:#fff;
                                      border-right:1px solid #e7e7e2;
                                      box-shadow:3px 0 6px rgba(0,0,0,.04);
                                    "
                                  >
                                    <div
                                      style="
                                        font-weight:800;
                                        font-size:14px;
                                        line-height:1.2;
                                        overflow-wrap:anywhere;
                                      "
                                    >
                                      ${escapeHtml(
                                        group.design
                                      )}
                                    </div>

                                    <div
                                      class="muted"
                                      style="
                                        margin-top:3px;
                                        font-size:10px;
                                        line-height:1.25;
                                        overflow-wrap:anywhere;
                                      "
                                    >
                                      ${escapeHtml(
                                        [
                                          group.body,
                                          group.color
                                        ]
                                          .filter(Boolean)
                                          .join(" / ")
                                      )}
                                    </div>
                                  </div>

                                  ${POS_TSHIRT_SIZE_ORDER.map(
                                    size => {
                                      const row =
                                        group.items.find(
                                          item =>
                                            item.size ===
                                            size
                                        );

                                      if (!row) {
                                        return `
                                          <div
                                            style="
                                              padding:8px 4px;
                                              border-left:1px solid #f0f0ec;
                                              background:#f3f3f0;
                                              color:#b7b7b2;
                                              display:flex;
                                              align-items:center;
                                              justify-content:center;
                                            "
                                          >
                                            —
                                          </div>
                                        `;
                                      }

                                      const cartQty =
                                        posCart
                                          .get(
                                            `sku:${row.variantId}`
                                          )
                                          ?.quantity ||
                                        0;

                                      const soldOut =
                                        Number(
                                          row.quantity ||
                                          0
                                        ) <= 0;

                                      const price =
                                        skuSalePrice(
                                          row
                                        );

                                      return `
                                        <button
                                          class="posSkuItem"
                                          data-variant-id="${escapeHtml(
                                            row.variantId
                                          )}"
                                          type="button"
                                          ${soldOut ? "disabled" : ""}
                                          style="
                                            min-height:66px;
                                            padding:5px 2px;
                                            border:0;
                                            border-left:1px solid #f0f0ec;
                                            background:${
                                              soldOut
                                                ? "#f3f3f0"
                                                : (
                                                    cartQty > 0
                                                      ? "#f6f6f2"
                                                      : "#fff"
                                                  )
                                            };
                                            color:${
                                              soldOut
                                                ? "#aaa"
                                                : "#1f1f1f"
                                            };
                                            text-align:center;
                                            touch-action:manipulation;
                                            opacity:${
                                              soldOut
                                                ? ".65"
                                                : "1"
                                            };
                                          "
                                        >
                                          <div
                                            style="
                                              font-size:10px;
                                              color:inherit;
                                              white-space:nowrap;
                                            "
                                          >
                                            ${
                                              soldOut
                                                ? "在庫0"
                                                : `在${row.quantity}`
                                            }
                                          </div>

                                          <div
                                            style="
                                              margin-top:3px;
                                              font-size:9px;
                                              font-weight:800;
                                              line-height:1.15;
                                              white-space:nowrap;
                                            "
                                          >
                                            ${
                                              price > 0
                                                ? escapeHtml(
                                                    formatMoney(
                                                      price
                                                    )
                                                  )
                                                : "価格未設定"
                                            }
                                          </div>

                                          ${
                                            cartQty > 0
                                              ? `
                                                <div
                                                  style="
                                                    margin-top:3px;
                                                    font-size:9px;
                                                    font-weight:800;
                                                    white-space:nowrap;
                                                  "
                                                >
                                                  会計 ${cartQty}
                                                </div>
                                              `
                                              : ""
                                          }
                                        </button>
                                      `;
                                    }
                                  ).join("")}
                                </div>
                              `
                            ).join("")}
                          </div>
                        </div>

                        <div
                          class="muted"
                          style="
                            margin-top:8px;
                            font-size:12px;
                            line-height:1.45;
                          "
                        >
                          TシャツはDesignを縦、Sizeを横に表示しています。在庫0はグレー表示です。
                        </div>
                      `;
                    }

                    return `
                      <div
                        style="
                          display:grid;
                          gap:8px;
                        "
                      >
                        ${rows.map(
                          row => {
                            const cartQty =
                              posCart
                                .get(
                                  `sku:${row.variantId}`
                                )
                                ?.quantity || 0;

                            const soldOut =
                              Number(
                                row.quantity ||
                                0
                              ) <= 0;

                            return `
                              <button
                                class="posSkuItem"
                                data-variant-id="${escapeHtml(
                                  row.variantId
                                )}"
                                type="button"
                                ${soldOut ? "disabled" : ""}
                                style="
                                  width:100%;
                                  min-height:66px;
                                  padding:10px 12px;
                                  border:1px solid #deded9;
                                  border-radius:13px;
                                  background:${
                                    soldOut
                                      ? "#f3f3f0"
                                      : "white"
                                  };
                                  color:${
                                    soldOut
                                      ? "#aaa"
                                      : "#1f1f1f"
                                  };
                                  opacity:${
                                    soldOut
                                      ? ".68"
                                      : "1"
                                  };
                                  text-align:left;
                                  display:grid;
                                  grid-template-columns:
                                    minmax(0,1fr)
                                    auto;
                                  gap:10px;
                                  align-items:center;
                                  touch-action:manipulation;
                                "
                              >
                                <div>
                                  <div
                                    style="
                                      font-weight:800;
                                    "
                                  >
                                    ${escapeHtml(
                                      skuDisplayLabel(
                                        row
                                      )
                                    )}
                                  </div>

                                  <div
                                    class="muted"
                                    style="
                                      margin-top:3px;
                                      line-height:1.35;
                                    "
                                  >
                                    ${escapeHtml(
                                      skuDisplayDetail(
                                        row
                                      )
                                    )}
                                  </div>
                                </div>

                                <div
                                  style="
                                    text-align:right;
                                  "
                                >
                                  <div
                                    style="
                                      font-weight:800;
                                    "
                                  >
                                    ${
                                      skuSalePrice(
                                        row
                                      ) > 0
                                        ? formatMoney(
                                            skuSalePrice(
                                              row
                                            )
                                          )
                                        : "価格未設定"
                                    }
                                  </div>

                                  <div
                                    class="muted"
                                    style="
                                      margin-top:3px;
                                    "
                                  >
                                    在庫 ${row.quantity}
                                    ${
                                      cartQty > 0
                                        ? ` / 会計 ${cartQty}`
                                        : ""
                                    }
                                  </div>
                                </div>
                              </button>
                            `;
                          }
                        ).join("")}
                      </div>
                    `;
                  })()
                }

              </section>
            `
        }




        <section class="card">

          <div
            style="
              display:flex;
              justify-content:space-between;
              align-items:center;
              gap:10px;
              margin-bottom:10px;
            "
          >
            <div class="card-title">
              会計
            </div>

            <div
              style="
                font-weight:800;
              "
            >
              ${totals.quantity} 点
            </div>
          </div>


          ${
            posCart.size
              ? Array.from(
                  posCart.values()
                ).map(
                  item => `
                    <div
                      class="list-row"
                      style="
                        gap:10px;
                      "
                    >
                      <div
                        style="
                          min-width:0;
                          flex:1;
                        "
                      >
                        <div
                          style="
                            font-weight:700;
                          "
                        >
                          ${escapeHtml(
                            item.label
                          )}
                        </div>

                        ${
                          item.detail
                            ? `
                              <div
                                class="muted"
                                style="
                                  margin-top:3px;
                                "
                              >
                                ${escapeHtml(
                                  item.detail
                                )}
                              </div>
                            `
                            : ""
                        }

                        <div
                          class="muted"
                          style="
                            margin-top:3px;
                            line-height:1.5;
                          "
                        >
                          ${formatMoney(
                            item.unitPrice
                          )}

                          ${
                            (() => {
                              const pricing =
                                totals.lines.get(
                                  item.key
                                );

                              return (
                                pricing?.setDiscount >
                                0
                              )
                                ? `
                                  <br>
                                  セット値引
                                  −${formatMoney(
                                    pricing.setDiscount
                                  )}
                                `
                                : "";
                            })()
                          }
                        </div>

                        <label
                          style="
                            display:flex;
                            align-items:center;
                            gap:6px;
                            margin-top:7px;
                          "
                        >
                          <span
                            class="muted"
                            style="
                              font-size:12px;
                              white-space:nowrap;
                            "
                          >
                            個別値引
                          </span>

                          <input
                            class="posLineDiscountInput"
                            data-key="${escapeHtml(
                              item.key
                            )}"
                            type="number"
                            min="0"
                            step="0.01"
                            inputmode="decimal"
                            value="${
                              Number(
                                item.manualDiscount ||
                                0
                              ) || ""
                            }"
                            placeholder="0"
                            style="
                              width:90px;
                              min-height:36px;
                              padding:0 8px;
                              border:1px solid #deded9;
                              border-radius:9px;
                              text-align:right;
                            "
                          >
                        </label>
                      </div>


                      <div
                        style="
                          display:flex;
                          align-items:center;
                          gap:6px;
                        "
                      >
                        <button
                          class="posQtyButton"
                          data-key="${escapeHtml(
                            item.key
                          )}"
                          data-change="-1"
                          type="button"
                          style="
                            width:42px;
                            height:42px;
                            border:1px solid #deded9;
                            border-radius:12px;
                            background:white;
                            font-size:22px;
                          "
                        >
                          −
                        </button>

                        <div
                          style="
                            min-width:34px;
                            text-align:center;
                            font-weight:800;
                            font-size:18px;
                          "
                        >
                          ${item.quantity}
                        </div>

                        <button
                          class="posQtyButton"
                          data-key="${escapeHtml(
                            item.key
                          )}"
                          data-change="1"
                          type="button"
                          style="
                            width:42px;
                            height:42px;
                            border:1px solid #deded9;
                            border-radius:12px;
                            background:white;
                            font-size:22px;
                          "
                        >
                          ＋
                        </button>
                      </div>


                      <div
                        style="
                          min-width:90px;
                          text-align:right;
                          font-weight:800;
                        "
                      >
                        ${
                          (() => {
                            const pricing =
                              totals.lines.get(
                                item.key
                              );

                            return formatMoney(
                              pricing
                                ?.netBeforeOrder ??
                              (
                                item.quantity *
                                item.unitPrice
                              )
                            );
                          })()
                        }
                      </div>
                    </div>
                  `
                ).join("")
              : `
                <div
                  class="muted"
                  style="
                    padding:16px 0;
                    text-align:center;
                  "
                >
                  商品をタップするとここに追加されます。
                </div>
              `
          }


          <div
            style="
              margin-top:12px;
              padding-top:12px;
              border-top:1px solid #ecece7;
            "
          >

            <div class="list-row">
              <span>
                小計
              </span>

              <strong>
                ${formatMoney(
                  totals.subtotal
                )}
              </strong>
            </div>


            ${
              totals.setDiscount > 0
                ? `
                  <div class="list-row">
                    <span>
                      セット値引
                    </span>

                    <strong>
                      −${formatMoney(
                        totals.setDiscount
                      )}
                    </strong>
                  </div>
                `
                : ""
            }

            ${
              totals.lineDiscount > 0
                ? `
                  <div class="list-row">
                    <span>
                      個別値引
                    </span>

                    <strong>
                      −${formatMoney(
                        totals.lineDiscount
                      )}
                    </strong>
                  </div>
                `
                : ""
            }

            <label
              class="list-row"
              style="
                align-items:center;
              "
            >
              <span>
                会計全体の値引
              </span>

              <input
                id="posOrderDiscount"
                type="number"
                min="0"
                step="0.01"
                inputmode="decimal"
                value="${
                  posOrderDiscount ||
                  ""
                }"
                placeholder="0"
                style="
                  width:120px;
                  min-height:42px;
                  padding:0 10px;
                  border:1px solid #deded9;
                  border-radius:10px;
                  text-align:right;
                "
              >
            </label>


            <div
              class="list-row"
              style="
                font-size:22px;
              "
            >
              <strong>
                TOTAL
              </strong>

              <strong>
                ${formatMoney(
                  totals.total
                )}
              </strong>
            </div>

          </div>


          <button
            id="posCheckoutButton"
            type="button"
            class="button"
            ${
              activeSession &&
              posCart.size > 0 &&
              totals.total >= 0
                ? ""
                : "disabled"
            }
            style="
              width:100%;
              margin-top:14px;
              min-height:56px;
              font-size:17px;
              ${
                activeSession &&
                posCart.size > 0
                  ? ""
                  : "opacity:.55;"
              }
            "
          >
            ${
              activeSession
                ? (
                    posCart.size > 0
                      ? "会計確定"
                      : "商品を追加してください"
                  )
                : "販売セッションを選択"
            }
          </button>


          ${
            posCart.size
              ? `
                <button
                  id="clearPosCart"
                  type="button"
                  class="button button-secondary"
                  style="
                    width:100%;
                    margin-top:10px;
                    min-height:48px;
                  "
                >
                  この会計をクリア
                </button>
              `
              : ""
          }


          <div
            class="muted"
            style="
              margin-top:12px;
              line-height:1.6;
            "
          >
            QuickとSKUは会計途中でも自由に切り替えられ、同じカートに混在できます。Quickはカテゴリ単位で記録し、SKU販売は会計確定と同時に対象SKUの実在庫を減らします。
          </div>

        </section>
      `;


      document
        .querySelector(
          "#posModeQuick"
        )
        ?.addEventListener(
          "click",
          () => {
            if (
              posMode ===
              "quick"
            ) {
              return;
            }

            /*
             * Quick / SKU are product-selection views only.
             * Keep the same cart so one checkout can mix both.
             */
            posMode =
              "quick";

            localStorage.setItem(
              "icelolly-sales-pos-mode",
              posMode
            );

            renderPos(
              ++renderSequence
            );
          }
        );


      document
        .querySelector(
          "#posModeSku"
        )
        ?.addEventListener(
          "click",
          () => {
            if (
              posMode ===
              "sku"
            ) {
              return;
            }

            /*
             * Quick / SKU are product-selection views only.
             * Keep the same cart so one checkout can mix both.
             */
            posMode =
              "sku";

            localStorage.setItem(
              "icelolly-sales-pos-mode",
              posMode
            );

            renderPos(
              ++renderSequence
            );
          }
        );


      document
        .querySelector(
          "#posSkuCategory"
        )
        ?.addEventListener(
          "change",
          event => {
            posSkuCategory =
              event.target.value;

            posSkuSearch =
              "";

            renderPosBody();
          }
        );


      document
        .querySelector(
          "#posSkuSearch"
        )
        ?.addEventListener(
          "input",
          event => {
            posSkuSearch =
              event.target.value;

            renderPosBody();

            requestAnimationFrame(
              () => {
                const input =
                  document.querySelector(
                    "#posSkuSearch"
                  );

                if (input) {
                  input.focus();

                  const length =
                    input.value.length;

                  input.setSelectionRange(
                    length,
                    length
                  );
                }
              }
            );
          }
        );


      document
        .querySelectorAll(
          ".posSkuItem"
        )
        .forEach(
          button => {
            button.addEventListener(
              "click",
              () => {
                const row =
                  posSkuRows.find(
                    item =>
                      item.variantId ===
                      button.dataset.variantId
                  );

                if (!row) {
                  return;
                }

                const result =
                  addSkuItem(
                    row
                  );

                if (
                  !result.success
                ) {
                  if (
                    result.message
                      ?.includes(
                        "価格"
                      )
                  ) {
                    posPriceSettingsOpen =
                      true;
                  }

                  renderPosBody(
                    result.message ||
                    "追加できませんでした。"
                  );

                  return;
                }

                renderPosBody();
              }
            );
          }
        );


      document
        .querySelector(
          "#posSessionSelect"
        )
        ?.addEventListener(
          "change",
          event => {
            const nextId =
              event.target.value;

            if (
              nextId ===
              activeSessionId
            ) {
              return;
            }

            if (
              posCart.size > 0
            ) {
              const confirmed =
                window.confirm(
                  "会計内容をクリアして販売セッションを変更しますか？"
                );

              if (!confirmed) {
                renderPosBody();
                return;
              }
            }

            const nextSession =
              openSessions.find(
                session =>
                  session.sessionId ===
                  nextId
              ) || null;

            invalidatePendingCheckout();

            lastCheckoutResult =
              null;

            activeSessionId =
              nextSession
                ? nextSession.sessionId
                : "";

            if (activeSessionId) {
              localStorage.setItem(
                "icelolly-sales-active-session",
                activeSessionId
              );
            } else {
              localStorage.removeItem(
                "icelolly-sales-active-session"
              );
            }

            activeSession =
              nextSession;

            if (nextSession) {
              posCurrency =
                nextSession.currency;

              localStorage.setItem(
                "icelolly-sales-pos-currency",
                posCurrency
              );
            }

            invalidatePendingCheckout();

            lastCheckoutResult =
              null;

            posCart =
              new Map();

            posOrderDiscount =
              0;

            renderPosBody();
          }
        );


      document
        .querySelector(
          "#goToSessionsButton"
        )
        ?.addEventListener(
          "click",
          () => {
            render(
              "sessions"
            );
          }
        );


      document
        .querySelector(
          "#posCurrency"
        )
        ?.addEventListener(
          "change",
          event => {
            invalidatePendingCheckout();

            lastCheckoutResult =
              null;

            posCurrency =
              event.target.value;

            localStorage.setItem(
              "icelolly-sales-pos-currency",
              posCurrency
            );

            posCart =
              new Map();

            posOrderDiscount =
              0;

            renderPosBody();
          }
        );


      document
        .querySelectorAll(
          ".posQuickCategory"
        )
        .forEach(
          button => {
            button.addEventListener(
              "click",
              () => {
                const category =
                  button.dataset.category;

                const tshirtBody =
                  button.dataset.tshirtBody ||
                  "";

                const success =
                  addQuickItem(
                    category,
                    tshirtBody
                  );

                if (!success) {
                  posPriceSettingsOpen =
                    true;

                  const priceLabel =
                    category ===
                    "tshirt"
                      ? tshirtBodyLabel(
                          tshirtBody
                        )
                      : POS_CATEGORY_LABELS[
                          category
                        ];

                  renderPosBody(
                    `${priceLabel} の ${posCurrency} 価格を先に設定してください。`
                  );

                  requestAnimationFrame(
                    () => {
                      document
                        .querySelector(
                          "#posPriceSettings"
                        )
                        ?.scrollIntoView({
                          behavior:
                            "smooth",
                          block:
                            "start"
                        });
                    }
                  );

                  return;
                }

                renderPosBody();
              }
            );
          }
        );


      document
        .querySelectorAll(
          ".posQtyButton"
        )
        .forEach(
          button => {
            button.addEventListener(
              "click",
              () => {
                const result =
                  changePosQuantity(
                    button.dataset.key,
                    Number(
                      button.dataset.change ||
                      0
                    )
                  );

                renderPosBody(
                  result.message ||
                  ""
                );
              }
            );
          }
        );


      document
        .querySelectorAll(
          ".posLineDiscountInput"
        )
        .forEach(
          input => {
            input.addEventListener(
              "input",
              event => {
                invalidatePendingCheckout();

                const key =
                  event.target
                    .dataset
                    .key;

                const item =
                  posCart.get(
                    key
                  );

                if (!item) {
                  return;
                }

                item.manualDiscount =
                  Math.max(
                    0,
                    Number(
                      event.target.value ||
                      0
                    )
                  );
              }
            );

            input.addEventListener(
              "change",
              () => {
                renderPosBody();
              }
            );
          }
        );


      document
        .querySelector(
          "#posPriceSettings"
        )
        ?.addEventListener(
          "toggle",
          event => {
            posPriceSettingsOpen =
              Boolean(
                event.currentTarget
                  ?.open
              );
          }
        );


      document
        .querySelector(
          "#posAddTshirtMixDiscountButton"
        )
        ?.addEventListener(
          "click",
          () => {
            capturePosPriceSettingsFromDom();

            const current =
              posTshirtMixMatchDiscountRows();

            current.push({
              quantity: 0,
              discount: 0
            });

            posTshirtMixMatchDiscountBook[
              posCurrency
            ] = current;

            posPriceSettingsOpen =
              true;

            renderPosBody();
          }
        );


      document
        .querySelectorAll(
          ".posRemoveTshirtMixDiscountButton"
        )
        .forEach(
          button => {
            button.addEventListener(
              "click",
              () => {
                capturePosPriceSettingsFromDom();

                const index =
                  Math.max(
                    0,
                    Math.floor(
                      Number(
                        button.dataset.index ||
                        0
                      )
                    )
                  );

                const current =
                  posTshirtMixMatchDiscountRows();

                current.splice(
                  index,
                  1
                );

                posTshirtMixMatchDiscountBook[
                  posCurrency
                ] = current;

                posPriceSettingsOpen =
                  true;

                renderPosBody();
              }
            );
          }
        );


      document
        .querySelectorAll(
          ".posAddTshirtBodySetOfferButton"
        )
        .forEach(
          button => {
            button.addEventListener(
              "click",
              () => {
                capturePosPriceSettingsFromDom();

                const bodyId =
                  button.dataset.bodyId;

                if (
                  !posTshirtBodySetOfferBook[
                    bodyId
                  ]
                ) {
                  posTshirtBodySetOfferBook[
                    bodyId
                  ] = {};
                }

                const current =
                  posTshirtBodySetOfferRows(
                    bodyId
                  );

                current.push({
                  quantity: 0,
                  price: 0
                });

                posTshirtBodySetOfferBook[
                  bodyId
                ][
                  posCurrency
                ] = current;

                posPriceSettingsOpen =
                  true;

                renderPosBody();
              }
            );
          }
        );


      document
        .querySelectorAll(
          ".posRemoveTshirtBodySetOfferButton"
        )
        .forEach(
          button => {
            button.addEventListener(
              "click",
              () => {
                capturePosPriceSettingsFromDom();

                const bodyId =
                  button.dataset.bodyId;

                const index =
                  Math.max(
                    0,
                    Math.floor(
                      Number(
                        button.dataset.index ||
                        0
                      )
                    )
                  );

                const current =
                  posTshirtBodySetOfferRows(
                    bodyId
                  );

                current.splice(
                  index,
                  1
                );

                if (
                  !posTshirtBodySetOfferBook[
                    bodyId
                  ]
                ) {
                  posTshirtBodySetOfferBook[
                    bodyId
                  ] = {};
                }

                posTshirtBodySetOfferBook[
                  bodyId
                ][
                  posCurrency
                ] = current;

                posPriceSettingsOpen =
                  true;

                renderPosBody();
              }
            );
          }
        );


      document
        .querySelectorAll(
          ".posAddSetOfferButton"
        )
        .forEach(
          button => {
            button.addEventListener(
              "click",
              () => {
                capturePosPriceSettingsFromDom();

                const category =
                  button.dataset.category;

                if (
                  !posSetOfferBook[
                    category
                  ]
                ) {
                  posSetOfferBook[
                    category
                  ] = {};
                }

                const current =
                  posSetOfferRows(
                    category
                  );

                current.push({
                  quantity: 0,
                  price: 0
                });

                posSetOfferBook[
                  category
                ][
                  posCurrency
                ] = current;

                posPriceSettingsOpen =
                  true;

                renderPosBody();
              }
            );
          }
        );


      document
        .querySelectorAll(
          ".posRemoveSetOfferButton"
        )
        .forEach(
          button => {
            button.addEventListener(
              "click",
              () => {
                capturePosPriceSettingsFromDom();

                const category =
                  button.dataset.category;

                const index =
                  Math.max(
                    0,
                    Math.floor(
                      Number(
                        button.dataset.index ||
                        0
                      )
                    )
                  );

                const current =
                  posSetOfferRows(
                    category
                  );

                current.splice(
                  index,
                  1
                );

                if (
                  !posSetOfferBook[
                    category
                  ]
                ) {
                  posSetOfferBook[
                    category
                  ] = {};
                }

                posSetOfferBook[
                  category
                ][
                  posCurrency
                ] = current;

                posPriceSettingsOpen =
                  true;

                renderPosBody();
              }
            );
          }
        );


      document
        .querySelector(
          "#applyCurrentSgdPrices"
        )
        ?.addEventListener(
          "click",
          () => {
            const presetPrices = {
              tshirt:
                posPrice(
                  "tshirt"
                ),
              pierce: 22,
              earring: 22,
              drop_pierce: 26,
              drop_earring: 26,
              sticker: 5,
              postcard: 5,
              art_print: 25
            };

            const presetSetOffers = {
              tshirt:
                posSetOfferRows(
                  "tshirt"
                ),
              pierce: [
                {
                  quantity: 2,
                  price: 40
                }
              ],
              earring: [
                {
                  quantity: 2,
                  price: 40
                }
              ],
              drop_pierce: [
                {
                  quantity: 2,
                  price: 48
                }
              ],
              drop_earring: [
                {
                  quantity: 2,
                  price: 48
                }
              ],
              sticker: [
                {
                  quantity: 3,
                  price: 13
                },
                {
                  quantity: 5,
                  price: 20
                }
              ],
              postcard: [
                {
                  quantity: 3,
                  price: 13
                },
                {
                  quantity: 5,
                  price: 20
                }
              ],
              art_print: [
                {
                  quantity: 2,
                  price: 45
                }
              ]
            };

            const presetBodyPrices = {
              Vintage: 52,
              Organic: 55,
              MIJ: 72
            };

            const presetBodySetOffers = {
              Vintage: [],
              Organic: [],
              MIJ: []
            };

            const presetTshirtMixDiscounts = [
              {
                quantity: 2,
                discount: 8
              }
            ];

            POS_CATEGORY_ORDER
              .forEach(
                category => {
                  if (
                    !posPriceBook[
                      category
                    ]
                  ) {
                    posPriceBook[
                      category
                    ] = {};
                  }

                  if (
                    !posSetOfferBook[
                      category
                    ]
                  ) {
                    posSetOfferBook[
                      category
                    ] = {};
                  }

                  posPriceBook[
                    category
                  ].SGD =
                    Number(
                      presetPrices[
                        category
                      ] || 0
                    );

                  posSetOfferBook[
                    category
                  ].SGD =
                    (
                      presetSetOffers[
                        category
                      ] ||
                      []
                    ).map(
                      offer => ({
                        quantity:
                          offer.quantity,
                        price:
                          offer.price
                      })
                    );
                }
              );

            TSHIRT_PRICE_BODY_ORDER
              .forEach(
                body => {
                  if (
                    !posTshirtBodyPriceBook[
                      body.id
                    ]
                  ) {
                    posTshirtBodyPriceBook[
                      body.id
                    ] = {};
                  }

                  if (
                    !posTshirtBodySetOfferBook[
                      body.id
                    ]
                  ) {
                    posTshirtBodySetOfferBook[
                      body.id
                    ] = {};
                  }

                  posTshirtBodyPriceBook[
                    body.id
                  ].SGD =
                    presetBodyPrices[
                      body.id
                    ];

                  posTshirtBodySetOfferBook[
                    body.id
                  ].SGD =
                    presetBodySetOffers[
                      body.id
                    ].map(
                      offer => ({
                        quantity:
                          offer.quantity,
                        price:
                          offer.price
                      })
                    );
                }
              );

            posTshirtMixMatchDiscountBook
              .SGD =
                presetTshirtMixDiscounts
                  .map(
                    offer => ({
                      quantity:
                        offer.quantity,
                      discount:
                        offer.discount
                    })
                  );

            posPriceSettingsOpen =
              true;

            renderPosBody(
              "今回のSGD価格と組み合わせ割引を入力しました。「SGD の価格を保存」で確定してください。"
            );
          }
        );


      document
        .querySelector(
          "#savePosPrices"
        )
        ?.addEventListener(
          "click",
          async event => {
            const button =
              event.currentTarget;

            const messageBox =
              document.querySelector(
                "#posPriceMessage"
              );

            const prices = {};
            const setOffers = {};
            const bodyPrices = {};
            const bodySetOffers = {};
            const tshirtMixMatchDiscounts = [];

            document
              .querySelectorAll(
                ".posPriceInput"
              )
              .forEach(
                input => {
                  prices[
                    input.dataset.category
                  ] =
                    Number(
                      input.value ||
                      0
                    );
                }
              );

            POS_CATEGORY_ORDER
              .forEach(
                category => {
                  const rows =
                    Array.from(
                      document.querySelectorAll(
                        `.posSetOfferRow[data-category="${category}"]`
                      )
                    );

                  setOffers[
                    category
                  ] =
                    rows
                      .map(
                        row => ({
                          quantity:
                            Math.max(
                              0,
                              Math.floor(
                                Number(
                                  row.querySelector(
                                    ".posSetQuantityInput"
                                  )?.value || 0
                                )
                              )
                            ),

                          price:
                            Math.max(
                              0,
                              Number(
                                row.querySelector(
                                  ".posSetPriceInput"
                                )?.value || 0
                              )
                            )
                        })
                      )
                      .filter(
                        offer =>
                          offer.quantity >= 2 &&
                          offer.price > 0
                      );
                }
              );

            document
              .querySelectorAll(
                ".posTshirtBodyPriceInput"
              )
              .forEach(
                input => {
                  bodyPrices[
                    input.dataset.bodyId
                  ] =
                    Number(
                      input.value ||
                      0
                    );
                }
              );

            TSHIRT_PRICE_BODY_ORDER
              .forEach(
                body => {
                  bodySetOffers[
                    body.id
                  ] =
                    Array.from(
                      document.querySelectorAll(
                        `.posTshirtBodySetOfferRow[data-body-id="${body.id}"]`
                      )
                    )
                      .map(
                        row => ({
                          quantity:
                            Math.max(
                              0,
                              Math.floor(
                                Number(
                                  row.querySelector(
                                    ".posTshirtBodySetQuantityInput"
                                  )?.value || 0
                                )
                              )
                            ),

                          price:
                            Math.max(
                              0,
                              Number(
                                row.querySelector(
                                  ".posTshirtBodySetPriceInput"
                                )?.value || 0
                              )
                            )
                        })
                      )
                      .filter(
                        offer =>
                          offer.quantity >= 2 &&
                          offer.price > 0
                      );
                }
              );

            Array.from(
              document.querySelectorAll(
                ".posTshirtMixDiscountRow"
              )
            )
              .map(
                row => ({
                  quantity:
                    Math.max(
                      0,
                      Math.floor(
                        Number(
                          row.querySelector(
                            ".posTshirtMixDiscountQuantityInput"
                          )?.value || 0
                        )
                      )
                    ),

                  discount:
                    Math.max(
                      0,
                      Number(
                        row.querySelector(
                          ".posTshirtMixDiscountAmountInput"
                        )?.value || 0
                      )
                    )
                })
              )
              .filter(
                offer =>
                  offer.quantity >= 2 &&
                  offer.discount > 0
              )
              .forEach(
                offer => {
                  tshirtMixMatchDiscounts
                    .push(
                      offer
                    );
                }
              );

            button.disabled =
              true;

            button.textContent =
              "保存中";

            try {
              await savePosPriceConfig(
                posCurrency,
                prices,
                setOffers,
                bodyPrices,
                bodySetOffers,
                tshirtMixMatchDiscounts
              );

              POS_CATEGORY_ORDER
                .forEach(
                  category => {
                    if (
                      !posPriceBook[
                        category
                      ]
                    ) {
                      posPriceBook[
                        category
                      ] = {};
                    }

                    if (
                      !posSetOfferBook[
                        category
                      ]
                    ) {
                      posSetOfferBook[
                        category
                      ] = {};
                    }

                    posPriceBook[
                      category
                    ][
                      posCurrency
                    ] =
                      Number(
                        prices[
                          category
                        ] || 0
                      );

                    posSetOfferBook[
                      category
                    ][
                      posCurrency
                    ] =
                      (
                        setOffers[
                          category
                        ] ||
                        []
                      ).map(
                        offer => ({
                          quantity:
                            offer.quantity,
                          price:
                            offer.price
                        })
                      );
                  }
                );

              TSHIRT_PRICE_BODY_ORDER
                .forEach(
                  body => {
                    if (
                      !posTshirtBodyPriceBook[
                        body.id
                      ]
                    ) {
                      posTshirtBodyPriceBook[
                        body.id
                      ] = {};
                    }

                    if (
                      !posTshirtBodySetOfferBook[
                        body.id
                      ]
                    ) {
                      posTshirtBodySetOfferBook[
                        body.id
                      ] = {};
                    }

                    posTshirtBodyPriceBook[
                      body.id
                    ][
                      posCurrency
                    ] =
                      Number(
                        bodyPrices[
                          body.id
                        ] || 0
                      );

                    posTshirtBodySetOfferBook[
                      body.id
                    ][
                      posCurrency
                    ] =
                      (
                        bodySetOffers[
                          body.id
                        ] ||
                        []
                      ).map(
                        offer => ({
                          quantity:
                            offer.quantity,
                          price:
                            offer.price
                        })
                      );
                  }
                );

              posTshirtMixMatchDiscountBook[
                posCurrency
              ] =
                tshirtMixMatchDiscounts
                  .map(
                    offer => ({
                      quantity:
                        offer.quantity,
                      discount:
                        offer.discount
                    })
                  );

              if (messageBox) {
                messageBox.textContent =
                  `${posCurrency} の価格を保存しました。`;
              }

              button.textContent =
                "保存済み";

              setTimeout(
                () => {
                  posPriceSettingsOpen =
                    false;

                  renderPosBody();
                },
                500
              );

            } catch (error) {
              button.disabled =
                false;

              button.textContent =
                `${posCurrency} の価格を保存`;

              if (messageBox) {
                messageBox.textContent =
                  error.code ||
                  error.message ||
                  String(error);
              }
            }
          }
        );


      document
        .querySelector(
          "#posOrderDiscount"
        )
        ?.addEventListener(
          "input",
          event => {
            invalidatePendingCheckout();

            posOrderDiscount =
              Math.max(
                0,
                Number(
                  event.target.value ||
                  0
                )
              );
          }
        );


      document
        .querySelector(
          "#posOrderDiscount"
        )
        ?.addEventListener(
          "change",
          () => {
            renderPosBody();
          }
        );


      document
        .querySelector(
          "#posCheckoutButton"
        )
        ?.addEventListener(
          "click",
          async event => {
            if (
              !activeSession ||
              posCart.size === 0
            ) {
              return;
            }

            /*
             * iPhone Safari may not fire change/blur before the
             * checkout button is tapped. Read the visible discount
             * fields directly so the saved transaction always matches
             * the amount shown to the user.
             */
            syncPosDiscountInputsFromDom();

            const totals =
              posCartTotals();

            const confirmed =
              window.confirm(
                `${formatMoney(
                  totals.total
                )} の会計を確定しますか？`
              );

            if (!confirmed) {
              return;
            }

            const button =
              event.currentTarget;

            button.disabled =
              true;

            button.textContent =
              "保存中";

            if (
              !pendingCheckoutTransactionId
            ) {
              pendingCheckoutTransactionId =
                createPendingCheckoutId();
            }

            try {
              const result =
                await commitQuickSale({
                  transactionId:
                    pendingCheckoutTransactionId,

                  sessionId:
                    activeSession.sessionId,

                  items:
                    Array.from(
                      posCart.values()
                    ).map(
                      item => {
                        const pricing =
                          totals.lines.get(
                            item.key
                          );

                        return {
                          lineId:
                            item.key,
                          category:
                            item.category,
                          label:
                            item.label,
                          quantity:
                            item.quantity,
                          unitPrice:
                            item.unitPrice,
                          trackingMode:
                            item.trackingMode ||
                            "quick",

                          variantId:
                            item.variantId ||
                            null,

                          inventoryKey:
                            item.inventoryKey ||
                            null,

                          setDiscount:
                            pricing
                              ?.setDiscount ||
                            0,

                          manualDiscount:
                            pricing
                              ?.manualDiscount ||
                            0,

                          setOffer:
                            (() => {
                              const offer =
                                posSetOffer(
                                  item.category
                                );

                              return {
                                quantity:
                                  offer.quantity,
                                price:
                                  offer.price
                              };
                            })()
                        };
                      }
                    ),

                  orderDiscount:
                    totals.orderDiscount,

                  createdByEmail:
                    currentUser
                      ?.email ||
                    ""
                });

              lastCheckoutResult =
                result;

              pendingCheckoutTransactionId =
                null;

              posCart =
                new Map();

              posOrderDiscount =
                0;

              await renderPos(
                ++renderSequence
              );

            } catch (error) {
              console.error(
                "Checkout failed",
                error
              );

              button.disabled =
                false;

              button.textContent =
                "会計確定";

              renderPosBody(
                error.code ||
                error.message ||
                String(error)
              );
            }
          }
        );


      document
        .querySelector(
          "#clearPosCart"
        )
        ?.addEventListener(
          "click",
          () => {
            const confirmed =
              window.confirm(
                "この会計内容をクリアしますか？"
              );

            if (!confirmed) {
              return;
            }

            posCart =
              new Map();

            posOrderDiscount =
              0;

            renderPosBody();
          }
        );
    }


    renderPosBody();

    syncStatus.textContent =
      "Firebase";


  } catch (error) {
    console.error(
      error
    );

    view.innerHTML = `
      <h1 class="page-title">
        EVENT POS
      </h1>

      <div class="warning">
        ${escapeHtml(
          error.code ||
          error.message ||
          error
        )}
      </div>
    `;
  }
}

async function render(route = currentRoute) {
  currentRoute = route;
  const sequence = ++renderSequence;

  updateNavigation();

  if (firebaseState?.enabled && !currentUser) {
    renderLogin();
    return;
  }

  if (route === "dashboard") {
    view.innerHTML = renderDashboard({
      firebaseEnabled: firebaseState?.enabled
    });

  } else if (route === "sessions") {
    await renderSessions(sequence);

  } else if (route === "pos") {
    await renderPos(sequence);

  } else if (route === "inventory") {
    await renderInventory(sequence);

  } else if (route === "more") {
    await renderMorePage(sequence);
  }
}

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () =>
    render(btn.dataset.route)
  );
});

async function start() {
  firebaseState = await initFirebase();

  if (!firebaseState.enabled) {
    syncStatus.textContent = "Local";
    render("dashboard");
    return;
  }

  await initAuth((user, error) => {
    currentUser = user;
    authError = error;
    syncStatus.textContent = user ? "Firebase" : "Login";
    render(currentRoute);
  });
}

start();
