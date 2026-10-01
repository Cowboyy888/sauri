# Expenses (Phase 9, brief §6-8)

## Fields

`expense_number` (sequence-backed, `EXP-000001`, same convention as `orders.order_number`/`purchase_orders.po_number`),
category, description, amount + currency, payment method, an optional supplier/vendor (reuses Phase 8's
`suppliers` table — no second vendor list), reference number, notes, an attachment URL (same "URL text
field, no binary upload provider configured" convention as purchase documents and return photos), status,
`expense_date` (when the cost was incurred), created by/at, approved by/at, rejected reason, paid at.

## Categories

`expense_categories` — a small, named, ordered, editable list, the same shape as Phase 6's `customer_tags`.
Seeded with the brief's own starting set (Rent, Utilities, Salaries, Marketing, Advertising, Software,
Shipping, Packaging, Equipment, Maintenance, Office, Transportation, Bank Fees, Professional Services,
Other) via `reference-data.ts`, and fully editable afterward from `/admin/finance/expenses` — never
hardcoded into a dropdown. A category already used by an expense can be deactivated (hidden from new
expenses, kept for history) but not deleted; only an unused category can be deleted.

## Workflow

```
DRAFT ──submit──> PENDING_APPROVAL ──approve──> APPROVED ──mark paid──> PAID
                        │
                        └──reject──> REJECTED
DRAFT / PENDING_APPROVAL / APPROVED ──cancel/void──> CANCELLED
```

`lib/finance/expenses.ts#EXPENSE_TRANSITIONS` is the one place this is defined — the same
`Record<Status, Status[]>` pattern every other status machine in this codebase uses (`orders.status`,
`purchase_orders.status`, `stocktakes.status`). Every transition is enforced **server-side**
(`assertCan(actor, "finance:write")` inside the service function, called again from the server action, and
gated a third time by the sidebar/page `guard()`) — never just a hidden button.

## Permissions

OWNER and ADMIN get `finance:write` (create, edit, submit, approve, reject, mark paid, cancel, delete).
Nobody else has any `finance` permission at all — see docs/ROLES_AND_PERMISSIONS.md for why this doesn't
follow the broader Phase 7/8 `purchasing`/`marketing` pattern.

## Never deleted once it has affected a report

Brief §8: "Never permanently delete financial records that have already affected reporting." APPROVED and
PAID both feed `getOperatingExpenses()` (the P&L). `deleteExpense()` refuses to run once an expense has
reached APPROVED or later — DRAFT, PENDING_APPROVAL and REJECTED rows never affected any figure, so those
may still be deleted outright. To remove the effect of an already-posted expense, cancel it instead
(`cancelExpense()` → status `CANCELLED`): the row stays for the audit trail, and `getOperatingExpenses()`'s
`status in ('APPROVED','PAID')` filter simply stops counting it from that point on — the same "void, don't
delete" posture as a refund.

## Accrual vs. cash

`expense_date` (the incurred date) drives the P&L. `paid_at` (set only by `markExpensePaid()`) drives cash
flow. See docs/FINANCIAL_CALCULATIONS.md for why these are two different columns rather than one.

## Audit

Every write path calls `audit()` with `entity = "expense"`, keyed by `expense_number` (readable in the audit
log without a join) — created, updated, submitted, approved, rejected, marked paid, cancelled, deleted.
