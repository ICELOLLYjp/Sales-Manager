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
  document.querySelector("#view");


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


function escapeHtml(value) {

  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
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
    .forEach(btn => {

      btn.classList.toggle(
        "active",
        btn.dataset.route ===
          currentRoute
      );
    });
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

      button.disabled = true;

      button.textContent =
        "ログイン中";


      authError = null;


      try {

        await loginWithGoogle();

      } catch (error) {

        console.error(
          "Login failed",
          error
        );


        authError = error;

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


async function renderInventory(
  sequence
) {

  view.innerHTML = `

    <h1 class="page-title">
      Inventory
    </h1>

    <p class="page-note">
      Tシャツ実在庫を読み込んでいます
    </p>

    <section class="card">

      <div class="muted">
        tshirtStock/master に接続しています
      </div>

    </section>
  `;


  try {

    const [
      summary,
      rows
    ] = await Promise.all([

      tshirtAdapter
        .getMasterSummary(),

      tshirtAdapter
        .listInventoryRows()
    ]);


    if (
      sequence !==
      renderSequence
    ) {
      return;
    }


    const authorityWarning =
      summary.inventoryAuthority ===
      "master"
        ? ""
        : `
          <div class="warning">
            inventoryAuthority が master ではありません。
            在庫の書き込みは行いません。
          </div>
        `;


    view.innerHTML = `

      <h1 class="page-title">
        Inventory
      </h1>

      <p class="page-note">
        Tシャツ実在庫
      </p>


      ${authorityWarning}


      <div class="grid grid-2">

        <section class="card">

          <div class="metric">
            ${summary.total}
          </div>

          <div class="metric-label">
            T Shirt Stock
          </div>

        </section>


        <section class="card">

          <div class="metric">
            ${summary.skuCount}
          </div>

          <div class="metric-label">
            Active SKU
          </div>

        </section>

      </div>


      <section class="card">

        <div class="card-title">
          Source
        </div>

        <div class="code-note">
          ${escapeHtml(
            summary.source
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
          T Shirt Inventory
        </div>


        ${
          rows.length
            ? rows.map(
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
                        font-size:20px;
                        font-weight:800;
                        min-width:36px;
                        text-align:right;
                      "
                    >
                      ${row.quantity}
                    </div>

                  </div>

                `
              ).join("")
            : `
              <div class="muted">
                在庫のあるSKUはありません。
              </div>
            `
        }

      </section>


      <section class="card">

        <div class="card-title">
          Phase 1 Safety
        </div>

        <div class="muted">
          現在は読み取り専用です。
          Sales ManagerからTシャツ在庫の数量変更はまだ行いません。
        </div>

      </section>
    `;


    syncStatus.textContent =
      "Firebase";

  } catch (error) {

    console.error(
      "T-shirt inventory load failed",
      error
    );


    view.innerHTML = `

      <h1 class="page-title">
        Inventory
      </h1>

      <p class="page-note">
        Tシャツ実在庫
      </p>


      <div class="warning">

        Tシャツ在庫を読み込めませんでした。

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


        <div
          class="list-row"
        >

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

  currentRoute = route;

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

      currentUser = user;

      authError = error;


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
