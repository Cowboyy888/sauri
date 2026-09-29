"use client";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { X, ZoomIn } from "lucide-react";
import { cn } from "@/components/ui/cn";
import type { ProductImageRow } from "@/lib/storefront/catalog";

export function ImageGallery({ images, activeMaterial, productName }: { images: ProductImageRow[]; activeMaterial: string; productName: string }) {
  const relevant = useMemo(() => {
    // Detail shots aren't tagged with a variant (only the one "front" shot per material is), so an
    // untagged image belongs to whichever material the first tagged image was rendered in — never to
    // every material at once, or a white-gold detail shot would show up under "Sterling Silver".
    const primaryMaterial = images.find((i) => i.variantMaterial)?.variantMaterial ?? null;
    const scoped = images.filter((i) => (i.variantMaterial ?? primaryMaterial) === activeMaterial);
    return scoped.length ? scoped : images;
  }, [images, activeMaterial]);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);

  useEffect(() => setIndex(0), [activeMaterial]);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  const active = relevant[index] ?? relevant[0];
  if (!active) return <div className="aspect-[4/5] w-full bg-beige-soft" />;

  return (
    <div className="flex flex-col-reverse gap-4 lg:flex-row">
      <div className="flex gap-3 overflow-x-auto lg:w-20 lg:flex-col lg:overflow-visible">
        {relevant.map((img, i) => (
          <button
            key={`${img.url}-${i}`} type="button" onClick={() => setIndex(i)} aria-label={`Show image ${i + 1}`} aria-current={i === index}
            className={cn("relative size-16 shrink-0 overflow-hidden border lg:size-20", i === index ? "border-ink" : "border-transparent")}
          >
            <Image src={img.url} alt="" fill sizes="80px" className="object-cover" />
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setZoom(true)} className="group relative aspect-[4/5] flex-1 overflow-hidden bg-beige-soft" aria-label={`Zoom in on ${productName}`}>
        <Image src={active.url} alt={active.alt || productName} fill priority sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" />
        <span className="absolute bottom-3 right-3 rounded-full bg-warm-white/90 p-2 opacity-0 transition-opacity group-hover:opacity-100"><ZoomIn className="size-4" /></span>
      </button>

      {zoom && (
        <div role="dialog" aria-modal="true" aria-label={`${productName}, full screen`} className="fixed inset-0 z-50 flex items-center justify-center bg-ink/90 p-6" onClick={() => setZoom(false)}>
          <button type="button" onClick={() => setZoom(false)} aria-label="Close" className="absolute right-5 top-5 text-warm-white"><X className="size-7" /></button>
          <div className="relative h-full max-h-[90vh] w-full max-w-3xl">
            <Image src={active.url} alt={active.alt || productName} fill sizes="90vw" className="object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}
