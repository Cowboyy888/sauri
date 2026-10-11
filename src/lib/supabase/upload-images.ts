"use client";
import { createBrowserClient } from "@supabase/ssr";

export const PRODUCT_IMAGE_BUCKET = "product-images";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };

/** Uploads straight from the browser using the signed-in staff member's Supabase session (storage policies allow
 *  authenticated users to write to the product-images bucket; see docs/sql/product-images-storage.sql). This keeps
 *  the service_role key out of the app. Returns the public URLs, in file order. */
export async function uploadProductImages(files: File[], folder: string): Promise<string[]> {
  const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const urls: string[] = [];
  for (const file of files) {
    const ext = TYPES[file.type];
    if (!ext) throw new Error(`${file.name}: use a JPG, PNG, WebP or AVIF image.`);
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} is larger than 5 MB.`);
    const path = `${folder}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, file, { contentType: file.type, cacheControl: "31536000" });
    if (error) throw new Error(/bucket not found/i.test(error.message) ? "Image storage isn't set up yet (missing the product-images bucket)." : `${file.name}: ${error.message}`);
    urls.push(supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl);
  }
  return urls;
}
