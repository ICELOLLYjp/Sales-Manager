import {
  initFirebase
} from "./firebase.js";


import {
  initAuth,
  loginWithGoogle,
  logout
} from "./auth.js";


import {
  renderDashboard
} from "./views/dashboardView.js";


import {
  renderMore
} from "./views/moreView.js";


import {
  tshirtAdapter
} from "./inventoryAdapters/tshirtAdapter.js";


const view =
  document.querySelector(
    "#view"
  );


const syncStatus =
  document.querySelector(
    "#syncStatus"
  );


let firebaseState = null;

let currentUser = null;

let authError = null;

let currentRoute =
  "dashboard";

let renderSequence = 0;


function escapeHtml(
  value
) {

  return String(
    value ?? ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}


function updateNavigation() {

  document
    .querySelectorAll(
      ".nav-btn"
    )
    .forEach(
      btn => {

        btn.classList.toggle(
          "active",
          btn.dataset.route ===
            currentRoute
        );
      }
    );
}


function renderLogin() {

  updateNavigation();


  syncStatus.textContent =
    "Login";


  view.innerHTML = `

    <div
      style="
        max-width:420px;
        margin:40px auto;
      "
    >

      <section class="card">

        <h1
          class="page-title"
          style="margin-top:0;"
        >
          ICELOLLY
        </h1>

        <p class="page-note">
          Sales Manager
        </p>


        <div
          style="
            margin:24px 0;
            line-height:1.7;
            font-size:14px;
          "
        >
          ICELOLLYの管理アカウントでログインしてください。
        </div>


        ${
          authError
            ? `
              <div class="warning">
                ${escapeHtml(
                  authError.message ||
                  authError
                )}
              </div>
            `
            : ""
        }


        <button
          id="googleLoginButton"
          class="button"
          style="width:100%;"
          type="button"
        >
          Googleでログイン
        </button>

      </section>

    </div>
  `;


  const button =
    document.querySelector(
      "#googleLoginButton"
    );


  button?.addEventListener(
    "click",
    async () => {

      button.disabled =
        true;


      button.textContent =
        "ログイン中";


      authError =
        null;


      try {

        await loginWithGoogle();

      } catch (error) {

        console.error(
          "Login failed",
          error
        );


        authError =
          error;


        renderLogin();
      }
    }
  );
}


function simplePage(
  title,
  note
) {

  return `

    <h1 class="page-title">
      ${escapeHtml(title)}
    </h1>

    <p class="page-note">
      ${escapeHtml(note)}
    </p>

    <section class="card">

      <div class="card-title">
        Coming next
      </div>

      <div class="muted">
        この画面は次のPhaseで実装します。
      </div>

    </section>
  `;
}


function uniqueValues(
  rows,
  field
) {

  return Array
    .from(
      new Set(
        rows
          .map(
            row =>
              row?.[field]
          )
          .filter(Boolean)
      )
    )
    .sort(
      (
        a,
        b
      ) =>
        String(a)
          .localeCompare(
            String(b),
            "ja"
          )
    );
}


function optionHtml(
  values
) {

  return values
    .map(
      value => `

        <option
          value="${escapeHtml(value)}"
        >
          ${escapeHtml(value)}
        </option>
      `
    )
    .join("");
}


async function renderInventory(
  sequence
) {

  view.innerHTML = `

    <h1 class="page-title">
      Inventory
    </h1>

    <p class="page-note">
      Tシャツ商品カタログを読み込んでいます
    </p>

    <section class="card">

      <div class="muted">
        tshirtStock/master と tshirtStock/shared に接続しています
      </div>

    </section>
  `;


  try {

    const snapshot =
      await tshirtAdapter
        .getCatalogSnapshot();


    if (
      sequence !==
      renderSequence
    ) {
      return;
    }


    const summary =
      snapshot.summary;


    const rows =
      snapshot.rows;


    const bodyOptions =
      uniqueValues(
        rows,
        "body"
      );


    const designOptions =
      uniqueValues(
        rows,
        "design"
      );


    const colorOptions =
      uniqueValues(
        rows,
        "color"
      );


    const authorityWarning =
      summary.inventoryAuthority ===
      "master"
        ? ""
        : `
          <div class="warning">
            inventoryAuthority が master ではありません。
            在庫変更は行いません。
          </div>
        `;


    view.innerHTML = `

      <h1 class="page-title">
        Inventory
      </h1>

      <p class="page-note">
        Tシャツ商品カタログ
      </p>


      ${authorityWarning}


      <div class="grid grid-2">

        <section class="card">

          <div class="metric">
            ${summary.totalStock}
          </div>

          <div class="metric-label">
            T Shirt Stock
          </div>

        </section>


        <section class="card">

          <div class="metric">
            ${summary.inStockSkuCount}
          </div>

          <div class="metric-label">
            In Stock SKU
          </div>

        </section>


        <section class="card">

          <div class="metric">
            ${summary.catalogSkuCount}
          </div>

          <div class="metric-label">
            Catalog SKU
          </div>

        </section>


        <section class="card">

          <div class="metric">
            ${summary.outOfStockSkuCount}
          </div>

          <div class="metric-label">
            Out of Stock SKU
          </div>

        </section>

      </div>


      <section class="card">

        <div class="card-title">
          Source
        </div>


        <div class="code-note">
          ${escapeHtml(
            summary.catalogSource
          )}
        </div>


        <div
          class="muted"
          style="margin-top:8px;"
        >

          Schema v${summary.schemaVersion}

          /

          Authority:
          ${escapeHtml(
            summary.inventoryAuthority ||
            "unknown"
          )}

        </div>

      </section>


      <section class="card">

        <div class="card-title">
          Filter
        </div>


        <div
          style="
            display:grid;
            grid-template-columns:
              repeat(
                auto-fit,
                minmax(150px,1fr)
              );
            gap:10px;
          "
        >

          <input
            id="inventorySearch"
            type="text"
            placeholder="Search"
            style="
              width:100%;
              height:42px;
              padding:0 10px;
              border:1px solid #deded9;
              border-radius:10px;
              background:white;
            "
          >


          <select
            id="inventoryStatusFilter"
            style="
              width:100%;
              height:42px;
              padding:0 10px;
              border:1px solid #deded9;
              border-radius:10px;
              background:white;
            "
          >

            <option value="in_stock">
              在庫あり
            </option>

            <option value="all">
              すべて
            </option>

            <option value="out_of_stock">
              在庫0
            </option>

            <option value="not_initialized">
              在庫未設定
            </option>

          </select>


          <select
            id="inventoryBodyFilter"
            style="
              width:100%;
              height:42px;
              padding:0 10px;
              border:1px solid #deded9;
              border-radius:10px;
              background:white;
            "
          >

            <option value="">
              All Body
            </option>

            ${optionHtml(
              bodyOptions
            )}

          </select>


          <select
            id="inventoryDesignFilter"
            style="
              width:100%;
              height:42px;
              padding:0 10px;
              border:1px solid #deded9;
              border-radius:10px;
              background:white;
            "
          >

            <option value="">
              All Design
            </option>

            ${optionHtml(
              designOptions
            )}

          </select>


          <select
            id="inventoryColorFilter"
            style="
              width:100%;
              height:42px;
              padding:0 10px;
              border:1px solid #deded9;
              border-radius:10px;
              background:white;
            "
          >

            <option value="">
              All Color
            </option>

            ${optionHtml(
              colorOptions
            )}

          </select>

        </div>

      </section>


      <section class="card">

        <div
          style="
            display:flex;
            justify-content:space-between;
            gap:12px;
            align-items:center;
            margin-bottom:10px;
          "
        >

          <div class="card-title">
            T Shirt Catalog
          </div>


          <div
            id="inventoryResultCount"
            class="pill"
          ></div>

        </div>


        <div
          id="inventoryRows"
        ></div>

      </section>


      <section class="card">

        <div class="card-title">
          Catalog Connection
        </div>


        <div class="muted">

          各行には内部的に

          productId

          variantId

          stockTargetId

          Body

          Design

          Color

          Size

          が設定されています。

          次の段階で productVariants Collectionへ同期します。

        </div>

      </section>


      <section class="card">

        <div class="card-title">
          Safety
        </div>

        <div class="muted">
          現在は読み取り専用です。
          Sales Managerから在庫数量は変更しません。
        </div>

      </section>
    `;


    const searchInput =
      document.querySelector(
        "#inventorySearch"
      );


    const statusFilter =
      document.querySelector(
        "#inventoryStatusFilter"
      );


    const bodyFilter =
      document.querySelector(
        "#inventoryBodyFilter"
      );


    const designFilter =
      document.querySelector(
        "#inventoryDesignFilter"
      );


    const colorFilter =
      document.querySelector(
        "#inventoryColorFilter"
      );


    const resultCount =
      document.querySelector(
        "#inventoryResultCount"
      );


    const rowsBox =
      document.querySelector(
        "#inventoryRows"
      );


    function renderRows() {

      const search =
        String(
          searchInput?.value || ""
        )
          .trim()
          .toLocaleLowerCase(
            "en-US"
          );


      const status =
        statusFilter?.value ||
        "in_stock";


      const body =
        bodyFilter?.value || "";


      const design =
        designFilter?.value || "";


      const color =
        colorFilter?.value || "";


      const filtered =
        rows.filter(
          row => {

            if (
              status !== "all" &&
              row.catalogStatus !==
                status
            ) {
              return false;
            }


            if (
              body &&
              row.body !== body
            ) {
              return false;
            }


            if (
              design &&
              row.design !== design
            ) {
              return false;
            }


            if (
              color &&
              row.color !== color
            ) {
              return false;
            }


            if (search) {

              const haystack =
                [
                  row.body,
                  row.design,
                  row.color,
                  row.size,
                  row.variantId
                ]
                  .join(" ")
                  .toLocaleLowerCase(
                    "en-US"
                  );


              if (
                !haystack.includes(
                  search
                )
              ) {

                return false;
              }
            }


            return true;
          }
        );


      if (resultCount) {

        resultCount.textContent =
          `${filtered.length}`;
      }


      if (!rowsBox) {
        return;
      }


      if (
        !filtered.length
      ) {

        rowsBox.innerHTML = `

          <div class="muted">
            該当する商品はありません。
          </div>
        `;

        return;
      }


      rowsBox.innerHTML =
        filtered
          .map(
            row => {

              let quantityHtml =
                row.quantity;


              if (
                row.catalogStatus ===
                "not_initialized"
              ) {

                quantityHtml =
                  `<span class="muted">未設定</span>`;
              }


              return `

                <div class="list-row">

                  <div
                    style="
                      min-width:0;
                    "
                  >

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


                    ${
                      row.catalogStatus ===
                      "out_of_stock"
                        ? `
                          <div
                            class="muted"
                            style="
                              margin-top:4px;
                            "
                          >
                            Sold out
                          </div>
                        `
                        : ""
                    }

                  </div>


                  <div
                    style="
                      font-size:20px;
                      font-weight:800;
                      min-width:55px;
                      text-align:right;
                    "
                  >

                    ${quantityHtml}

                  </div>

                </div>
              `;
            }
          )
          .join("");
    }


    [
      searchInput,
      statusFilter,
      bodyFilter,
      designFilter,
      colorFilter
    ].forEach(
      element => {

        element?.addEventListener(
          "input",
          renderRows
        );


        element?.addEventListener(
          "change",
          renderRows
        );
      }
    );


    renderRows();


    syncStatus.textContent =
      "Firebase";


  } catch (error) {

    console.error(
      "T-shirt catalog load failed",
      error
    );


    view.innerHTML = `

      <h1 class="page-title">
        Inventory
      </h1>


      <p class="page-note">
        Tシャツ商品カタログ
      </p>


      <div class="warning">

        Tシャツ商品カタログを読み込めませんでした。

        <br><br>

        ${escapeHtml(
          error.code ||
          error.message ||
          error
        )}

      </div>


      <section class="card">

        <div class="card-title">
          Source
        </div>

        <div class="code-note">
          tshirtStock/master
          +
          tshirtStock/shared
        </div>

      </section>
    `;


    syncStatus.textContent =
      "Error";
  }
}


function renderMorePage() {

  view.innerHTML =
    renderMore() +

    `

      <section class="card">

        <div class="card-title">
          Account
        </div>


        <div class="list-row">

          <span>
            Google
          </span>

          <span class="muted">
            ${escapeHtml(
              currentUser?.email || ""
            )}
          </span>

        </div>


        <button
          id="logoutButton"
          type="button"
          class="button button-secondary"
          style="
            width:100%;
            margin-top:12px;
          "
        >
          ログアウト
        </button>

      </section>
    `;


  document
    .querySelector(
      "#logoutButton"
    )
    ?.addEventListener(
      "click",
      async () => {

        await logout();
      }
    );
}


async function render(
  route = currentRoute
) {

  currentRoute =
    route;


  const sequence =
    ++renderSequence;


  updateNavigation();


  if (
    firebaseState?.enabled &&
    !currentUser
  ) {

    renderLogin();

    return;
  }


  if (
    route ===
    "dashboard"
  ) {

    view.innerHTML =
      renderDashboard({
        firebaseEnabled:
          firebaseState?.enabled
      });


  } else if (
    route ===
    "sessions"
  ) {

    view.innerHTML =
      simplePage(
        "Sessions",
        "Event / Consignment / Wholesale"
      );


  } else if (
    route ===
    "pos"
  ) {

    view.innerHTML =
      simplePage(
        "EVENT POS",
        "Quick / Semi / Full SKU"
      );


  } else if (
    route ===
    "inventory"
  ) {

    await renderInventory(
      sequence
    );


  } else if (
    route ===
    "more"
  ) {

    renderMorePage();
  }
}


document
  .querySelectorAll(
    ".nav-btn"
  )
  .forEach(
    btn => {

      btn.addEventListener(
        "click",
        () => {

          render(
            btn.dataset.route
          );
        }
      );
    }
  );


async function start() {

  firebaseState =
    await initFirebase();


  if (
    !firebaseState.enabled
  ) {

    syncStatus.textContent =
      "Local";


    render(
      "dashboard"
    );


    return;
  }


  syncStatus.textContent =
    "Login";


  await initAuth(
    (
      user,
      error
    ) => {

      currentUser =
        user;


      authError =
        error;


      if (user) {

        syncStatus.textContent =
          "Firebase";

      } else {

        syncStatus.textContent =
          "Login";
      }


      render(
        currentRoute
      );
    }
  );
}


start();
