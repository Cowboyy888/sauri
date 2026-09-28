# Roles and permissions

## Who is calling

1. **Identity:** Supabase Auth. `src/lib/auth/session.ts` reads the session cookie and calls `supabase.auth.getUser()`, which verifies the token with Supabase rather than trusting its contents.
2. **Role:** our `users` table. A Supabase account with **no active staff row has no admin access**. Staff are added by the owner by email. On first sign-in, the account is linked to its row (`users.auth_user_id`) **only if Supabase reports the email as verified**. Deactivating a row (`active = false`) removes access immediately.
3. **Customers** are separate: `customers.user_id` links a shopper's Supabase account to their orders, which row-level security uses.

## Permission matrix

Permissions are `area:read` and `area:write` (`src/lib/auth/permissions.ts`).

| Area | OWNER | ADMIN | SALES | INVENTORY | VIEWER |
|---|---|---|---|---|---|
| Dashboard | edit | edit | view | view | **view** |
| Sales analytics | edit | edit | view | – | – |
| Orders | edit | edit | **edit** | – | – |
| Customers | edit | edit | **edit** | – | – |
| Products | edit | edit | – | **edit** | – |
| Inventory and stock movements | edit | edit | – | **edit** | – |
| Discounts | edit | edit | – | – | – |
| Reports and exports | edit | edit | – | – | – |
| Reviews, content | edit | edit | – | – | – |
| Audit log | edit | view | – | – | – |
| Staff and roles | edit | – | – | – | – |
| System settings | edit | – | – | – | – |

This follows the brief: OWNER can do everything. ADMIN covers products, orders, customers, inventory, analytics and reports, plus discounts, reviews and content, and can read the audit trail. ADMIN is kept out of staff roles and system settings. SALES covers orders, customers and sales analytics. INVENTORY covers products, inventory and stock movements. VIEWER gets a read-only dashboard.

## Enforcement: never by hiding buttons

| Layer | How | Proven by |
|---|---|---|
| Middleware | `/admin` and `/api/admin` require a signed-in session (redirect or 401). **Closed with a 404 in production if Supabase isn't configured.** | build + smoke test |
| Route handler | `requireStaff(db, "orders:write")` as the first line. 401 when not signed in, 403 when the role lacks the permission. | `tests/auth.test.ts`: an INVENTORY user calling the order-status API directly gets **403**; SALES gets 200 |
| Service | every mutating function calls `assertCan(actor, …)` again | `tests/auth.test.ts`: calling `restock()` as SALES throws |
| Database | RLS for Supabase's public roles; column privileges hide costs and margins | `tests/rls.test.ts` |

Sensitive customer data (emails, addresses, order history) is only readable through admin routes that require `customers:read` or `orders:read`, or by the customer themself through RLS.

## Audit log

`audit_logs` records the user, action, entity, entity id, old value, new value and time. Actions written today include: Created order, Changed order status, Refunded order, Changed stock (restock or adjustment, with the reason), Changed cost price (weighted average), Changed reorder level, and Created discount. Price changes, product create and delete, and role changes are audited by the Phase 2 admin actions, using the same `audit()` helper.

## Adding a new protected action

```ts
export const POST = route(async (req) => {
  const db = getDb();
  const actor = await requireStaff(db, "products:write"); // 1. who, and may they?
  const body = Body.parse(await req.json());               // 2. zod .strict()
  return NextResponse.json(await updatePrice(db, actor, body)); // 3. service calls assertCan + audit
});
```
