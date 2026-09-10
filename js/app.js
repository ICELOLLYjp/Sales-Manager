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


import {
  loadTshirtProductVariants,
  syncTshirtCurrentStockRows
} from "./services/catalogService.js";


const view =
  document.querySelector(
    "#view"
  );


const syncStatus =
  document.querySelector(
    "#syncStatus"
  );


let firebaseState =
  null;

let currentUser =
  null;

let authError =
  null;

let currentRoute =
  "dashboard";

let renderSequence =
  0;


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


  document
    .querySelector(
      "#googleLoginButton"
    )
    ?.addEventListener(
      "click",
      async () => {

        try {

          await loginWithGoogle();

        } catch (error) {

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

      <div class="muted">
        この画面は次のPhaseで実装します。
      </div>

    </section>
  `;
}


async function renderInventory(
  sequence
) {

  view.innerHTML = `

    <h1 class="page-title">
      Inventory
    </h1>

    <p class="page-note">
      読み込み中
    </p>
  `;


  try {

    const inventory =
      await tshirtAdapter
        .getInventorySnapshot();


    let registered = [];


    try {

      registered =
        await loadTshirtProductVariants();

    } catch (error) {

      console.warn(
        "productVariants read failed",
        error
      );
    }


    if (
      sequence !==
      renderSequence
    ) {

      return;
    }


    const rows =
      inventory.rows;


    const registeredMap =
      new Map(
        registered.map(
          item => [
            item.variantId ||
            item.id,
            item
          ]
        )
      );


    const currentIds =
      new Set(
        rows.map(
          row =>
            row.variantId
        )
      );


    const unregisteredRows =
      rows.filter(
        row =>
          !registeredMap.has(
            row.variantId
          )
      );


    const soldOutRegistered =
      registered.filter(
        item =>
          !currentIds.has(
            item.variantId ||
            item.id
          )
      );


    view.innerHTML = `

      <h1 class="page-title">
        Inventory
      </h1>

      <p class="page-note">
        Tシャツ商品カタログ
      </p>


      <div class="grid grid-2">

        <section class="card">

          <div class="metric">
            ${inventory.summary.totalStock}
          </div>

          <div class="metric-label">
            T Shirt Stock
          </div>

        </section>


        <section class="card">

          <div class="metric">
            ${inventory.summary.activeSkuCount}
          </div>

          <div class="metric-label">
            In Stock SKU
          </div>

        </section>


        <section class="card">

          <div class="metric">
            ${registered.length}
          </div>

          <div class="metric-label">
            Registered SKU
          </div>

        </section>


        <section class="card">

          <div class="metric">
            ${soldOutRegistered.length}
          </div>

          <div class="metric-label">
            Sold Out SKU
          </div>

        </section>

      </div>


      <section class="card">

        <div class="card-title">
          商品カタログ
        </div>


        <div class="list-row">

          <span>
            現在在庫SKU
          </span>

          <strong>
            ${rows.length}
          </strong>

        </div>


        <div class="list-row">

          <span>
            登録済みSKU
          </span>

          <strong>
            ${registered.length}
          </strong>

        </div>


        <div class="list-row">

          <span>
            未登録の在庫SKU
          </span>

          <strong>
            ${unregisteredRows.length}
          </strong>

        </div>


        <div class="list-row">

          <span>
            登録済み在庫0
          </span>

          <strong>
            ${soldOutRegistered.length}
          </strong>

        </div>


        ${
          unregisteredRows.length
            ? `

              <button
                id="syncTshirtCatalogButton"
                class="button"
                type="button"
                style="
                  width:100%;
                  margin-top:16px;
                "
              >
                現在在庫のSKUを商品登録
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
                現在在庫のSKUはすべて商品登録済みです。
              </div>
            `
        }

      </section>


      <section class="card">

        <div class="card-title">
          Current Stock
        </div>


        ${rows.map(
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
                    registeredMap.has(
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


      ${
        soldOutRegistered.length
          ? `

            <section class="card">

              <div class="card-title">
                Sold Out
              </div>


              ${soldOutRegistered.map(
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
                          row.design ||
                          ""
                        )}
                      </div>

                      <div class="muted">

                        ${escapeHtml(
                          row.body ||
                          ""
                        )}

                        /

                        ${escapeHtml(
                          row.color ||
                          ""
                        )}

                        /

                        ${escapeHtml(
                          row.size ||
                          ""
                        )}

                      </div>

                    </div>


                    <strong>
                      0
                    </strong>

                  </div>
                `
              ).join("")}

            </section>
          `
          : ""
      }


      <section class="card">

        <div class="card-title">
          Safety
        </div>

        <div class="muted">
          この処理は商品カタログを登録するだけです。
          tshirtStock/master の在庫数量は変更しません。
        </div>

      </section>
    `;


    const syncButton =
      document.querySelector(
        "#syncTshirtCatalogButton"
      );


    syncButton?.addEventListener(
      "click",
      async () => {

        const message =
          document.querySelector(
            "#syncTshirtCatalogMessage"
          );


        syncButton.disabled =
          true;


        syncButton.textContent =
          "登録中";


        if (message) {

          message.textContent =
            "";
        }


        try {

          const result =
            await syncTshirtCurrentStockRows(
              unregisteredRows
            );


          if (message) {

            message.textContent =
              `${result.processed} SKUを登録しました。`;
          }


          await renderInventory(
            ++renderSequence
          );


        } catch (error) {

          console.error(
            "Catalog sync failed",
            error
          );


          syncButton.disabled =
            false;


          syncButton.textContent =
            "現在在庫のSKUを商品登録";


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


function renderMorePage() {

  view.innerHTML =
    renderMore() +

    `

      <section class="card">

        <div class="card-title">
          Account
        </div>

        <div class="muted">
          ${escapeHtml(
            currentUser?.email ||
            ""
          )}
        </div>

        <button
          id="logoutButton"
          class="button button-secondary"
          type="button"
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
      logout
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
        () =>
          render(
            btn.dataset.route
          )
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


  await initAuth(
    (
      user,
      error
    ) => {

      currentUser =
        user;


      authError =
        error;


      syncStatus.textContent =
        user
          ? "Firebase"
          : "Login";


      render(
        currentRoute
      );
    }
  );
}


start();
