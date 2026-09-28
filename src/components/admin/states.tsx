"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { AlertCircle, Inbox, Lock, RotateCw } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";

export function EmptyState({ title, description, action, className }: { title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid place-items-center gap-2 px-6 py-10 text-center", className)}>
      <Inbox className="size-6 text-subtle" aria-hidden />
      <p className="text-[13.5px] font-medium">{title}</p>
      {description && <p className="max-w-sm text-[13px] text-muted">{description}</p>}
      {action}
    </div>
  );
}

/** A failed section never takes the page down: it shows this, with Retry. */
export function ErrorState({ message = "Unable to load this section.", className }: { message?: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div role="alert" className={cn("grid place-items-center gap-2 px-6 py-10 text-center", className)}>
      <AlertCircle className="size-6 text-neg" aria-hidden />
      <p className="text-[13.5px] font-medium">{message}</p>
      <p className="text-[13px] text-muted">The rest of the page is unaffected.</p>
      <Button size="sm" onClick={() => start(() => router.refresh())} disabled={pending}><RotateCw className={cn(pending && "animate-spin")} />Retry</Button>
    </div>
  );
}

export function AccessDeniedView({ role, area }: { role: string; area: string }) {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <div className="max-w-md rounded-lg border border-line bg-surface p-8 text-center">
        <Lock className="mx-auto size-6 text-muted" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold">You don’t have access to this page</h1>
        <p className="mt-2 text-[13.5px] text-muted">Your role (<b className="font-medium text-fg">{role.toLowerCase()}</b>) can’t open {area}. Ask the owner if you need access.</p>
        <a href="/admin/dashboard" className="mt-5 inline-block text-[13px] font-medium text-accent hover:underline">Back to the dashboard</a>
      </div>
    </div>
  );
}
