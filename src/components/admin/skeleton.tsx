import { cn } from "../ui/cn";

export const Skeleton = ({ className }: { className?: string }) => <div className={cn("skeleton h-4", className)} aria-hidden />;

export function CardSkeleton({ rows = 5, chart = false, className }: { rows?: number; chart?: boolean; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface", className)} aria-busy="true" aria-label="Loading">
      <div className="border-b border-line-soft px-4 py-3"><Skeleton className="h-4 w-40" /></div>
      <div className="grid grid-cols-1 gap-3 p-4">
        {chart ? <Skeleton className="h-[260px] w-full" /> : Array.from({ length: rows }, (_, i) => <Skeleton key={i} className={cn("h-5", i % 3 === 2 ? "w-2/3" : "w-full")} />)}
      </div>
    </div>
  );
}
export function KpiSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-busy="true" aria-label="Loading figures">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg border border-line bg-surface p-4"><Skeleton className="h-3 w-24" /><Skeleton className="mt-3 h-7 w-32" /><Skeleton className="mt-3 h-3 w-28" /></div>
      ))}
    </div>
  );
}
