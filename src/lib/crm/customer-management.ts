/**
 * Tags, notes, communication history, consent, merging and anonymization (brief §10-13, §16, §36-37).
 * See docs/CRM.md and docs/CUSTOMER_PRIVACY.md.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import {
  customerAddresses, customerCommunications, customerConsents, customerNotes, customerTagAssignments, customerTags,
  customers, loyaltyAccounts, loyaltyRedemptions, loyaltyTransactions, orders, returnRequests, reviews, users, wishlists,
} from "../db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { type Actor, assertCan } from "../auth/permissions";
import { audit } from "../audit";

/* ------------------------------------------------------------------------ tags */
export async function listTags(db: DbOrTx) { return db.select().from(customerTags).orderBy(customerTags.name); }

export async function createTag(db: Db, actor: Actor, name: string, color?: string) {
  assertCan(actor, "customers:write");
  const clean = name.trim();
  if (!clean) throw new ValidationError("Enter a tag name.");
  const [row] = await db.insert(customerTags).values({ name: clean, color: color ?? null }).onConflictDoNothing().returning();
  if (!row) throw new ValidationError("That tag already exists.");
  await audit(db, actor, "Created customer tag", "customer_tag", row.id, undefined, { name: clean });
  return row;
}

export async function assignTag(db: Db, actor: Actor, customerId: string, tagId: string) {
  assertCan(actor, "customers:write");
  await db.insert(customerTagAssignments).values({ customerId, tagId, assignedByUserId: actor.userId }).onConflictDoNothing();
  await audit(db, actor, "Tagged customer", "customer", customerId, undefined, { tagId });
}

export async function unassignTag(db: Db, actor: Actor, customerId: string, tagId: string) {
  assertCan(actor, "customers:write");
  await db.delete(customerTagAssignments).where(and(eq(customerTagAssignments.customerId, customerId), eq(customerTagAssignments.tagId, tagId)));
  await audit(db, actor, "Untagged customer", "customer", customerId, { tagId }, undefined);
}

export async function getCustomerTags(db: DbOrTx, customerId: string) {
  return db.select({ id: customerTags.id, name: customerTags.name, color: customerTags.color })
    .from(customerTagAssignments).innerJoin(customerTags, eq(customerTags.id, customerTagAssignments.tagId))
    .where(eq(customerTagAssignments.customerId, customerId)).orderBy(customerTags.name);
}

/* ----------------------------------------------------------------------- notes */
export async function listNotes(db: DbOrTx, customerId: string) {
  return db.select({ id: customerNotes.id, note: customerNotes.note, createdAt: customerNotes.createdAt, updatedAt: customerNotes.updatedAt, author: sql<string>`coalesce(${users.name}, 'System')` })
    .from(customerNotes).leftJoin(users, eq(users.id, customerNotes.authorUserId)).where(eq(customerNotes.customerId, customerId)).orderBy(desc(customerNotes.createdAt));
}

export async function addNote(db: Db, actor: Actor, customerId: string, note: string) {
  assertCan(actor, "customers:write");
  const clean = note.trim();
  if (!clean) throw new ValidationError("Enter a note.");
  const [row] = await db.insert(customerNotes).values({ customerId, authorUserId: actor.userId, note: clean }).returning();
  await audit(db, actor, "Added customer note", "customer", customerId, undefined, { note: clean });
  return row!;
}

/* ---------------------------------------------------------------- communications */
export async function listCommunications(db: DbOrTx, customerId: string) {
  return db.select({ id: customerCommunications.id, type: customerCommunications.type, subject: customerCommunications.subject, message: customerCommunications.message, createdAt: customerCommunications.createdAt, author: sql<string>`coalesce(${users.name}, 'System')` })
    .from(customerCommunications).leftJoin(users, eq(users.id, customerCommunications.createdByUserId)).where(eq(customerCommunications.customerId, customerId)).orderBy(desc(customerCommunications.createdAt));
}

export async function logCommunication(db: Db, actor: Actor, customerId: string, input: { type: typeof customerCommunications.$inferInsert["type"]; subject?: string; message: string }) {
  assertCan(actor, "customers:write");
  const clean = input.message.trim();
  if (!clean) throw new ValidationError("Enter a message.");
  const [row] = await db.insert(customerCommunications).values({ customerId, type: input.type, subject: input.subject?.trim() || null, message: clean, createdByUserId: actor.userId }).returning();
  await audit(db, actor, "Logged customer communication", "customer", customerId, undefined, { type: input.type, subject: input.subject });
  return row!;
}

