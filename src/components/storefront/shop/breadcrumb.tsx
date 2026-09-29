import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="font-sans text-xs text-ink/50">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li><Link href="/" className="hover:text-ink">Home</Link></li>
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <ChevronRight className="size-3" />
            {item.href ? <Link href={item.href} className="hover:text-ink">{item.label}</Link> : <span aria-current="page" className="text-ink/75">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
