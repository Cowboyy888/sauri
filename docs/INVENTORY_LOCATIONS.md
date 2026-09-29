# Inventory Locations (Phase 5 — lightweight reference table)

`inventory_locations` (`name`, `code` unique, `description`, `position`, `active`) is a **reference table**,
not a warehouse management system. Its only job today is to let a picking row
(`fulfillment_items.location_id`) say *where* a picked item physically is, for display in the picking list.

Seeded rows (`INVENTORY_LOCATION_ROWS`, `lib/db/reference-data.ts`):

| Code | Purpose |
|---|---|
| `MAIN` | Primary sellable stock |
| `DISPLAY` | On display in the physical store |
| `PACKING` | Picked and staged for packing |
| `DAMAGED` | Damaged stock, not sellable |
| `RETURNS` | Received returns awaiting inspection |

## Deliberately not built

Per the brief's own instruction ("prepare for warehouse locations, don't overbuild"), this table does
**not**:

- track *per-location* stock quantities — `inventory.stock_quantity` remains a single number per variant,
  unchanged since Phase 1;
- drive transfer movements between locations (the existing `TRANSFER` movement type predates this table and
  isn't tied to it);
- gate anything — `fulfillment_items.location_id` is nullable and purely informational; picking works
  identically whether or not a location is set.

A future multi-location inventory system would extend `inventory` (or replace it with a
per-location-per-variant table) and reuse this same `inventory_locations` table as its location dimension —
the reference data and its `code`s are chosen to still make sense in that world (`MAIN`/`DISPLAY` as real
stock-holding locations, `PACKING`/`RETURNS`/`DAMAGED` as staging areas), but building that system itself is
out of scope here.