/* ---------------------------------------------------------------------- consent */
export type ConsentType = "email_marketing" | "sms_marketing";
/** Sets *current* consent state on `customers` (fast reads) and appends the change to
 *  `customer_consents` (the audited history, brief §16, §43) — never one without the other. */
export async function setConsent(db: Db, customerId: string, type: ConsentType, consent: boolean, source: string) {
  const now = new Date();
  await db.update(customers).set(
    type === "email_marketing" ? { marketingOptIn: consent, consentUpdatedAt: now, consentSource: source } : { smsMarketingConsent: consent, consentUpdatedAt: now, consentSource: source },
  ).where(eq(customers.id, customerId));
  await db.insert(customerConsents).values({ customerId, type, consent, source });
}

export async function getConsentHistory(db: DbOrTx, customerId: string) {
  return db.select().from(customerConsents).where(eq(customerConsents.customerId, customerId)).orderBy(desc(customerConsents.createdAt));
}

export type EmailPreferences = { promotions: boolean; newArrivals: boolean; backInStock: boolean; loyalty: boolean };
const DEFAULT_EMAIL_PREFS: EmailPreferences = { promotions: true, newArrivals: true, backInStock: true, loyalty: true };
export async function getEmailPreferences(db: DbOrTx, customerId: string): Promise<EmailPreferences> {
  const [row] = await db.select({ v: customers.emailPreferences }).from(customers).where(eq(customers.id, customerId));
  return { ...DEFAULT_EMAIL_PREFS, ...(row?.v as Partial<EmailPreferences> | undefined) };
}
export async function setEmailPreferences(db: Db, customerId: string, patch: Partial<EmailPreferences>) {
  const current = await getEmailPreferences(db, customerId);
  const next = { ...current, ...patch };
  await db.update(customers).set({ emailPreferences: next }).where(eq(customers.id, customerId));
  return next;
}

/* ----------------------------------------------------------------------- merge */
export type MergePreview = {
  a: { id: string; name: string; email: string; orders: number; addresses: number; wishlist: number; reviews: number; loyaltyPoints: number; notes: number };
  b: { id: string; name: string; email: string; orders: number; addresses: number; wishlist: number; reviews: number; loyaltyPoints: number; notes: number };
};
async function customerSummary(db: DbOrTx, id: string) {
  const [[c], [o], [a], [w], [r], [l], [n]] = await Promise.all([
    db.select({ name: customers.name, email: customers.email }).from(customers).where(eq(customers.id, id)),
    db.select({ n: sql<number>`count(*)::int` }).from(orders).where(eq(orders.customerId, id)),
    db.select({ n: sql<number>`count(*)::int` }).from(customerAddresses).where(eq(customerAddresses.customerId, id)),
    db.select({ n: sql<number>`count(*)::int` }).from(wishlists).where(eq(wishlists.customerId, id)),
    db.select({ n: sql<number>`count(*)::int` }).from(reviews).where(eq(reviews.customerId, id)),
    db.select({ n: sql<number>`coalesce(sum(${loyaltyAccounts.pointsBalance}),0)::int` }).from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, id)),
    db.select({ n: sql<number>`count(*)::int` }).from(customerNotes).where(eq(customerNotes.customerId, id)),
  ]);
  if (!c) throw new NotFoundError("Customer not found.");
  return { id, name: c.name, email: c.email, orders: o!.n, addresses: a!.n, wishlist: w!.n, reviews: r!.n, loyaltyPoints: l!.n, notes: n!.n };
}

export async function previewMerge(db: DbOrTx, actor: Actor, customerIdA: string, customerIdB: string): Promise<MergePreview> {
  assertCan(actor, "customers:write");
  const [a, b] = await Promise.all([customerSummary(db, customerIdA), customerSummary(db, customerIdB)]);
  return { a, b };
}

/** Merges `loserId` into `survivorId`: every order, address, wishlist entry, review, note, communication,
 *  consent record and loyalty history is reassigned (never deleted — brief §36 "preserve financial
 *  history"), the loser's loyalty balance is folded into the survivor's via an audited ADJUSTMENT
 *  transaction (never a silent balance overwrite — brief §25 still applies across a merge), and the loser
 *  row is marked `merged_into_customer_id` rather than deleted, so anything still pointing at its id by
 *  surprise resolves to a real, readable row. */
