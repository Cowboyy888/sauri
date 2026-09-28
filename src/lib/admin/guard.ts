import "server-only";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getDb } from "../db/client";
import { requireStaff, UnauthenticatedError, type StaffProfile } from "../auth/session";
import { ForbiddenError } from "../errors";
import { can, type Permission } from "../auth/permissions";

export type Guard = { ok: true; staff: StaffProfile; can: (p: Permission) => boolean } | { ok: false; staff: StaffProfile; permission: Permission };

/**
 * First line of every admin page. Signed out → redirect to login (with ?next=). Signed in without the
 * permission → { ok: false } and the page renders <AccessDenied/>; its data is never loaded.
 */
export async function guard(permission: Permission): Promise<Guard> {
  const db = getDb();
  try {
    const staff = await requireStaff(db, permission);
    return { ok: true, staff, can: (p) => can(staff.role, p) };
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      const path = (await headers()).get("x-sauri-path") ?? "/admin/dashboard";
      redirect(`/admin/login?next=${encodeURIComponent(path)}`);
    }
    if (e instanceof ForbiddenError) {
      const staff = (await import("../auth/session")).getStaff(db);
      return { ok: false, staff: (await staff)!, permission };
    }
    throw e;
  }
}
