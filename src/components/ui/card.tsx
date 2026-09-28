import { cn } from "./cn";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("min-w-0 rounded-lg border border-line bg-surface", className)} {...p} />;
}
export function CardHeader({ title, description, actions, className, id }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string; id?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-line-soft px-4 py-3", className)}>
      <div className="min-w-0 flex-1 basis-56">
        <h2 id={id} className="text-[14px] font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
export const CardBody = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("p-4", className)} {...p} />;