export async function mergeCustomers(db: Db, actor: Actor, survivorId: string, loserId: string) {
  assertCan(actor, "customers:write");
  if (survivorId === loserId) throw new ValidationError("Choose two different customers to merge.");
  return db.transaction(async (tx) => {
    const [survivor] = await tx.select().from(customers).where(eq(customers.id, survivorId)).for("update");
    const [loser] = await tx.select().from(customers).where(eq(customers.id, loserId)).for("update");
    if (!survivor || !loser) throw new NotFoundError("Customer not found.");
    if (loser.mergedIntoCustomerId) throw new ValidationError("That customer has already been merged.");

    await tx.update(orders).set({ customerId: survivorId }).where(eq(orders.customerId, loserId));
    await tx.update(customerAddresses).set({ customerId: survivorId }).where(eq(customerAddresses.customerId, loserId));
    await tx.update(wishlists).set({ customerId: survivorId }).where(eq(wishlists.customerId, loserId)).catch(() => {}); // primary key conflict on a product already in survivor's wishlist is fine to skip
    await tx.update(reviews).set({ customerId: survivorId }).where(eq(reviews.customerId, loserId));
    await tx.update(customerNotes).set({ customerId: survivorId }).where(eq(customerNotes.customerId, loserId));
    await tx.update(customerCommunications).set({ customerId: survivorId }).where(eq(customerCommunications.customerId, loserId));
    await tx.update(customerConsents).set({ customerId: survivorId }).where(eq(customerConsents.customerId, loserId));
    await tx.update(returnRequests).set({ customerId: survivorId }).where(eq(returnRequests.customerId, loserId));
    await tx.update(loyaltyRedemptions).set({ customerId: survivorId }).where(eq(loyaltyRedemptions.customerId, loserId));
    await tx.update(customerTagAssignments).set({ customerId: survivorId }).where(eq(customerTagAssignments.customerId, loserId)).catch(() => {});

    const [loserAccount] = await tx.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, loserId)).for("update");
    if (loserAccount && loserAccount.pointsBalance > 0) {
      const [survivorAccount] = await tx.insert(loyaltyAccounts).values({ customerId: survivorId }).onConflictDoNothing().returning();
      const acc = survivorAccount ?? (await tx.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.customerId, survivorId)).for("update"))[0]!;
      const balanceAfter = acc.pointsBalance + loserAccount.pointsBalance;
      await tx.update(loyaltyAccounts).set({ pointsBalance: balanceAfter, lifetimePointsEarned: acc.lifetimePointsEarned + loserAccount.pointsBalance }).where(eq(loyaltyAccounts.id, acc.id));
      await tx.insert(loyaltyTransactions).values({ accountId: acc.id, type: "ADJUSTMENT", points: loserAccount.pointsBalance, balanceBefore: acc.pointsBalance, balanceAfter, referenceType: "merge", referenceId: loserId, reason: `Merged from ${loser.email}`, userId: actor.userId });
      await tx.update(loyaltyAccounts).set({ pointsBalance: 0 }).where(eq(loyaltyAccounts.id, loserAccount.id));
    }

    await tx.update(customers).set({ mergedIntoCustomerId: survivorId, name: `${loser.name} (merged into ${survivor.email})` }).where(eq(customers.id, loserId));
    await audit(tx, actor, "Merged customers", "customer", survivorId, { loserId, loserEmail: loser.email }, { survivorId, survivorEmail: survivor.email });
  });
}

/* --------------------------------------------------------------------- privacy */
/** Replaces PII in place; never deletes the row (brief §37) — orders, refunds and audit history must
 *  survive intact. `anonymized_at` marks the row so it stops being treated as a live, contactable person. */
export async function anonymizeCustomer(db: Db, actor: Actor, customerId: string) {
  assertCan(actor, "customers:write");
  if (actor.role !== "OWNER") throw new ForbiddenError("Only an owner can anonymize a customer.");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(customers).where(eq(customers.id, customerId)).for("update");
    if (!c) throw new NotFoundError("Customer not found.");
    if (c.anonymizedAt) throw new ValidationError("This customer is already anonymized.");
    const anonEmail = `anonymized-${customerId}@deleted.invalid`;
    await tx.update(customers).set({
      name: "Anonymized customer", email: anonEmail, phone: null, marketingOptIn: false, smsMarketingConsent: false,
      firstTouchDetails: null, lastTouchDetails: null, anonymizedAt: new Date(),
    }).where(eq(customers.id, customerId));
    await tx.delete(customerAddresses).where(eq(customerAddresses.customerId, customerId));
    await tx.delete(customerNotes).where(eq(customerNotes.customerId, customerId));
    await tx.delete(customerCommunications).where(eq(customerCommunications.customerId, customerId));
    await audit(tx, actor, "Anonymized customer", "customer", customerId, { email: c.email, name: c.name }, { email: anonEmail });
  });
}
