-- Product image uploads (Admin → Products). Run once in the Supabase SQL Editor.
-- Public bucket (the storefront shows these images), 5 MB limit, images only.
-- Only signed-in users can upload/replace/delete; the admin UI itself is limited to staff with products:write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/avif'];

drop policy if exists "product images: public read" on storage.objects;
create policy "product images: public read" on storage.objects for select using (bucket_id = 'product-images');

drop policy if exists "product images: staff upload" on storage.objects;
create policy "product images: staff upload" on storage.objects for insert to authenticated with check (bucket_id = 'product-images');

drop policy if exists "product images: staff update" on storage.objects;
create policy "product images: staff update" on storage.objects for update to authenticated using (bucket_id = 'product-images');

drop policy if exists "product images: staff delete" on storage.objects;
create policy "product images: staff delete" on storage.objects for delete to authenticated using (bucket_id = 'product-images');
