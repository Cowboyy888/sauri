import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { cn } from "../ui/cn";
import { int } from "@/lib/format";

export type Col<T> = {
  key: string; header: React.ReactNode; cell: (row: T) => React.ReactNode;
  align?: "right" | "left"; sortKey?: string; className?: string;
  /** Hide on small screens so tables stay usable on a phone. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
};
const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" };

/** Server-rendered table. Sorting and paging are links (?sort=, ?dir=, ?page=), so every state is shareable and works without JS. */
export function DataTable<T>({ columns, rows, rowKey, basePath, params, sort, dir, empty, caption, dense }: {
  columns: Col<T>[]; rows: T[]; rowKey: (r: T) => string; basePath: string; params: Record<string, string | undefined>;
  sort?: string; dir?: string; empty: React.ReactNode; caption: string; dense?: boolean;
}) {
  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ ...params, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `${basePath}${q.size ? `?${q}` : ""}`;
  };
  if (!rows.length) return <>{empty}</>;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line">
            {columns.map((c) => {
              const active = c.sortKey && sort === c.sortKey;
              const nextDir = active && dir !== "asc" ? "asc" : "desc";
              return (
                <th key={c.key} scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn("whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted first:pl-4 last:pr-4", c.align === "right" && "text-right", c.hideBelow && HIDE[c.hideBelow])}>
                  {c.sortKey ? (
                    <Link href={href({ sort: c.sortKey, dir: nextDir, page: undefined })} scroll={false} className={cn("inline-flex items-center gap-0.5 hover:text-fg", active && "text-fg")}>
                      {c.header}{active ? dir === "asc" ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" /> : null}
                    </Link>
                  ) : c.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-b border-line-soft last:border-0 hover:bg-[#fafaf8]">
              {columns.map((c) => (
                <td key={c.key} className={cn("px-3 align-middle first:pl-4 last:pr-4", dense ? "py-1.5" : "py-2.5", c.align === "right" && "num", c.hideBelow && HIDE[c.hideBelow], c.className)}>{c.cell(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, basePath, params }: { page: number; pageSize: number; total: number; basePath: string; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <p className="border-t border-line-soft px-4 py-2.5 text-xs text-muted">{int(total)} {total === 1 ? "row" : "rows"}</p> : null;
  const href = (p: number) => { const q = new URLSearchParams(Object.entries({ ...params, page: p > 1 ? String(p) : undefined }).filter(([, v]) => v) as [string, string][]); return `${basePath}${q.size ? `?${q}` : ""}`; };
  const from = (page - 1) * pageSize + 1, to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-line-soft px-4 py-2.5 text-xs text-muted">
      <span>{int(from)}–{int(to)} of {int(total)}</span>
      <span className="flex items-center gap-1">
        {page > 1 ? <Link href={href(page - 1)} className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-surface px-2.5 text-fg hover:bg-canvas"><ChevronLeft className="size-4" />Previous</Link> : null}
        <span className="px-2">Page {page} of {pages}</span>
        {page < pages ? <Link href={href(page + 1)} className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-surface px-2.5 text-fg hover:bg-canvas">Next<ChevronRight className="size-4" /></Link> : null}
      </span>
    </nav>
  );
}
