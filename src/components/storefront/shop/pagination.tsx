import Link from "next/link";

export function Pagination({ page, pageCount, searchParams }: { page: number; pageCount: number; searchParams: Record<string, string | undefined> }) {
  if (pageCount <= 1) return null;
  const href = (p: number) => {
    const params = new URLSearchParams(Object.entries(searchParams).filter((e): e is [string, string] => !!e[1]));
    if (p > 1) params.set("page", String(p)); else params.delete("page");
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  };
  return (
    <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-6 font-sans text-sm">
      <Link href={href(page - 1)} aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none text-ink/25" : "text-ink/70 hover:text-ink"}>← Previous</Link>
      <span className="text-ink/50">Page {page} of {pageCount}</span>
      <Link href={href(page + 1)} aria-disabled={page >= pageCount} className={page >= pageCount ? "pointer-events-none text-ink/25" : "text-ink/70 hover:text-ink"}>Next →</Link>
    </nav>
  );
}
