-- Ausschliesslich nach dem erfolgreichen Test im Supabase-Liveprojekt ausführen.
-- V0.1.31: Artikel bearbeiten, optionaler Mindestbestand und ein Inventarfoto pro Artikel.

alter table public.inventory_items
  add column if not exists minimum_stock_enabled boolean not null default false,
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

create or replace view public.inventory_stock_v1 with (security_invoker=true) as
select i.id,i.item_number,i.name,i.unit,i.minimum_stock,i.archived,
       coalesce(sum(case when m.movement_type in ('opening','in') then m.quantity else -m.quantity end),0)::numeric(14,3) as stock,
       i.created_at,i.updated_at,i.minimum_stock_enabled
from public.inventory_items i
left join public.inventory_movements m on m.item_id=i.id
group by i.id;
grant select on public.inventory_stock_v1 to authenticated;
revoke all on public.inventory_stock_v1 from anon;

create or replace function public.update_inventory_item_v1(
  p_item_id uuid,p_name text,p_unit text,p_minimum_stock_enabled boolean,p_minimum_stock numeric
) returns jsonb language plpgsql security definer set search_path=public as $$
declare revision_value bigint;
begin
  if auth.uid() is null or not public.is_erp_writer_v1() then raise exception 'AUTH_REQUIRED'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'ITEM_NAME_REQUIRED'; end if;
  if nullif(trim(coalesce(p_unit,'')),'') is null then raise exception 'ITEM_UNIT_REQUIRED'; end if;
  if coalesce(p_minimum_stock,0)<0 then raise exception 'INVALID_QUANTITY'; end if;

  update public.inventory_items
  set name=trim(p_name),unit=trim(p_unit),minimum_stock_enabled=coalesce(p_minimum_stock_enabled,false),minimum_stock=coalesce(p_minimum_stock,0),updated_at=clock_timestamp()
  where id=p_item_id and not archived;
  if not found then raise exception 'ITEM_NOT_FOUND_OR_ARCHIVED'; end if;

  revision_value:=public.erp_bump_revision_v1();
  return jsonb_build_object('revision',revision_value);
end $$;
revoke all on function public.update_inventory_item_v1(uuid,text,text,boolean,numeric) from public,anon;
grant execute on function public.update_inventory_item_v1(uuid,text,text,boolean,numeric) to authenticated;

drop function if exists public.create_inventory_item_v1(text,text,numeric,numeric,date,text);
create function public.create_inventory_item_v1(
  p_name text,p_unit text default 'Stück',p_minimum_stock numeric default 0,p_opening_stock numeric default 0,
  p_movement_date date default current_date,p_note text default '',p_minimum_stock_enabled boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare item_id uuid; item_number text; movement_id uuid; revision_value bigint;
begin
  if auth.uid() is null or not public.is_erp_writer_v1() then raise exception 'AUTH_REQUIRED'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'ITEM_NAME_REQUIRED'; end if;
  if nullif(trim(coalesce(p_unit,'')),'') is null then raise exception 'ITEM_UNIT_REQUIRED'; end if;
  if coalesce(p_minimum_stock,0)<0 or coalesce(p_opening_stock,0)<0 then raise exception 'INVALID_QUANTITY'; end if;
  item_number:=public.next_document_number('AR',coalesce(p_movement_date,current_date));
  insert into public.inventory_items(item_number,name,unit,minimum_stock,minimum_stock_enabled)
  values(item_number,trim(p_name),trim(p_unit),coalesce(p_minimum_stock,0),coalesce(p_minimum_stock_enabled,false)) returning id into item_id;
  if coalesce(p_opening_stock,0)>0 then
    insert into public.inventory_movements(item_id,movement_type,quantity,movement_date,note,created_by)
    values(item_id,'opening',p_opening_stock,coalesce(p_movement_date,current_date),coalesce(p_note,''),auth.uid()) returning id into movement_id;
  end if;
  revision_value:=public.erp_bump_revision_v1();
  return jsonb_build_object('id',item_id,'number',item_number,'revision',revision_value,'movementId',movement_id);
end $$;
revoke all on function public.create_inventory_item_v1(text,text,numeric,numeric,date,text,boolean) from public,anon;
grant execute on function public.create_inventory_item_v1(text,text,numeric,numeric,date,text,boolean) to authenticated;

alter table public.file_attachments drop constraint if exists file_attachments_entity_type_check;
alter table public.file_attachments add constraint file_attachments_entity_type_check
  check (entity_type in ('order','invoice','receipt','expense','inventory'));
alter table public.file_attachments drop constraint if exists file_attachments_source_check;
alter table public.file_attachments add constraint file_attachments_source_check
  check (source in ('generated_pdf','upload','inventory_photo'));
create unique index if not exists file_attachments_one_inventory_photo_idx
  on public.file_attachments(entity_type,entity_id)
  where entity_type='inventory' and source='inventory_photo' and deleted_at is null;
grant select on public.inventory_items to service_role;

notify pgrst, 'reload schema';
