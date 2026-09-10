import { initFirebase } from "./firebase.js";
import { initAuth, loginWithGoogle, logout } from "./auth.js";
import { renderDashboard } from "./views/dashboardView.js";
import { tshirtAdapter } from "./inventoryAdapters/tshirtAdapter.js";
import { accessoryAdapter } from "./inventoryAdapters/accessoryAdapter.js";
import { loadTshirtProductVariants, syncTshirtCurrentStockRows } from "./services/catalogService.js";
import { listAllProductVariants, registerTshirtVariant, registerGeneralProduct, syncAccessoryCatalogRows } from "./services/productAdminService.js";
import { CATEGORY_TEMPLATES, getCategoryTemplate } from "./data/categoryTemplates.js";
import { loadQuickPriceBook, saveQuickPrices, QUICK_PRICE_CURRENCIES } from "./services/priceBookService.js";
import { listSalesSessions, createEventSession, updateEventSession, SESSION_CURRENCIES } from "./services/sessionService.js";
import { commitQuickSale } from "./services/transactionService.js";
import { listSessionTransactions } from "./services/salesHistoryService.js";

const view = document.querySelector("#view");
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

let posCurrency =
  localStorage.getItem(
    "icelolly-sales-pos-currency"
  ) || "JPY";

let posPriceBook = {};
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

