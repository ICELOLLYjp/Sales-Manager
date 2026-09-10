import { initFirebase } from "./firebase.js";
import { renderDashboard } from "./views/dashboardView.js";
import { renderMore } from "./views/moreView.js";

const view = document.querySelector("#view");
const syncStatus = document.querySelector("#syncStatus");

const firebaseState = await initFirebase();

syncStatus.textContent = firebaseState.enabled ? "Firebase" : "Local";

function simplePage(title, note) {
  return `
    <h1 class="page-title">${title}</h1>
    <p class="page-note">${note}</p>
    <section class="card">
      <div class="card-title">Coming next</div>
      <div class="muted">この画面は次のPhaseで実装します。</div>
    </section>
  `;
}

function render(route) {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.route === route);
  });

  if (route === "dashboard") {
    view.innerHTML = renderDashboard({ firebaseEnabled: firebaseState.enabled });
  } else if (route === "more") {
    view.innerHTML = renderMore();
  } else if (route === "sessions") {
    view.innerHTML = simplePage("Sessions", "Event / Consignment / Wholesale");
  } else if (route === "pos") {
    view.innerHTML = simplePage("EVENT POS", "Quick / Semi / Full SKU");
  } else if (route === "inventory") {
    view.innerHTML = simplePage("Inventory", "Current stock / Movements / Stock Count");
  }
}

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => render(btn.dataset.route));
});

render("dashboard");
