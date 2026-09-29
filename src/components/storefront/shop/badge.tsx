import { cn } from "@/components/ui/cn";
import type { StockStatus } from "@/lib/inventory/service";

export function ProductBadge({ label, className }: { label: string; className?: string }) {
  const tone = /sale/i.test(label) ? "bg-error text-white" : /exclusive|limited/i.test(label) ? "bg-ink text-warm-white" : "bg-warm-white text-ink";
  return (
    <span className={cn("inline-flex items-center border border-ink/15 px-2 py-1 font-sans text-[10px] font-medium uppercase tracking-[0.14em]", tone, className)}>
      {label}
    </span>
  );
}

export function StockLabel({ status, available, className }: { status: StockStatus; available: number; className?: string }) {
  if (status === "OUT_OF_STOCK") return <span className={cn("font-sans text-xs uppercase tracking-wide text-ink/45", className)}>Sold out</span>;
  if (status === "LOW_STOCK") return <span className={cn("font-sans text-xs uppercase tracking-wide text-error", className)}>Only {available} left</span>;
  return <span className={cn("font-sans text-xs uppercase tracking-wide text-ink/50", className)}>In stock</span>;
}
