"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/components/ui/cn";

/** A full-height slide-out panel (cart drawer, mobile nav) in the storefront's own visual language — the
 *  shared admin Dialog is intentionally not reused here, since it hardcodes the admin theme. */
export const Sheet = D.Root;
export const SheetTrigger = D.Trigger;
export const SheetClose = D.Close;

export function SheetContent({ title, side = "right", children, className }: { title: string; side?: "left" | "right"; children: React.ReactNode; className?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="shop-sheet-overlay fixed inset-0 z-50 bg-ink/35" />
      <D.Content
        className={cn(
          "shop-sheet-content fixed inset-y-0 z-50 flex w-[min(420px,100vw)] flex-col bg-warm-white shadow-[0_0_60px_rgba(35,33,30,.18)] focus:outline-none",
          side === "right" ? "right-0" : "left-0",
          className,
        )}
        data-side={side}
      >
        <D.Title className="sr-only">{title}</D.Title>
        <D.Description className="sr-only">{title}</D.Description>
        {children}
      </D.Content>
    </D.Portal>
  );
}

export function SheetCloseButton({ className }: { className?: string }) {
  return (
    <D.Close aria-label="Close" className={cn("rounded-full p-1.5 text-ink/60 hover:bg-ink/5 hover:text-ink", className)}>
      <X className="size-5" />
    </D.Close>
  );
}
