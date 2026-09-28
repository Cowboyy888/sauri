import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { BusinessError } from "./errors";

/** Wrap a route handler: business errors become clean JSON with the right status; anything else is a 500 without internals. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof BusinessError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: "Invalid request.", code: "VALIDATION", issues: e.issues.map((i) => i.path.join(".")) }, { status: 400 });
      console.error(e);
      return NextResponse.json({ error: "Something went wrong.", code: "INTERNAL" }, { status: 500 });
    }
  };
}
