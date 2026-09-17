const CACHE_NAME =
  "icelolly-sales-shell-20260917-expense-overview-1";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./gmail-connect.html",
  "./gmail-expenses.html",
  "./gmail-expense-review.html",
  "./expense-management.html",
  "./css/app.css",
  "./css/responsive.css",
  "./css/iphoneInventoryControls.css",

  "./js/app.js",
  "./js/quickAllocationUi.js",
  "./js/unidentifiedFinalizeUi.js",
  "./js/eventCloseHubUi.js",
  "./js/eventPendingInventoryCloseUi.js",
  "./js/eventFlowCloseUiCompat.js",
  "./js/eventCheckpointReuseUi.js",
  "./js/eventCloseStageUi.js",
  "./js/sessionStatusUi.js",
  "./js/firebase.js",
  "./js/auth.js",
  "./js/views/dashboardView.js",
  "./js/inventoryFlowPanel.js",
  "./js/eventDailyCloseUi.js",
  "./js/eventDailyInventoryTrendUi.js",
  "./js/inventoryFlowAccessoryUi.js",
  "./js/inventoryFlowAccessoryCleanup.js",
  "./js/eventUnregisteredItemsUi.js",
  "./js/eventLateSkuResolutionUi.js",
  "./js/eventLateSkuResolutionSessionsUi.js",
  "./js/posUxEnhancements.js",
  "./js/fastPosUi.js",
  "./js/fastPosModeEnhancement.js",
  "./js/fastPosSessionEnhancement.js",
  "./js/transactionHistorySearch.js",
  "./js/tshirtSalesAggregationUi.js",
  "./js/fastAmountAllocationUi.js",
  "./js/expenseManagementNavigation.js",
  "./js/gmailExpenseSourceLinkUi.js",
  "./js/expenseManagementOverview.js",
  "./js/expenseOverviewModel.js",

  "./js/inventoryAdapters/tshirtAdapter.js",
  "./js/inventoryAdapters/accessoryAdapter.js",

  "./js/data/categoryTemplates.js",

  "./js/services/catalogService.js",
  "./js/services/productAdminService.js",
  "./js/services/priceBookService.js",
  "./js/services/sessionService.js",
  "./js/services/transactionService.js",
  "./js/services/salesHistoryService.js",
  "./js/services/costHistoryService.js",
  "./js/services/pinkoiCatalogService.js",
  "./js/services/sessionLifecycleService.js",
  "./js/services/inventoryCountService.js",
  "./js/services/inventoryFlowService.js",
  "./js/services/inventoryFlowFinalizeService.js",
  "./js/services/eventFlowAccountingService.js",
  "./js/services/accessoryEventCatalogService.js",
  "./js/services/eventCheckpointReuseService.js",
  "./js/services/eventCheckpointReuseServiceV2.js",
  "./js/services/eventDailyCloseService.js",
  "./js/services/eventDailyInventoryTrendService.js",
  "./js/services/eventUnregisteredItemService.js",
  "./js/services/eventLateSkuResolutionService.js",
  "./js/services/eventLateSkuResolutionSessionService.js",
  "./js/services/closeWithPendingInventoryService.js",
  "./js/services/eventCloseService.js",
  "./js/services/eventCloseServiceCompat.js",
  "./js/services/eventCloseFlowCompatService.js",
  "./js/services/unidentifiedQuickService.js",
  "./js/services/closeWithUnidentifiedService.js",
  "./js/services/provisionalWithoutCountService.js",
  "./js/services/offlineQueueService.js",
  "./js/services/stripePaymentService.js",
  "./js/services/fastAmountSaleService.js",
  "./js/services/fastAmountAllocationService.js",
  "./js/services/salesAggregationService.js",
  "./js/services/gmailExpensePostingService.js",
  "./stripe-result.html"
];

self.addEventListener(
  "install",
  event => {
    self.skipWaiting();
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        for (const asset of CORE_ASSETS) {
          try {
            await cache.add(asset);
          } catch (error) {
            /* Optional/runtime assets must not abort the install. */
          }
        }
      })()
    );
  }
);

self.addEventListener(
  "activate",
  event => {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter(key => key.startsWith("icelolly-sales-shell-") && key !== CACHE_NAME)
            .map(key => caches.delete(key))
        );
        await self.clients.claim();
      })()
    );
  }
);

self.addEventListener(
  "fetch",
  event => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    const shouldCache =
      url.origin === self.location.origin ||
      url.hostname === "www.gstatic.com";

    if (!shouldCache) return;

    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const response = await fetch(request);
          if (response && (response.ok || response.type === "opaque")) {
            cache.put(request, response.clone());
          }
          return response;
        } catch (error) {
          const cached = await cache.match(request, { ignoreSearch: true });
          if (cached) return cached;
          if (request.mode === "navigate") {
            const shell = await cache.match("./index.html", { ignoreSearch: true });
            if (shell) return shell;
          }
          throw error;
        }
      })()
    );
  }
);
