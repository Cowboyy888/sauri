import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { guard } from "@/lib/admin/guard";
import { listReviews } from "@/lib/admin/misc";
import { one, pageParams, type SearchParams } from "@/lib/admin/range";
import { safe } from "@/lib/admin/safe";
import { dateShort } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/admin/data-table";
import { FilterBar, FilterSelect } from "@/components/admin/filter-bar";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { Thumb } from "@/components/admin/thumb";
import { ReviewActions } from "@/components/admin/review-actions";

export const metadata = { title: "Reviews" };

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const g = await guard("reviews:read");
  if (!g.ok) return <AccessDenied role={g.staff.role} permission={g.permission} />;
  const sp = await searchParams, { page, pageSize } = pageParams(sp), params = { status: one(sp.status) };
  const res = await safe("reviews", () => listReviews(getDb(), { ...params, page, pageSize }));
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Reviews" description="Pending reviews appear first. Only published reviews show on product pages." />
      <Card>
        <FilterBar><FilterSelect param="status" label="Status" options={[{ value: "pending", label: "Pending" }, { value: "published", label: "Published" }, { value: "rejected", label: "Rejected" }, { value: "hidden", label: "Hidden" }]} /></FilterBar>
        {!res.ok ? <ErrorState message="Unable to load reviews." /> : !res.data.rows.length ? <EmptyState title="No reviews" /> : <>
          <ul className="divide-y divide-line-soft">{res.data.rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 max-w-3xl gap-3"><Thumb src={r.image} alt="" size={40} />
                <div className="min-w-0"><p className="text-xs text-muted"><Link href={`/admin/products/${r.productId}?tab=reviews`} className="hover:underline">{r.product}</Link> · {r.author} · {dateShort(r.at)}</p>
                  <p className="text-[13px]"><span className="text-champagne" aria-label={`${r.rating} out of 5`}>{"★".repeat(r.rating)}</span> <b className="font-medium">{r.title}</b></p><p className="text-[13px] text-muted">{r.body}</p></div></div>
              <div className="flex items-center gap-2"><StatusBadge status={r.status} />{g.can("reviews:write") && <ReviewActions id={r.id} status={r.status} />}</div>
            </li>))}</ul>
          <Pagination {...res.data} basePath="/admin/reviews" params={params} />
        </>}
      </Card>
    </div>
  );
}
