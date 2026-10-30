-- Ausschliesslich zuerst im Supabase-Testprojekt ausführen.
-- V0.1.06: Artikelstamm und unveränderbare Bestandsbewegungen.

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  item_number text not null check (length(trim(item_number)) > 0),
  name text not null check (length(trim(name)) > 0),
  unit text not null default 'Stück' check (length(trim(unit)) > 0),
  minimum_stock numeric(14,3) not null default 0 check (minimum_stock >= 0),
  archived boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (item_number)
);
create index if not exists inventory_items_name_idx on public.inventory_items(lower(name));

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  movement_type text not null check (movement_type in ('opening','in','out')),
  quantity numeric(14,3) not null check (quantity > 0),
  movement_date date not null default current_date,
  note text not null default '',
  created_by uuid not null references auth.users(id),
  -- Optionale Herkunft für eine spätere Auftragsverknüpfung; keine Automatik.
  source_type text,
  source_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  check ((source_type is null) = (source_id is null))
);
create index if not exists inventory_movements_item_date_idx on public.inventory_movements(item_id,movement_date desc,created_at desc);
create unique index if not exists inventory_one_opening_movement_idx on public.inventory_movements(item_id) where movement_type='opening';

alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
drop policy if exists inventory_items_member_read on public.inventory_items;
drop policy if exists inventory_items_member_write on public.inventory_items;
drop policy if exists inventory_movements_member_read on public.inventory_movements;
create policy inventory_items_member_read on public.inventory_items for select to authenticated using(public.is_erp_member_v1());
create policy inventory_movements_member_read on public.inventory_movements for select to authenticated using(public.is_erp_member_v1());
revoke all on public.inventory_items from authenticated,anon;
grant select on public.inventory_items to authenticated;
grant select on public.inventory_movements to authenticated;
revoke delete on public.inventory_items from authenticated;
revoke insert,update,delete on public.inventory_movements from authenticated,anon;
revoke all on public.inventory_items,public.inventory_movements from anon;

create or replace function public.is_erp_writer_v1()
returns boolean language sql stable security definer set search_path=public as $$
select exists(select 1 from erp_members where user_id=auth.uid() and active and role in ('admin','user'));
$$;
revoke all on function public.is_erp_writer_v1() from public,anon;
grant execute on function public.is_erp_writer_v1() to authenticated;

-- Inventarartikel verwenden einen eigenen Nummernkreis (AR) und dürfen
-- weder Auftrags- noch Ausgabennummern verbrauchen.
create or replace function public.next_document_number(p_prefix text,p_date date)
returns text language plpgsql security invoker set search_path=public as $$
declare n integer;
begin
  if p_prefix not in ('AF','RE','QU','AG','AR') then raise exception 'Ungültiges Präfix'; end if;
  if p_prefix='AF' then
    select coalesce(max(split_part(number,'-',5)::integer),0)+1 into n from orders where order_date=p_date and number ~ '^AF-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}$';
  elsif p_prefix='RE' then
    select coalesce(max(split_part(number,'-',5)::integer),0)+1 into n from invoices where invoice_date=p_date and number ~ '^RE-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}$';
  elsif p_prefix='QU' then
    select coalesce(max(split_part(number,'-',5)::integer),0)+1 into n from receipts where receipt_date=p_date and number ~ '^QU-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}$';
  elsif p_prefix='AG' then
    select coalesce(max(split_part(number,'-',5)::integer),0)+1 into n from expenses where expense_date=p_date and number ~ '^AG-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}$';
  else
    select coalesce(max(split_part(item_number,'-',5)::integer),0)+1 into n
      from inventory_items
      where item_number ~ ('^AR-' || to_char(p_date,'YY-MM-DD') || '-[0-9]{3}$');
  end if;
  insert into document_counters(prefix,counter_date,value) values(p_prefix,p_date,n)
  on conflict(prefix,counter_date) do update set value=document_counters.value+1 returning value into n;
  return p_prefix||'-'||to_char(p_date,'YY-MM-DD')||'-'||lpad(n::text,3,'0');
end $$;
grant execute on function public.next_document_number(text,date) to authenticated;
revoke all on function public.next_document_number(text,date) from anon;

drop trigger if exists audit_inventory_items on public.inventory_items;
create trigger audit_inventory_items after insert or update or delete on public.inventory_items
  for each row execute function public.audit_row_change_v1();
drop trigger if exists audit_inventory_movements on public.inventory_movements;
create trigger audit_inventory_movements after insert on public.inventory_movements
  for each row execute function public.audit_row_change_v1();

create or replace view public.inventory_stock_v1 with (security_invoker=true) as
select i.id,i.item_number,i.name,i.unit,i.minimum_stock,i.archived,
       coalesce(sum(case when m.movement_type in ('opening','in') then m.quantity else -m.quantity end),0)::numeric(14,3) as stock,
       i.created_at,i.updated_at
