# Stocktake / cycle counting (Phase 8)

`lib/purchasing/stocktake.ts`, `/admin/inventory/stocktake`. Reuses Phase 5's `inventory_locations` for
location selection and the pre-existing `ADJUSTMENT` movement type for the resulting stock change — no new
location or movement concept.

## Workflow (brief §46)

1. **Start** (`startStocktake()`, `inventory:write`) — optionally scoped to one location; snapshots every
   active variant's *current* stock as `expected_quantity` on `stocktake_items`, right at that moment. This
   snapshot is never recomputed later — a sale that happens mid-count doesn't retroactively change what
   "expected" meant for this stocktake.
2. **Count** (`recordCount()`) — staff enter the physically counted quantity per item, one at a time, saved
   immediately (no "submit all at once" step to lose work if a browser tab closes).
3. **Review** — `/admin/inventory/stocktake/[id]` shows Expected, Counted, and the computed Difference
   side by side for every item (brief §46's own requirement), before anything is applied.
4. **Complete / apply** (`completeStocktake()`) — see below.

## Adjustments (brief §47)

For every counted item where `counted ≠ expected`, one `ADJUSTMENT` inventory movement is written, quantity
= `counted − expected`:

- Expected 100, counted 97 → `ADJUSTMENT −3`.
- Expected 100, counted 103 → `ADJUSTMENT +3`.
- Expected 100, counted 100 → **no movement at all** (nothing changed; no zero-quantity movement, which the
  database's own `movement_non_zero` constraint would reject anyway).

Every adjustment carries the stocktake's id as its reference, the acting user, and a timestamp (via the
existing `inventory_movements`/`audit_logs` machinery — no new logging mechanism).

## Manager approval for significant discrepancies (brief §48)

`settings.key = 'stocktake'` → `{ approvalThresholdUnits: 10 }` (default), editable at
`/admin/inventory/stocktake` (`setStocktakeSettings()`). When the **largest single-line discrepancy** in a
stocktake is at or beyond this threshold, `completeStocktake()` refuses to apply it for anyone below
OWNER/ADMIN: the stocktake is marked `pending_approval` (a real, committed status change — it survives even
though the same call also raises a `ForbiddenError`, because the status update and the permission check are
deliberately not in the same rolled-back transaction) and must be completed again by an OWNER or ADMIN before
any inventory movement is written. A small discrepancy below the threshold applies immediately for any
`inventory:write` role (OWNER, ADMIN, INVENTORY) — the brief's own role table lists "stocktake" under
INVENTORY's normal responsibilities, so routine counts shouldn't need a manager every time.

## Status

`in_progress → completed`, `in_progress → pending_approval → completed` (a large discrepancy awaiting a
manager), or `→ cancelled` (`cancelStocktake()`, discards the count with no inventory effect at all).

## RBAC (brief §50)

Starting, counting and (below-threshold) completing a stocktake all use `inventory:write` — already held by
OWNER, ADMIN and INVENTORY. Applying a stocktake with a significant discrepancy additionally requires the
actor's role to be OWNER or ADMIN specifically, checked inside `completeStocktake()` itself, not by a
separate permission area.
