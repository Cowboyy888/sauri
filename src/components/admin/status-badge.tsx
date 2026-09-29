import { cn } from "../ui/cn";

type Tone = "pos" | "neg" | "warn" | "info" | "neutral" | "accent";
const TONE: Record<Tone, string> = {
  pos: "bg-[#e9f3ec] text-pos", neg: "bg-[#f8e9e6] text-neg", warn: "bg-[#f7eedd] text-warn",
  info: "bg-[#e8eef7] text-info", neutral: "bg-line-soft text-muted", accent: "bg-accent-soft text-accent",
};
/** One mapping for every status in the system, so the same word always has the same color. */
const MAP: Record<string, [string, Tone]> = {
  // order
  pending: ["Pending", "warn"], paid: ["Paid", "info"], processing: ["Processing", "info"], shipped: ["Shipped", "accent"], delivered: ["Delivered", "pos"], cancelled: ["Cancelled", "neutral"], refunded: ["Refunded", "neg"],
  // payment
  unpaid: ["Unpaid", "warn"], failed: ["Failed", "neg"], partially_refunded: ["Partially refunded", "warn"],
  // fulfillment
  unfulfilled: ["Unfulfilled", "neutral"], returned: ["Returned", "neg"],
  picking: ["Picking", "info"], packing: ["Packing", "info"], ready_to_ship: ["Ready to ship", "accent"], partially_shipped: ["Partially shipped", "accent"], in_transit: ["In transit", "accent"], completed: ["Completed", "pos"],
  // shipment (package)
  label_created: ["Label created", "neutral"], out_for_delivery: ["Out for delivery", "accent"], delivery_failed: ["Delivery failed", "neg"], return_to_sender: ["Return to sender", "neg"],
  // pick status
  picked: ["Picked", "pos"], missing: ["Missing", "neg"],
  // return status
  requested: ["Requested", "warn"], under_review: ["Under review", "info"], approved: ["Approved", "pos"], rejected: ["Rejected", "neg"], return_shipped: ["Return shipped", "info"], received: ["Received", "info"], inspecting: ["Inspecting", "info"], approved_for_refund: ["Approved for refund", "pos"], closed: ["Closed", "neutral"],
  // return condition / disposition
  new: ["New", "pos"], like_new: ["Like new", "pos"], used: ["Used", "neutral"], damaged: ["Damaged", "neg"], defective: ["Defective", "neg"], unsellable: ["Unsellable", "neg"], restock: ["Restock", "pos"], repair: ["Repair", "warn"], dispose: ["Dispose", "neg"], return_to_customer: ["Return to customer", "neutral"],
  // return reason
  wrong_size: ["Wrong size", "neutral"], changed_mind: ["Changed mind", "neutral"], wrong_item: ["Wrong item", "neutral"], not_as_expected: ["Not as expected", "neutral"], other: ["Other", "neutral"],
  // abandoned carts
  abandoned: ["Abandoned", "warn"], recovered: ["Recovered", "pos"],
  // stock
  IN_STOCK: ["In stock", "pos"], LOW_STOCK: ["Low stock", "warn"], OUT_OF_STOCK: ["Out of stock", "neg"],
  // product / variant / review / discount
  active: ["Active", "pos"], draft: ["Draft", "neutral"], archived: ["Archived", "neutral"], inactive: ["Inactive", "neutral"],
  published: ["Published", "pos"], hidden: ["Hidden", "neutral"], paused: ["Paused", "neutral"], scheduled: ["Scheduled", "info"], expired: ["Expired", "neutral"],
  // movements
  SALE: ["Sale", "info"], RESTOCK: ["Restock", "pos"], PURCHASE: ["Purchase", "pos"], RETURN: ["Return", "accent"], ADJUSTMENT: ["Adjustment", "warn"], DAMAGED: ["Damaged", "neg"], LOST: ["Lost", "neg"], TRANSFER: ["Transfer", "neutral"], MANUAL: ["Manual", "warn"],
};

/** kind="order": an order whose status is "paid" is waiting to be fulfilled, so say that (payment has its own column). */
export function StatusBadge({ status, className, label, kind }: { status: string; className?: string; label?: string; kind?: "order" }) {
  const [text, tone] = kind === "order" && status === "paid" ? ["To fulfil", "info" as Tone] : MAP[status] ?? [status, "neutral" as Tone];
  return <span className={cn("inline-flex h-[22px] items-center whitespace-nowrap rounded px-2 text-xs font-medium", TONE[tone], className)}>{label ?? text}</span>;
}