from public.inventory_items i
left join public.inventory_movements m on m.item_id=i.id
group by i.id;
grant select on public.inventory_stock_v1 to authenticated;
revoke all on public.inventory_stock_v1 from anon;

create or replace function public.record_inventory_movement_v1(
  p_item_id uuid,p_movement_type text,p_quantity numeric,p_movement_date date default current_date,
  p_note text default '',p_source_type text default null,p_source_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare current_stock numeric(14,3); movement_id uuid; revision_value bigint;
begin
  if auth.uid() is null or not public.is_erp_writer_v1() then raise exception 'AUTH_REQUIRED'; end if;
  if p_movement_type is null or p_movement_type not in ('opening','in','out') then raise exception 'INVALID_MOVEMENT_TYPE'; end if;
  if p_quantity is null or p_quantity<=0 then raise exception 'INVALID_QUANTITY'; end if;
  if p_source_type is distinct from null and (length(trim(p_source_type))=0 or p_source_id is null) then raise exception 'INVALID_SOURCE'; end if;
  if p_source_id is not null and p_source_type is null then raise exception 'INVALID_SOURCE'; end if;

  -- Das Artikelsperren serialisiert parallele Bewegungen je Artikel.
  perform 1 from public.inventory_items where id=p_item_id and not archived for update;
  if not found then raise exception 'ITEM_NOT_FOUND_OR_ARCHIVED'; end if;
  if p_movement_type='opening' and exists(select 1 from public.inventory_movements where item_id=p_item_id and movement_type='opening') then raise exception 'OPENING_ALREADY_RECORDED'; end if;
  select coalesce(sum(case when movement_type in ('opening','in') then quantity else -quantity end),0)
    into current_stock from public.inventory_movements where item_id=p_item_id;
  if p_movement_type='out' and current_stock<p_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;

  insert into public.inventory_movements(item_id,movement_type,quantity,movement_date,note,created_by,source_type,source_id)
  values(p_item_id,p_movement_type,p_quantity,coalesce(p_movement_date,current_date),coalesce(p_note,''),auth.uid(),p_source_type,p_source_id)
  returning id into movement_id;
  revision_value:=public.erp_bump_revision_v1();
  return jsonb_build_object('id',movement_id,'stock',current_stock+case when p_movement_type='out' then -p_quantity else p_quantity end,'revision',revision_value);
end $$;
revoke all on function public.record_inventory_movement_v1(uuid,text,numeric,date,text,text,uuid) from public,anon;
grant execute on function public.record_inventory_movement_v1(uuid,text,numeric,date,text,text,uuid) to authenticated;

create or replace function public.create_inventory_item_v1(
  p_name text,p_unit text default 'Stück',p_minimum_stock numeric default 0,p_opening_stock numeric default 0,
  p_movement_date date default current_date,p_note text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare item_id uuid; item_number text; movement_id uuid; revision_value bigint;
begin
  if auth.uid() is null or not public.is_erp_writer_v1() then raise exception 'AUTH_REQUIRED'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'ITEM_NAME_REQUIRED'; end if;
  if nullif(trim(coalesce(p_unit,'')),'') is null then raise exception 'ITEM_UNIT_REQUIRED'; end if;
  if coalesce(p_minimum_stock,0)<0 or coalesce(p_opening_stock,0)<0 then raise exception 'INVALID_QUANTITY'; end if;
  item_number:=public.next_document_number('AR',coalesce(p_movement_date,current_date));
  insert into public.inventory_items(item_number,name,unit,minimum_stock)
  values(item_number,trim(p_name),trim(p_unit),coalesce(p_minimum_stock,0)) returning id into item_id;
  if coalesce(p_opening_stock,0)>0 then
    insert into public.inventory_movements(item_id,movement_type,quantity,movement_date,note,created_by)
    values(item_id,'opening',p_opening_stock,coalesce(p_movement_date,current_date),coalesce(p_note,''),auth.uid()) returning id into movement_id;
  end if;
  revision_value:=public.erp_bump_revision_v1();
  return jsonb_build_object('id',item_id,'number',item_number,'revision',revision_value,'movementId',movement_id);
end $$;
revoke all on function public.create_inventory_item_v1(text,text,numeric,numeric,date,text) from public,anon;
grant execute on function public.create_inventory_item_v1(text,text,numeric,numeric,date,text) to authenticated;

create or replace function public.set_inventory_item_archived_v1(p_item_id uuid,p_archived boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare revision_value bigint;
begin
  if auth.uid() is null or not public.is_erp_writer_v1() then raise exception 'AUTH_REQUIRED'; end if;
  update public.inventory_items set archived=coalesce(p_archived,false),updated_at=clock_timestamp() where id=p_item_id;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  revision_value:=public.erp_bump_revision_v1();
  return jsonb_build_object('revision',revision_value);
end $$;
revoke all on function public.set_inventory_item_archived_v1(uuid,boolean) from public,anon;
grant execute on function public.set_inventory_item_archived_v1(uuid,boolean) to authenticated;

notify pgrst, 'reload schema';
