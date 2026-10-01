# Purchase orders (Phase 8)

`lib/purchasing/orders.ts`, `/admin/purchases`. See docs/PURCHASE_WORKFLOW.md for the receiving side and the
full product→profit pipeline, docs/SUPPLIERS.md for the supplier side, docs/INVENTORY_COSTING.md for the
costing method a receipt feeds into.

## PO numbering (brief §15)

`PO-2026-000001` — a sequence-backed default expression on `purchase_orders.po_number`
(`'PO-' || extract(year from now()) || '-' || lpad(nextval('po_number_seq')::text, 6, '0')`), the exact same
pattern `orders.order_number` already uses. The database id is never shown anywhere in the UI or an API
response as the PO's identifier — only this number. The sequence itself doesn't reset each year (there is no
per-year reset), so `PO-2026-000047` might be followed by `PO-2027-000048` — the year in the label always
matches when the PO was created, but the counter keeps incrementing; this is a deliberate simplification the
brief doesn't require otherwise.

## Creation (brief §14)

`createPurchaseOrder()` takes a supplier and a list of `{variantId, supplierSku?, quantity, unitCostCents,
discountCents?}` lines. **Every total is computed server-side**, from the submitted lines — never trusted
from the browser:

```
line total     = quantity × unit cost − line discount
subtotal       = Σ line total (before the order-level discount)
total          = subtotal − discount + shipping + tax
```

A `purchase_order_total_math` database CHECK constraint makes an inconsistent total impossible even if
application code had a bug — the same defense-in-depth pattern every other money table in this codebase uses
(`orders.order_total_math`, docs/DATABASE_SCHEMA.md). A PO can only be edited (its supplier, items, dates,
notes) while still `DRAFT` — once submitted for approval, the numbers on record don't move under anyone.

## Status (brief §13, §16)

```
DRAFT → PENDING_APPROVAL → APPROVED → ORDERED
  ↘_______________↘____________↘_________↘→ CANCELLED
                                     ↘ PARTIALLY_RECEIVED → RECEIVED   (driven by receiving, see docs/PURCHASE_WORKFLOW.md)
```

`setPurchaseOrderStatus()` enforces the transition table server-side (`PO_TRANSITIONS`) — an invalid jump
(e.g. `DRAFT` straight to `ORDERED`) is rejected with a clear error. `PENDING_APPROVAL` → `APPROVED` and
every → `CANCELLED` transition require `purchasing:write` (OWNER/ADMIN only) — "only authorized users can
approve" (brief §16) is the same RBAC gate as every other purchasing mutation, not a separate approval
permission. Every status change writes an audit-log entry (brief §43, §49) recording who changed what and
when; `APPROVED` additionally stamps `approved_by_user_id`/`approved_at`, `ORDERED` stamps `ordered_at`,
`CANCELLED` stamps `cancelled_at`. `PARTIALLY_RECEIVED`/`RECEIVED` are **never** set by this function — only
by the receiving transaction, which recomputes them from real received-quantity totals every time (never
assumed from a single receipt).

## PDF (brief §17)

`GET /api/admin/purchases/[id]/pdf` (`lib/purchasing/pdf.ts`) reuses the exact `jsPDF` + `jspdf-autotable`
stack `lib/admin/reports.ts` already uses for report exports — no new PDF dependency. Company name, address,
email and phone come from `settings.key = 'store'` (`lib/admin/store-settings.ts`, editable at
`/admin/settings`) — **never hardcoded**, per the brief's own instruction. The document includes the PO
number, date, expected delivery, supplier details, the full line-item table, subtotal/discount/shipping/
tax/total, payment terms, notes, and an "Authorized by / Signature" area at the foot of the page.

## Email (brief §18)

`sendPurchaseOrderEmail()` goes through the same `lib/email/provider.ts` abstraction every transactional
email in this codebase uses (still a logging stub — no real provider is configured this phase, matching the
Phase 6 note that one was never selected). **Never sent automatically** — a staff member explicitly enters a
recipient and clicks send from the PO's own page. Every attempt, successful or not, is logged to
`purchase_order_sends` (`sent_at`, `sent_by`, `recipient`, `status`) — visible on the PO's "Email history"
section, so a failed send is never silently invisible.

## Documents (brief §42)

`purchase_documents` — quotation, invoice, packing list, receiving document, or other. Like every other
attachment in this codebase (product images, Phase 5's return photos), a document is added **by URL**
(validated `https://`), not a file-upload widget — this project has never had a binary storage provider
configured, and Phase 8 doesn't introduce one. `filename`, `type`, `uploaded_by`, `created_at` are all
recorded.

## Payment status (brief §41)

`UNPAID` / `PARTIALLY_PAID` / `PAID` are stored on the PO, updated automatically by
`recordPurchasePayment()` from the cumulative `amount_paid_cents` vs. `total_cents`. **`OVERDUE` is never
stored** — it's derived at read time (`isOverdue()`: a `due_date` has passed and the PO isn't `PAID`), so it
can never drift out of sync with the calendar. Each payment is logged to `purchase_payments` (amount, date,
note, who recorded it) — a minimal log, deliberately **not** a general ledger or accounts-payable system, per
the brief's own "keep the architecture simple."

## Purchase vs. sales (brief §36)

`/admin/analytics/purchases` shows **three deliberately separate numbers side by side**: Purchase Spend (what
was paid to suppliers, from `purchase_orders.total_cents`), COGS (the cost of goods actually *sold* in the
period, from the pre-existing `orders.cost_total_cents` — completely unaffected by purchasing), and
Inventory Value (`variant_stock.inventory_value_cents`, current snapshot). Purchase spend is never presented
as, or substituted for, COGS anywhere in this codebase — see docs/PURCHASE_WORKFLOW.md and
docs/INVENTORY_COSTING.md for why they're fundamentally different questions.

## RBAC (brief §50)

`purchasing:write` (OWNER, ADMIN) for every PO mutation: create, edit (draft only), status changes,
documents, email, payments. `purchasing:read` (also INVENTORY, SALES, VIEWER) to view POs. Receiving itself
is a separate permission, `inventory:write` — see docs/PURCHASE_WORKFLOW.md.
