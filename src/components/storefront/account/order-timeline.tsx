import { Check } from "lucide-react";
import { cn } from "@/components/ui/cn";

const STAGES = [
  { key: "confirmed", label: "Order Confirmed" },
  { key: "processing", label: "Processing" },
  { key: "packed", label: "Packed" },
  { key: "shipped", label: "Shipped" },
  { key: "in_transit", label: "In Transit" },
  { key: "out_for_delivery", label: "Out for Delivery" },
  { key: "delivered", label: "Delivered" },
] as const;

type Pkg = { status: string };

/** A real 7-stage timeline (brief §12) driven by `orders.fulfillment_status` and per-package shipment
 *  status — never a fixed mapping off the payment/lifecycle status alone. */
function currentStageIndex(fulfillmentStatus: string, packages: Pkg[]): number {
  const anyPackage = (statuses: string[]) => packages.some((p) => statuses.includes(p.status));
  if (fulfillmentStatus === "delivered" || fulfillmentStatus === "completed") return 6;
  if (anyPackage(["delivered"])) return 6;
  if (anyPackage(["out_for_delivery"])) return 5;
  if (fulfillmentStatus === "in_transit" || anyPackage(["in_transit"])) return 4;
  if (fulfillmentStatus === "shipped" || fulfillmentStatus === "partially_shipped" || anyPackage(["shipped"])) return 3;
  if (fulfillmentStatus === "ready_to_ship" || anyPackage(["label_created", "ready_to_ship"])) return 2;
  if (fulfillmentStatus === "processing" || fulfillmentStatus === "picking" || fulfillmentStatus === "packing") return 1;
  return 0;
}

export function OrderTimeline({ status, fulfillmentStatus, packages }: { status: string; fulfillmentStatus: string; packages: Pkg[] }) {
  if (status === "cancelled" || status === "refunded") {
    return <p className="font-sans text-sm text-ink/60">{status === "cancelled" ? "This order was cancelled." : "This order was refunded."}</p>;
  }
  const currentIndex = status === "pending" ? -1 : currentStageIndex(fulfillmentStatus, packages);

  return (
    <ol className="flex flex-col gap-0">
      {STAGES.map((s, i) => {
        const done = i <= currentIndex;
        return (
          <li key={s.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", done ? "border-ink bg-ink text-warm-white" : "border-ink/25 text-transparent")}>
                <Check className="size-3" />
              </span>
              {i < STAGES.length - 1 && <span className={cn("w-px flex-1", done && i < currentIndex ? "bg-ink" : "bg-ink/15")} style={{ minHeight: 24 }} />}
            </div>
            <p className={cn("pb-6 font-sans text-sm", done ? "text-ink" : "text-ink/40")}>{s.label}</p>
          </li>
        );
      })}
    </ol>
  );
}
