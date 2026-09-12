const CACHE_NAME =
  "icelolly-sales-shell-20260912-set-price-hotfix-1";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./css/app.css",
  "./css/responsive.css",

  "./js/app.js",
  "./js/firebase.js",
  "./js/auth.js",
  "./js/views/dashboardView.js",

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
  "./js/services/eventCloseService.js",
  "./js/services/offlineQueueService.js",
  "./js/services/stripePaymentService.js",
  "./stripe-result.html"
];


self.addEventListener(
  "install",
  event => {
    self.skipWaiting();

    event.waitUntil(
      (async () => {
        const cache =
          await caches.open(
            CACHE_NAME
          );

        for (
          const asset of
          CORE_ASSETS
        ) {
          try {
            await cache.add(
              asset
            );
          } catch (error) {
            /*
             * Do not abort the whole install if an optional module is
             * temporarily unavailable. Runtime caching will pick it up later.
             */
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
        const keys =
          await caches.keys();

        await Promise.all(
          keys
            .filter(
              key =>
                key.startsWith(
                  "icelolly-sales-shell-"
                ) &&
                key !==
                  CACHE_NAME
            )
            .map(
              key =>
                caches.delete(
                  key
                )
            )
        );

        await self.clients.claim();
      })()
    );
  }
);


self.addEventListener(
  "fetch",
  event => {
    const request =
      event.request;

    if (
      request.method !==
      "GET"
    ) {
      return;
    }

    const url =
      new URL(
        request.url
      );

    const shouldCache =
      url.origin ===
        self.location.origin ||
      url.hostname ===
        "www.gstatic.com";

    if (!shouldCache) {
      return;
    }

    event.respondWith(
      (async () => {
        const cache =
          await caches.open(
            CACHE_NAME
          );

        try {
          const response =
            await fetch(
              request
            );

          if (
            response &&
            (
              response.ok ||
              response.type ===
                "opaque"
            )
          ) {
            cache.put(
              request,
              response.clone()
            );
          }

          return response;

        } catch (error) {
          const cached =
            await cache.match(
              request,
              {
                ignoreSearch:
                  true
              }
            );

          if (cached) {
            return cached;
          }

          if (
            request.mode ===
            "navigate"
          ) {
            const shell =
              await cache.match(
                "./index.html",
                {
                  ignoreSearch:
                    true
                }
              );

            if (shell) {
              return shell;
            }
          }

          throw error;
        }
      })()
    );
  }
);
