# Entity relationship diagram

```mermaid
erDiagram
  roles ||--o{ users : "role"
  users ||--o{ audit_logs : "acted"
  users ||--o{ inventory_movements : "made"
  users ||--o{ orders : "created (staff orders)"

  customers ||--o{ customer_addresses : has
  customers ||--o{ orders : places
  customers ||--o{ wishlists : saves
  customers ||--o{ reviews : writes
  customers ||--o{ discount_usages : uses

  categories ||--o{ products : groups
  collections ||--o{ products : features
  products ||--o{ product_variants : "sold as"
  products ||--o{ product_images : shows
  products ||--o{ wishlists : "saved in"
  products ||--o{ reviews : receives
  product_variants ||--|| inventory : "stock (1:1)"
  product_variants ||--o{ inventory_movements : "every change"
  product_variants ||--o{ order_items : "sold in"
  suppliers ||--o{ inventory_movements : "restocks"

  sales_channels ||--o{ orders : "sold through"
  orders ||--|{ order_items : contains
  orders ||--o{ order_events : timeline
  orders ||--o{ payments : "paid by"
  orders ||--o{ refunds : "refunded by"
  payments ||--o{ refunds : "refunded from"
  orders ||--o{ inventory_movements : "caused"
  orders ||--o{ discount_usages : "used code"
  discounts ||--o{ discount_usages : "used as"
```

## The three chains from the brief

**Customer → Orders → Order items → Product variant → Inventory**
```
customers 1───* orders 1───* order_items *───1 product_variants 1───1 inventory
                                  (snapshots: name, SKU, variant, price, cost)
```

**Product → Variants → Inventory movements**
```
products 1───* product_variants 1───* inventory_movements
                     │                  (SALE, RETURN, RESTOCK, PURCHASE, ADJUSTMENT, DAMAGED, LOST, TRANSFER, MANUAL)
                     └──1───1 inventory   stock_quantity = Σ movements.quantity
```

**Order → Payment → Refund**
```
orders 1───* payments 1───* refunds
   └──────────1───* refunds   (refund_total on the order = Σ refunds)
```

Views: `variant_stock` (variant + inventory + product → available and status) and `customer_stats` (customers + paid orders → totals and lifetime value).
