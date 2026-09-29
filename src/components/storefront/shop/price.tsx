import { formatMoney } from "@/lib/money";

export function Price({ cents, compareAtCents, className }: { cents: number; compareAtCents?: number | null; className?: string }) {
  return (
    <span className={className}>
      <span className="font-sans">{formatMoney(cents)}</span>
      {compareAtCents != null && compareAtCents > cents && (
        <span className="ml-2 font-sans text-ink/40 line-through">{formatMoney(compareAtCents)}</span>
      )}
    </span>
  );
}
