import { initFirebase } from "./firebase.js";
import { initAuth, loginWithGoogle, logout } from "./auth.js";
import { renderDashboard } from "./views/dashboardView.js";
import { tshirtAdapter } from "./inventoryAdapters/tshirtAdapter.js";
import { accessoryAdapter } from "./inventoryAdapters/accessoryAdapter.js";
import { loadTshirtProductVariants, syncTshirtCurrentStockRows } from "./services/catalogService.js";
import { listAllProductVariants, registerTshirtVariant, registerGeneralProduct, syncAccessoryCatalogRows } from "./services/productAdminService.js";
import { CATEGORY_TEMPLATES, getCategoryTemplate } from "./data/categoryTemplates.js";

const view = document.querySelector("#view");
const syncStatus = document.querySelector("#syncStatus");

let firebaseState = null;
let currentUser = null;
let authError = null;
let currentRoute = "dashboard";
let renderSequence = 0;

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
    view.innerHTML = simplePage(
      "Sessions",
      "Event / Consignment / Wholesale"
    );

  } else if (route === "pos") {
    view.innerHTML = simplePage(
      "EVENT POS",
      "Quick / Semi / Full SKU"
    );

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
