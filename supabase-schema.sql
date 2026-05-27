create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  photo_url text not null,
  photo_path text,
  price text not null default '',
  status text not null default 'waiting',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  registered_at timestamptz
);

alter table public.inventory_items enable row level security;

drop policy if exists "public read inventory" on public.inventory_items;
create policy "public read inventory"
on public.inventory_items for select
to anon
using (true);

drop policy if exists "public insert inventory" on public.inventory_items;
create policy "public insert inventory"
on public.inventory_items for insert
to anon
with check (true);

drop policy if exists "public update inventory" on public.inventory_items;
create policy "public update inventory"
on public.inventory_items for update
to anon
using (true)
with check (true);

drop policy if exists "public delete inventory" on public.inventory_items;
create policy "public delete inventory"
on public.inventory_items for delete
to anon
using (true);

insert into storage.buckets (id, name, public)
values ('iware-photos', 'iware-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "public read photos" on storage.objects;
create policy "public read photos"
on storage.objects for select
to anon
using (bucket_id = 'iware-photos');

drop policy if exists "public upload photos" on storage.objects;
create policy "public upload photos"
on storage.objects for insert
to anon
with check (bucket_id = 'iware-photos');

drop policy if exists "public delete photos" on storage.objects;
create policy "public delete photos"
on storage.objects for delete
to anon
using (bucket_id = 'iware-photos');
