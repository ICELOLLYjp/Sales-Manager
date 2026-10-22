// P05 persisted synthetic observation; no runtime I/O.
export default {
  "accessoryStock/shared": {
    "keep": true,
    "inventoryRevision": 1,
    "inventoryWriteProtocol": 1,
    "designs": [
      {
        "id": "a",
        "piercing": 4,
        "earring": null
      },
      {
        "id": "other",
        "piercing": 8
      }
    ],
    "updatedAt": {
      "_seconds": 1791976867,
      "_nanoseconds": 538000000
    }
  },
  "inventoryMovements/sale_multi__1": {
    "movementId": "sale_multi__1",
    "transactionId": "sale_multi",
    "sessionId": "s",
    "type": "sale",
    "reason": "sale",
    "category": "tshirt",
    "label": "Shirt",
    "quantity": 1,
    "expectedInventoryDelta": -1,
    "appliedInventoryDelta": -1,
    "inventoryApplied": true,
    "eventInventoryApplied": true,
    "trackingMode": "sku",
    "variantId": "t",
    "inventoryKey": "tshirt:b|d|c|s",
    "inventorySource": "tshirt",
    "status": "applied",
    "createdAt": {
      "_seconds": 1791976867,
      "_nanoseconds": 538000000
    }
  },
  "inventoryMovements/sale_multi__2": {
    "movementId": "sale_multi__2",
    "transactionId": "sale_multi",
    "sessionId": "s",
    "type": "sale",
    "reason": "sale",
    "category": "tshirt",
    "label": "Shirt",
    "quantity": 2,
    "expectedInventoryDelta": -2,
    "appliedInventoryDelta": -2,
    "inventoryApplied": true,
    "eventInventoryApplied": true,
    "trackingMode": "sku",
    "variantId": "t",
    "inventoryKey": "tshirt:b|d|c|s",
    "inventorySource": "tshirt",
    "status": "applied",
    "createdAt": {
      "_seconds": 1791976867,
      "_nanoseconds": 538000000
    }
  },
  "inventoryMovements/sale_multi__3": {
    "movementId": "sale_multi__3",
    "transactionId": "sale_multi",
    "sessionId": "s",
    "type": "sale",
    "reason": "sale",
    "category": "pierce",
    "label": "pierce",
    "quantity": 1,
    "expectedInventoryDelta": -1,
    "appliedInventoryDelta": -1,
    "inventoryApplied": true,
    "eventInventoryApplied": true,
    "trackingMode": "sku",
    "variantId": "a",
    "inventoryKey": "accessory:a|piercing",
    "inventorySource": "accessory",
    "status": "applied",
    "createdAt": {
      "_seconds": 1791976867,
      "_nanoseconds": 538000000
    }
  },
  "productVariants/a": {
    "active": true,
    "category": "pierce",
    "inventorySource": "accessory",
    "inventoryKey": "accessory:a|piercing",
    "designId": "a"
  },
  "productVariants/t": {
    "active": true,
    "category": "tshirt",
    "inventorySource": "tshirt",
    "inventoryKey": "tshirt:b|d|c|s",
    "bodyId": "b",
    "designId": "d",
    "colorId": "c",
    "sizeId": "s",
    "displayName": "Shirt"
  },
  "productVariants/u": {
    "active": true,
    "category": "tshirt",
    "inventorySource": "tshirt",
    "inventoryKey": "tshirt:b|d|c|m",
    "bodyId": "b",
    "designId": "d",
    "colorId": "c",
    "sizeId": "m"
  },
  "salesSessions/s": {
    "status": "open",
    "currency": "JPY",
    "type": "event",
    "methodBSalesPolicyV1": {
      "version": 1,
      "currency": "JPY",
      "pricesByVariant": {
        "t": 3000,
        "u": 3000,
        "a": 1000
      }
    },
    "note": "keep",
    "salesSummary": {
      "grossSales": 10000,
      "setDiscount": 0,
      "lineDiscount": 0,
      "orderDiscount": 0,
      "discount": 0,
      "netSales": 10000,
      "grossSalesJPY": 10000,
      "setDiscountJPY": 0,
      "lineDiscountJPY": 0,
      "orderDiscountJPY": 0,
      "discountJPY": 0,
      "netSalesJPY": 10000,
      "transactionCount": 1,
      "itemCount": 4
    },
    "inventoryCount": {
      "opening": {
        "items": [
          {
            "variantId": "t",
            "openingQty": 4
          }
        ]
      },
      "flowEntries": [],
      "soldByVariant": {
        "t": 3,
        "a": 1
      },
      "salesUpdatedAt": {
        "_seconds": 1791976867,
        "_nanoseconds": 538000000
      }
    },
    "lastTransactionAt": {
      "_seconds": 1791976867,
      "_nanoseconds": 538000000
    },
    "updatedAt": {
      "_seconds": 1791976867,
      "_nanoseconds": 538000000
    }
  },
  "salesTransactions/sale_multi": {
    "transactionId": "sale_multi",
    "sessionId": "s",
    "sessionType": "event",
    "eventName": "",
    "country": "",
    "city": "",
    "mode": "sku",
    "currency": "JPY",
    "baseCurrency": "JPY",
    "fxRateToJPY": 1,
    "fxRateStatus": "set",
    "grossSales": 10000,
    "setDiscount": 0,
    "lineDiscount": 0,
    "orderDiscount": 0,
    "discount": 0,
    "netSales": 10000,
    "grossSalesJPY": 10000,
    "setDiscountJPY": 0,
    "lineDiscountJPY": 0,
    "orderDiscountJPY": 0,
    "discountJPY": 0,
    "netSalesJPY": 10000,
    "costSnapshotVersion": 2,
    "costSnapshotDate": "2026-10-14",
    "costSnapshotTotalJPY": 0,
    "costSnapshotCoveredQuantity": 0,
    "costSnapshotMissingQuantity": 4,
    "costSnapshotComplete": false,
    "itemCount": 4,
    "lineCount": 3,
    "items": [
      {
        "lineId": "1",
        "variantId": "t",
        "quantity": 1,
        "unitPrice": 3000,
        "setDiscount": 0,
        "manualDiscount": 0,
        "category": "tshirt",
        "label": "Shirt",
        "detail": "",
        "trackingMode": "sku",
        "tshirtBodyKey": "b",
        "bodyId": "b",
        "designId": "d",
        "colorId": "c",
        "sizeId": "s",
        "body": null,
        "design": null,
        "color": null,
        "size": null,
        "sku": null,
        "inventoryKey": "tshirt:b|d|c|s",
        "inventorySource": "tshirt",
        "grossLineTotal": 3000,
        "lineDiscountBeforeOrder": 0,
        "netBeforeOrder": 3000,
        "setOffer": {
          "quantity": 0,
          "price": 0
        },
        "orderDiscountAllocated": 0,
        "totalLineDiscount": 0,
        "netLineTotal": 3000,
        "inventoryApplied": true,
        "inventoryWarning": false,
        "inventoryQtyBefore": 5,
        "inventoryQtyAfter": 4,
        "reconciliationStatus": "reconciled",
        "eventInventoryApplied": true,
        "eventAvailableBefore": 4,
        "eventAvailableAfter": 3,
        "eventInventoryWarning": false,
        "costSnapshotCaptured": true,
        "unitCostJPY": null,
        "costSource": "missing",
        "costEffectiveFrom": null,
        "lineCostJPY": null
      },
      {
        "lineId": "2",
        "variantId": "t",
        "quantity": 2,
        "unitPrice": 3000,
        "setDiscount": 0,
        "manualDiscount": 0,
        "category": "tshirt",
        "label": "Shirt",
        "detail": "",
        "trackingMode": "sku",
        "tshirtBodyKey": "b",
        "bodyId": "b",
        "designId": "d",
        "colorId": "c",
        "sizeId": "s",
        "body": null,
        "design": null,
        "color": null,
        "size": null,
        "sku": null,
        "inventoryKey": "tshirt:b|d|c|s",
        "inventorySource": "tshirt",
        "grossLineTotal": 6000,
        "lineDiscountBeforeOrder": 0,
        "netBeforeOrder": 6000,
        "setOffer": {
          "quantity": 0,
          "price": 0
        },
        "orderDiscountAllocated": 0,
        "totalLineDiscount": 0,
        "netLineTotal": 6000,
        "inventoryApplied": true,
        "inventoryWarning": false,
        "inventoryQtyBefore": 4,
        "inventoryQtyAfter": 2,
        "reconciliationStatus": "reconciled",
        "eventInventoryApplied": true,
        "eventAvailableBefore": 3,
        "eventAvailableAfter": 1,
        "eventInventoryWarning": false,
        "costSnapshotCaptured": true,
        "unitCostJPY": null,
        "costSource": "missing",
        "costEffectiveFrom": null,
        "lineCostJPY": null
      },
      {
        "lineId": "3",
        "variantId": "a",
        "quantity": 1,
        "unitPrice": 1000,
        "setDiscount": 0,
        "manualDiscount": 0,
        "category": "pierce",
        "label": "pierce",
        "detail": "",
        "trackingMode": "sku",
        "tshirtBodyKey": null,
        "bodyId": null,
        "designId": "a",
        "colorId": null,
        "sizeId": null,
        "body": null,
        "design": null,
        "color": null,
        "size": null,
        "sku": null,
        "inventoryKey": "accessory:a|piercing",
        "inventorySource": "accessory",
        "grossLineTotal": 1000,
        "lineDiscountBeforeOrder": 0,
        "netBeforeOrder": 1000,
        "setOffer": {
          "quantity": 0,
          "price": 0
        },
        "orderDiscountAllocated": 0,
        "totalLineDiscount": 0,
        "netLineTotal": 1000,
        "inventoryApplied": true,
        "inventoryWarning": false,
        "inventoryQtyBefore": 5,
        "inventoryQtyAfter": 4,
        "reconciliationStatus": "reconciled",
        "eventInventoryApplied": true,
        "eventAvailableBefore": 0,
        "eventAvailableAfter": -1,
        "eventInventoryWarning": true,
        "costSnapshotCaptured": true,
        "unitCostJPY": null,
        "costSource": "missing",
        "costEffectiveFrom": null,
        "lineCostJPY": null
      }
    ],
    "eventInventoryMode": "flow_allocation",
    "inventoryWarnings": [
      {
        "type": "event_stock_negative",
        "variantId": "a",
        "availableBefore": 0,
        "requestedQuantity": 1,
        "projectedAfter": -1
      }
    ],
    "inventoryWarningCount": 1,
    "hasInventoryWarning": true,
    "inventoryMode": "allocated",
    "inventoryApplied": true,
    "reconciliationStatus": "reconciled",
    "paymentMethod": "manual",
    "paymentProvider": "",
    "providerPaymentIntentId": "",
    "providerCheckoutSessionId": "",
    "providerPaymentStatus": "",
    "status": "completed",
    "createdByEmail": "fixture-business@example.test",
    "createdAt": {
      "_seconds": 1791976867,
      "_nanoseconds": 538000000
    },
    "updatedAt": {
      "_seconds": 1791976867,
      "_nanoseconds": 538000000
    }
  },
  "transactionLocks/sale_multi": {
    "transactionId": "sale_multi",
    "sessionId": "s",
    "fingerprint": "{\"sessionId\":\"s\",\"currency\":\"JPY\",\"discount\":0,\"items\":[{\"category\":\"tshirt\",\"quantity\":1,\"unitPrice\":3000,\"setDiscount\":0,\"manualDiscount\":0,\"trackingMode\":\"sku\",\"variantId\":\"t\",\"tshirtBodyKey\":\"b\"},{\"category\":\"tshirt\",\"quantity\":2,\"unitPrice\":3000,\"setDiscount\":0,\"manualDiscount\":0,\"trackingMode\":\"sku\",\"variantId\":\"t\",\"tshirtBodyKey\":\"b\"},{\"category\":\"pierce\",\"quantity\":1,\"unitPrice\":1000,\"setDiscount\":0,\"manualDiscount\":0,\"trackingMode\":\"sku\",\"variantId\":\"a\",\"tshirtBodyKey\":null}]}",
    "status": "committed",
    "serverSaleV1": {
      "schema": "sale-server-v1",
      "canonicalRequest": {
        "version": 1,
        "transactionId": "sale_multi",
        "sessionId": "s",
        "currency": "JPY",
        "items": [
          {
            "lineId": "1",
            "variantId": "t",
            "quantity": 1,
            "unitPrice": 3000,
            "setDiscount": 0,
            "manualDiscount": 0
          },
          {
            "lineId": "2",
            "variantId": "t",
            "quantity": 2,
            "unitPrice": 3000,
            "setDiscount": 0,
            "manualDiscount": 0
          },
          {
            "lineId": "3",
            "variantId": "a",
            "quantity": 1,
            "unitPrice": 1000,
            "setDiscount": 0,
            "manualDiscount": 0
          }
        ],
        "orderDiscount": 0,
        "paymentMethod": "manual",
        "expectedContextHash": "af3c825f5a76cee990a98e360f4da22ab836462128cbe3a47b2ab15c097d7064"
      },
      "requestHash": "54675fc9eab905c764c3ba135cbc0974065385dd32fd98607f76089e4e115294",
      "actorUid": "fixture-business",
      "contextHash": "af3c825f5a76cee990a98e360f4da22ab836462128cbe3a47b2ab15c097d7064",
      "result": {
        "transactionId": "sale_multi",
        "currency": "JPY",
        "items": [
          {
            "lineId": "1",
            "variantId": "t",
            "quantity": 1,
            "unitPrice": 3000,
            "setDiscount": 0,
            "manualDiscount": 0,
            "category": "tshirt",
            "label": "Shirt",
            "detail": "",
            "trackingMode": "sku",
            "tshirtBodyKey": "b",
            "bodyId": "b",
            "designId": "d",
            "colorId": "c",
            "sizeId": "s",
            "body": null,
            "design": null,
            "color": null,
            "size": null,
            "sku": null,
            "inventoryKey": "tshirt:b|d|c|s",
            "inventorySource": "tshirt",
            "grossLineTotal": 3000,
            "lineDiscountBeforeOrder": 0,
            "netBeforeOrder": 3000,
            "setOffer": {
              "quantity": 0,
              "price": 0
            },
            "orderDiscountAllocated": 0,
            "totalLineDiscount": 0,
            "netLineTotal": 3000,
            "inventoryApplied": true,
            "inventoryWarning": false,
            "inventoryQtyBefore": 5,
            "inventoryQtyAfter": 4,
            "reconciliationStatus": "reconciled",
            "eventInventoryApplied": true,
            "eventAvailableBefore": 4,
            "eventAvailableAfter": 3,
            "eventInventoryWarning": false,
            "costSnapshotCaptured": true,
            "unitCostJPY": null,
            "costSource": "missing",
            "costEffectiveFrom": null,
            "lineCostJPY": null
          },
          {
            "lineId": "2",
            "variantId": "t",
            "quantity": 2,
            "unitPrice": 3000,
            "setDiscount": 0,
            "manualDiscount": 0,
            "category": "tshirt",
            "label": "Shirt",
            "detail": "",
            "trackingMode": "sku",
            "tshirtBodyKey": "b",
            "bodyId": "b",
            "designId": "d",
            "colorId": "c",
            "sizeId": "s",
            "body": null,
            "design": null,
            "color": null,
            "size": null,
            "sku": null,
            "inventoryKey": "tshirt:b|d|c|s",
            "inventorySource": "tshirt",
            "grossLineTotal": 6000,
            "lineDiscountBeforeOrder": 0,
            "netBeforeOrder": 6000,
            "setOffer": {
              "quantity": 0,
              "price": 0
            },
            "orderDiscountAllocated": 0,
            "totalLineDiscount": 0,
            "netLineTotal": 6000,
            "inventoryApplied": true,
            "inventoryWarning": false,
            "inventoryQtyBefore": 4,
            "inventoryQtyAfter": 2,
            "reconciliationStatus": "reconciled",
            "eventInventoryApplied": true,
            "eventAvailableBefore": 3,
            "eventAvailableAfter": 1,
            "eventInventoryWarning": false,
            "costSnapshotCaptured": true,
            "unitCostJPY": null,
            "costSource": "missing",
            "costEffectiveFrom": null,
            "lineCostJPY": null
          },
          {
            "lineId": "3",
            "variantId": "a",
            "quantity": 1,
            "unitPrice": 1000,
            "setDiscount": 0,
            "manualDiscount": 0,
            "category": "pierce",
            "label": "pierce",
            "detail": "",
            "trackingMode": "sku",
            "tshirtBodyKey": null,
            "bodyId": null,
            "designId": "a",
            "colorId": null,
            "sizeId": null,
            "body": null,
            "design": null,
            "color": null,
            "size": null,
            "sku": null,
            "inventoryKey": "accessory:a|piercing",
            "inventorySource": "accessory",
            "grossLineTotal": 1000,
            "lineDiscountBeforeOrder": 0,
            "netBeforeOrder": 1000,
            "setOffer": {
              "quantity": 0,
              "price": 0
            },
            "orderDiscountAllocated": 0,
            "totalLineDiscount": 0,
            "netLineTotal": 1000,
            "inventoryApplied": true,
            "inventoryWarning": false,
            "inventoryQtyBefore": 5,
            "inventoryQtyAfter": 4,
            "reconciliationStatus": "reconciled",
            "eventInventoryApplied": true,
            "eventAvailableBefore": 0,
            "eventAvailableAfter": -1,
            "eventInventoryWarning": true,
            "costSnapshotCaptured": true,
            "unitCostJPY": null,
            "costSource": "missing",
            "costEffectiveFrom": null,
            "lineCostJPY": null
          }
        ],
        "subtotal": 10000,
        "discount": 0,
        "netSales": 10000,
        "inventoryWarnings": [
          {
            "type": "event_stock_negative",
            "variantId": "a",
            "availableBefore": 0,
            "requestedQuantity": 1,
            "projectedAfter": -1
          }
        ]
      },
      "effects": {
        "stock": [
          {
            "variantId": "t",
            "path": "tshirtStock/master",
            "inventoryKey": "tshirt:b|d|c|s",
            "beforeQuantity": 5,
            "quantity": 4,
            "beforeRevision": 0,
            "revision": 1
          },
          {
            "variantId": "t",
            "path": "tshirtStock/master",
            "inventoryKey": "tshirt:b|d|c|s",
            "beforeQuantity": 4,
            "quantity": 2,
            "beforeRevision": 0,
            "revision": 1
          },
          {
            "variantId": "a",
            "path": "accessoryStock/shared",
            "inventoryKey": "accessory:a|piercing",
            "beforeQuantity": 5,
            "quantity": 4,
            "beforeRevision": 0,
            "revision": 1
          }
        ],
        "session": {
          "grossSales": 10000,
          "setDiscount": 0,
          "lineDiscount": 0,
          "orderDiscount": 0,
          "discount": 0,
          "netSales": 10000,
          "grossSalesJPY": 10000,
          "setDiscountJPY": 0,
          "lineDiscountJPY": 0,
          "orderDiscountJPY": 0,
          "discountJPY": 0,
          "netSalesJPY": 10000,
          "transactionCount": 1,
          "itemCount": 4
        }
      },
      "resultHash": "17587d65cb9d9b5b962500f014ae7ac34d7e364390a5ef6371b54b7b4586e065",
      "effectsHash": "5cb6a59ac8a364c2da4be04e90edaf14abc4b8bbaafe2aedb12bb4a1a43eaf29",
      "saleHash": "ae0ba8f13dee76b3135eb254a150082d84f376d9836d120c98c0b96c53909d75",
      "movementHashes": {
        "sale_multi__1": "6a5c6239545b6c92e2f0e1cb0f8b9c2285bb118b1fcf6f20a7d9a34418eff106",
        "sale_multi__2": "d917bb385aca8ab86034cd18c7415cc9ad1eeaf16ed079422d43a144be88cac3",
        "sale_multi__3": "c0e1aef049e143bde9cbe27341f84b79da6a7a24de73da3322c02a16bd3463a1"
      }
    },
    "createdAt": {
      "_seconds": 1791976867,
      "_nanoseconds": 538000000
    }
  },
  "tshirtStock/master": {
    "createdAt": {
      "_seconds": 0,
      "_nanoseconds": 123000000
    },
    "keep": {
      "x": 1
    },
    "inventory_v2": {
      "b": {
        "d": {
          "c": {
            "s": {
              "qty": 2,
              "note": "retain"
            },
            "m": {
              "qty": 8
            }
          }
        }
      }
    },
    "inventoryRevision": 1,
    "inventoryWriteProtocol": 1,
    "updatedAt": {
      "_seconds": 1791976867,
      "_nanoseconds": 538000000
    }
  }
};
