"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "./cn";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;
export function DialogContent({ title, description, children, className, side }: { title: string; description?: string; children: React.ReactNode; className?: string; side?: "left" }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-[rgba(28,27,25,.38)]" />
      <D.Content
        className={cn(
          "admin fixed z-50 flex flex-col bg-surface shadow-[0_24px_60px_rgba(0,0,0,.18)] focus:outline-none",
          side === "left" ? "inset-y-0 left-0 w-[280px] max-w-[85vw]" : "left-1/2 top-1/2 max-h-[calc(100dvh-32px)] w-[min(540px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-lg",
          className,
        )}
      >
        <div className={cn("flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4", side === "left" && "sr-only")}>
          <div>
            <D.Title className="text-[15px] font-semibold">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-[13px] text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="-mr-1 rounded p-1 text-muted hover:bg-line-soft hover:text-fg" aria-label="Close"><X className="size-4" /></D.Close>
        </div>
        <div className={cn("min-h-0 overflow-y-auto", side === "left" ? "h-full" : "px-5 py-4")}>{children}</div>
      </D.Content>
    </D.Portal>
  );
}
