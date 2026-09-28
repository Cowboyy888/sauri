/* eslint-disable @next/next/no-img-element */
import { Gem } from "lucide-react";
import { cn } from "../ui/cn";

/** Product thumbnail. Images are SVG renders today and Supabase Storage URLs later; a plain <img> works for both. */
export function Thumb({ src, alt, size = 40, className }: { src: string | null | undefined; alt: string; size?: number; className?: string }) {
  // Renders are 4:5 with the piece centred and generous margins; small thumbnails crop in so the piece is legible.
  const zoom = size <= 48 ? 1.9 : 1;
  return src ? (
    <span className={cn("block shrink-0 overflow-hidden rounded border border-line-soft bg-[#efe9df]", className)} style={{ width: size, height: size }}>
      <img src={src} alt={alt} width={size} height={size} loading="lazy" decoding="async" className="size-full object-cover" style={{ transform: `scale(${zoom})`, transformOrigin: "50% 52%" }} />
    </span>
  ) : (
    <span className={cn("grid shrink-0 place-items-center rounded border border-line-soft bg-canvas text-subtle", className)} style={{ width: size, height: size }} aria-hidden><Gem className="size-4" /></span>
  );
}
