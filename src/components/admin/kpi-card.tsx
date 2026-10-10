import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "../ui/cn";

/**
 * A headline figure with its comparison. `change` is null when the previous period is zero: we say so instead of
 * printing a meaningless percentage. `invert` flips colour for costs (a rise in refunds is bad news).
 */
export function KPICard({ label, value, change, comparison, hint, invert, tone, href, note }: {
  label: string; value: string; change: number | null; comparison: string; hint?: string; invert?: boolean; tone?: "warn" | "neg"; href?: string; note?: string;
}) {
  const up = (change ?? 0) > 0, flat = change === 0;
  const good = invert ? !up : up;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const body = (
    <>
      <p className="text-[12.5px] font-medium text-muted">{label}</p>
      <p className={cn("mt-1.5 text-[24px] font-semibold leading-tight tracking-[-0.01em]", tone === "warn" && "text-warn", tone === "neg" && "text-neg")}>{value}</p>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
        {note ? <span>{note}</span> : change === null ? (
          <span title="No data in the comparison period">No comparison</span>
        ) : (
          <span className={cn("inline-flex items-center font-semibold", flat ? "text-muted" : good ? "text-pos" : "text-neg")}>
            <Icon className="size-3.5" aria-hidden />
            <span className="sr-only">{flat ? "No change" : up ? "Up" : "Down"}</span>
            {Math.abs(change).toFixed(1)}%
          </span>
        )}
        {!note && <span>{comparison}</span>}
      </p>
      {hint && <p className="mt-1 text-xs text-subtle">{hint}</p>}
    </>
  );
  const cls = "admin-rise block min-w-0 rounded-lg border border-line bg-surface p-4 transition-[border-color,box-shadow] duration-200 hover:shadow-[0_2px_10px_rgba(0,0,0,.05)]";
  return href ? <a href={href} className={cn(cls, "hover:border-[#cfccc4]")}>{body}</a> : <div className={cls}>{body}</div>;
}