let sessionDetailId =
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


      <section class="card">

        <div class="card-title">
          Tシャツ
        </div>


        <div class="list-row">
          <span>
            現在在庫
          </span>

          <strong>
            ${tshirtInventory.summary.totalStock}
          </strong>
        </div>


        <div class="list-row">
          <span>
            在庫ありSKU
          </span>

          <strong>
            ${tshirtRows.length}
          </strong>
        </div>


        <div class="list-row">
          <span>
            登録済みSKU
          </span>

          <strong>
            ${tshirtRegistered.length}
          </strong>
        </div>


        <div class="list-row">
          <span>
            登録済み在庫0
          </span>

          <strong>
            ${tshirtSoldOut.length}
          </strong>
        </div>


        ${
          tshirtUnregistered.length
            ? `
              <div class="list-row">
                <span>
                  未登録の在庫SKU
                </span>

                <strong>
                  ${tshirtUnregistered.length}
                </strong>
              </div>

              <button
                id="syncTshirtCatalogButton"
                class="button"
                type="button"
                style="
                  width:100%;
                  margin-top:14px;
                "
              >
                現在在庫のTシャツSKUを商品登録
              </button>

              <div
                id="syncTshirtCatalogMessage"
                class="muted"
                style="margin-top:10px;"
              ></div>
            `
            : `
              <div
                class="muted"
                style="margin-top:12px;"
              >
                現在在庫のTシャツSKUはすべて登録済みです。
              </div>
            `
        }

      </section>


      <section class="card">

        <div class="card-title">
          アクセサリー
        </div>


        <div class="list-row">
          <span>
            現在在庫
          </span>

          <strong>
            ${accessoryCatalog.summary.totalStock}
          </strong>
        </div>


        <div class="list-row">
          <span>
            在庫ありSKU
          </span>

          <strong>
            ${accessoryRows.length}
          </strong>
        </div>


        <div class="list-row">
          <span>
            登録済みSKU
          </span>

          <strong>
            ${accessoryRegistered.length}
          </strong>
        </div>


        <div class="list-row">
          <span>
            登録済み在庫0
          </span>

          <strong>
            ${accessorySoldOut.length}
          </strong>
        </div>


        ${
          accessoryUnregistered.length
            ? `
              <div class="list-row">
                <span>
                  未登録の在庫SKU
                </span>

                <strong>
                  ${accessoryUnregistered.length}
                </strong>
              </div>

              <button
                id="syncAccessoryCatalogButtonInventory"
                class="button"
                type="button"
                style="
                  width:100%;
                  margin-top:14px;
                "
              >
                現在在庫のアクセサリーSKUを商品登録
              </button>

              <div
                id="syncAccessoryCatalogMessageInventory"
                class="muted"
                style="margin-top:10px;"
              ></div>
            `
            : `
              <div
                class="muted"
                style="margin-top:12px;"
              >
                現在在庫のアクセサリーSKUはすべて登録済みです。
              </div>
            `
        }


        <div
          style="
            margin-top:14px;
            padding-top:12px;
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
                      row.quantity || 0
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
                      ${
                        categoryRegisteredCount(
                          category.id
                        )
                      }
                      SKU
                    </span>
                  </span>

                </div>
              `;
            }
          ).join("")}

        </div>

      </section>


      ${
        accessoryRows.length
          ? `
            <section class="card">

              <div class="card-title">
                Accessory Current Stock
              </div>


              ${accessoryRows.map(
                row => `
                  <div class="list-row">

                    <div>

                      <div
                        style="
                          font-weight:700;
                          margin-bottom:4px;
                        "
                      >
                        ${escapeHtml(
                          row.displayName
                        )}
                      </div>

                      <div class="muted">
                        ${escapeHtml(
                          row.categoryLabel
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
                          font-size:20px;
                          font-weight:800;
                        "
                      >
                        ${row.quantity}
                      </div>

                      <div class="muted">
                        ${
                          accessoryRegisteredMap.has(
                            row.variantId
                          )
                            ? "登録済み"
                            : "未登録"
                        }
                      </div>

                    </div>

                  </div>
                `
              ).join("")}

            </section>
          `
          : ""
      }


      <section class="card">

        <div class="card-title">
          T Shirt Current Stock
        </div>


        ${tshirtRows.map(
          row => `
            <div class="list-row">

              <div>

                <div
                  style="
                    font-weight:700;
                    margin-bottom:4px;
                  "
                >
                  ${escapeHtml(
                    row.design
                  )}
                </div>

                <div class="muted">
                  ${escapeHtml(
                    row.body
                  )}
                  /
                  ${escapeHtml(
                    row.color
                  )}
                  /
                  ${escapeHtml(
                    row.size
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
                    font-size:20px;
                    font-weight:800;
                  "
                >
                  ${row.quantity}
                </div>

                <div class="muted">
                  ${
                    tshirtRegisteredMap.has(
                      row.variantId
                    )
                      ? "登録済み"
                      : "未登録"
                  }
                </div>

              </div>

            </div>
          `
        ).join("")}

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
    const [tshirtOptions, accessoryCatalog, allVariants] = await Promise.all([
      tshirtAdapter.getMasterOptions(),
      accessoryAdapter.getCatalogSnapshot(),
      listAllProductVariants()
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

      <section class="card">
        <div class="card-title">Tシャツ SKU追加</div>

        <div class="muted" style="margin-bottom:14px;">
          在庫0でも実際に販売する組み合わせだけ登録します。
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
      </section>

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
              item.grossLineTotal ||
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

              const categories =
                categorySalesSummary(
                  sessionTransactions
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
                                            値引
                                            ${formatMoney(
                                              transaction.discount,
                                              transaction.currency
                                            )}
                                          </div>
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

function posCartTotals() {
  let subtotal = 0;
  let quantity = 0;

  posCart.forEach(
    item => {
      quantity +=
        Number(
          item.quantity || 0
        );

      subtotal +=
        Number(
          item.quantity || 0
        ) *
        Number(
          item.unitPrice || 0
        );
    }
  );

  const discount =
    Math.max(
      0,
      Math.min(
        Number(
          posOrderDiscount || 0
        ),
        subtotal
      )
    );

  return {
    quantity,
    subtotal,
    discount,
    total:
      Math.max(
        0,
        subtotal -
        discount
      )
  };
}

function addQuickItem(
  category
) {
  invalidatePendingCheckout();

  const price =
    posPrice(
      category
    );

  if (
    price <= 0
  ) {
    return false;
  }

  const existing =
    posCart.get(
      category
    );

  if (existing) {
    existing.quantity += 1;
  } else {
    posCart.set(
      category,
      {
        key:
          category,
        category,
        label:
          POS_CATEGORY_LABELS[
            category
          ] ||
          category,
        quantity:
          1,
        unitPrice:
          price,
        trackingMode:
          "quick"
      }
    );
  }

  return true;
}

function changeQuickQuantity(
  category,
  change
) {
  invalidatePendingCheckout();

  const item =
    posCart.get(
      category
    );

  if (!item) {
    return;
  }

  item.quantity =
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
    item.quantity <= 0
  ) {
    posCart.delete(
      category
    );
  }
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
      posPriceBook =
        await loadQuickPriceBook();

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

    if (
      sequence !==
      renderSequence
    ) {
      return;
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

            <p
              class="page-note"
              style="margin:0;"
            >
              Quick
            </p>
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

            <button
              id="togglePosPriceSettings"
              class="button button-secondary"
              type="button"
              style="
                min-height:38px;
                padding:0 14px;
              "
            >
              ${
                posPriceSettingsOpen
                  ? "価格設定を閉じる"
                  : "価格設定"
              }
            </button>
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
            ${POS_CATEGORY_ORDER.map(
              category => {
                const price =
                  posPrice(
                    category
                  );

                const cartQty =
                  posCart
                    .get(
                      category
                    )
                    ?.quantity || 0;

                return `
                  <button
                    type="button"
                    class="posQuickCategory"
                    data-category="${category}"
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
                        POS_CATEGORY_LABELS[
                          category
                        ]
                      )}
                    </div>

                    <div
                      class="muted"
                      style="
                        margin-top:9px;
                        font-size:14px;
                      "
                    >
                      ${
                        price > 0
                          ? formatMoney(
                              price
                            )
                          : "価格未設定"
                      }
                    </div>
                  </button>
                `;
              }
            ).join("")}
          </div>

        </section>


        <section
          id="posPriceSettings"
          class="card"
          style="
            ${
              posPriceSettingsOpen
                ? ""
                : "display:none;"
            }
          "
        >

          <div class="card-title">
            ${posCurrency} Quick価格
          </div>

          <div
            class="muted"
            style="margin-bottom:12px;"
          >
            会計前に設定しておくと、会計中は商品をタップするだけで追加できます。
          </div>


          <div
            style="
              display:grid;
              gap:10px;
            "
          >
            ${POS_CATEGORY_ORDER.map(
              category => `
                <label
                  style="
                    display:grid;
                    grid-template-columns:
                      minmax(0,1fr)
                      120px;
                    gap:10px;
                    align-items:center;
                  "
                >
                  <span>
                    ${escapeHtml(
                      POS_CATEGORY_LABELS[
                        category
                      ]
                    )}
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
                      min-height:44px;
                      padding:0 10px;
                      border:1px solid #deded9;
                      border-radius:10px;
                      text-align:right;
                    "
                  >
                </label>
              `
            ).join("")}
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

        </section>


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

                        <div
                          class="muted"
                          style="
                            margin-top:3px;
                          "
                        >
                          ${formatMoney(
                            item.unitPrice
                          )}
                        </div>
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
                          data-category="${item.category}"
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
                          data-category="${item.category}"
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
                        ${formatMoney(
                          item.quantity *
                          item.unitPrice
                        )}
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


            <label
              class="list-row"
              style="
                align-items:center;
              "
            >
              <span>
                会計値引
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
            Quick会計ではカテゴリ単位で売上を記録します。SKU未指定のため在庫は自動で減らさず、棚卸し時に照合できる未割当の販売履歴として残します。
          </div>

        </section>
      `;


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

                const success =
                  addQuickItem(
                    category
                  );

                if (!success) {
                  posPriceSettingsOpen =
                    true;

                  renderPosBody(
                    `${POS_CATEGORY_LABELS[category]} の ${posCurrency} 価格を先に設定してください。`
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
                changeQuickQuantity(
                  button.dataset.category,
                  Number(
                    button.dataset.change ||
                    0
                  )
                );

                renderPosBody();
              }
            );
          }
        );


      document
        .querySelector(
          "#togglePosPriceSettings"
        )
        ?.addEventListener(
          "click",
          () => {
            posPriceSettingsOpen =
              !posPriceSettingsOpen;

            renderPosBody();

            if (
              posPriceSettingsOpen
            ) {
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
            }
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

            button.disabled =
              true;

            button.textContent =
              "保存中";

            try {
              await saveQuickPrices(
                posCurrency,
                prices
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
                  }
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
                      item => ({
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
                          "quick",
                        variantId:
                          null,
                        inventoryKey:
                          null
                      })
                    ),

                  orderDiscount:
                    posOrderDiscount,

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
