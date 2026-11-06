-- Ausschliesslich im Supabase-Testprojekt ausführen.
-- Kompatibilität für bereits laufende Storage-Function-Versionen.

alter table public.inventory_items
  add column if not exists deleted_at timestamptz;

update public.inventory_items
set deleted_at=case when archived then coalesce(deleted_at,clock_timestamp()) else null end;

create or replace function public.sync_inventory_archive_marker_v1()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.deleted_at:=case when new.archived then coalesce(new.deleted_at,clock_timestamp()) else null end;
  return new;
end $$;

drop trigger if exists inventory_archive_marker on public.inventory_items;
create trigger inventory_archive_marker before insert or update of archived on public.inventory_items
  for each row execute function public.sync_inventory_archive_marker_v1();

notify pgrst, 'reload schema';
