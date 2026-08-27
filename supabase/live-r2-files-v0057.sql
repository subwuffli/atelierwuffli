-- Live: private R2-Dateien mit Metadaten in Supabase und AG-Ausgabennummern.
-- Additiv; zuerst in der Testumgebung geprüft.

create table if not exists public.file_attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('order','invoice','receipt','expense')),
  entity_id uuid not null,
  file_name text not null check (length(trim(file_name)) > 0),
  content_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  storage_key text not null unique,
  source text not null check (source in ('generated_pdf','upload')),
  version integer,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  delete_reason text,
  document_hash text
);

create index if not exists file_attachments_entity_idx on public.file_attachments(entity_type,entity_id,created_at desc);
create index if not exists file_attachments_deleted_at_idx on public.file_attachments(deleted_at);
create unique index if not exists file_attachments_generated_pdf_hash_key
  on public.file_attachments(entity_type,entity_id,document_hash)
  where source='generated_pdf' and deleted_at is null and document_hash is not null;

alter table public.file_attachments enable row level security;
drop policy if exists file_attachments_member_read on public.file_attachments;
create policy file_attachments_member_read on public.file_attachments
  for select to authenticated using (public.is_erp_member_v1());

revoke insert,update,delete on public.file_attachments from authenticated,anon;
grant select on public.file_attachments to authenticated;
grant select on public.orders, public.invoices, public.receipts, public.expenses to service_role;
grant select,insert,update on public.file_attachments to service_role;

create or replace function public.sync_attachment_trash_v1()
returns trigger language plpgsql security definer set search_path=public as $$
declare attachment_type text;
begin
  attachment_type:=case tg_table_name
    when 'orders' then 'order'
    when 'invoices' then 'invoice'
    when 'receipts' then 'receipt'
    when 'expenses' then 'expense'
  end;
  if attachment_type is null or old.deleted_at is not distinct from new.deleted_at then return new; end if;
  if new.deleted_at is null then
    update file_attachments set deleted_at=null,deleted_by=null,delete_reason=null
      where entity_type=attachment_type and entity_id=new.id and deleted_at is not null;
  else
    update file_attachments set deleted_at=new.deleted_at,deleted_by=new.deleted_by,delete_reason=coalesce(new.delete_reason,'Übergeordneten Eintrag gelöscht')
      where entity_type=attachment_type and entity_id=new.id and deleted_at is null;
  end if;
  return new;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array['orders','invoices','receipts','expenses'] loop
    execute format('drop trigger if exists attachment_trash_%I on public.%I',table_name,table_name);
    execute format('create trigger attachment_trash_%I after update of deleted_at on public.%I for each row execute function public.sync_attachment_trash_v1()',table_name,table_name);
  end loop;
end $$;

drop trigger if exists audit_file_attachments on public.file_attachments;
create trigger audit_file_attachments after insert or update or delete on public.file_attachments
  for each row execute function public.audit_row_change_v1();

alter table public.expenses add column if not exists number text;
with numbered as (
  select id,'AG-'||to_char(expense_date,'YY-MM-DD')||'-'||lpad(row_number() over(partition by expense_date order by created_at,id)::text,3,'0') as number
  from public.expenses where number is null
)
update public.expenses e set number=n.number from numbered n where n.id=e.id;
create unique index if not exists expenses_number_key on public.expenses(number) where number is not null;

create or replace function public.next_document_number(p_prefix text,p_date date)
returns text language plpgsql security invoker set search_path=public as $$
declare n integer;
begin
  if p_prefix not in ('AF','RE','QU','AG') then raise exception 'Ungültiges Präfix'; end if;
  if p_prefix='AF' then
    select coalesce(max(split_part(number,'-',5)::integer),0)+1 into n from orders where order_date=p_date and number ~ '^AF-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}$';
  elsif p_prefix='RE' then
    select coalesce(max(split_part(number,'-',5)::integer),0)+1 into n from invoices where invoice_date=p_date and number ~ '^RE-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}$';
  elsif p_prefix='QU' then
    select coalesce(max(split_part(number,'-',5)::integer),0)+1 into n from receipts where receipt_date=p_date and number ~ '^QU-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}$';
  else
    select coalesce(max(split_part(number,'-',5)::integer),0)+1 into n from expenses where expense_date=p_date and number ~ '^AG-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}$';
  end if;
  insert into document_counters(prefix,counter_date,value) values(p_prefix,p_date,n)
  on conflict(prefix,counter_date) do update set value=document_counters.value+1 returning value into n;
  return p_prefix||'-'||to_char(p_date,'YY-MM-DD')||'-'||lpad(n::text,3,'0');
end $$;

create or replace function public.save_expense_v1(p_expense jsonb,p_expected_updated_at timestamptz default null,p_session_token uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_entity_id uuid:=coalesce(nullif(p_expense->>'id','')::uuid,gen_random_uuid()); current_stamp timestamptz; saved_stamp timestamptz; revision_value bigint; entity_number text; exists_already boolean:=false;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select updated_at,number into current_stamp,entity_number from expenses where id=v_entity_id for update; exists_already:=found;
  if exists_already then
    if p_session_token is not null and not exists(select 1 from edit_locks l where l.entity_type='expense' and l.entity_id=v_entity_id and l.user_id=auth.uid() and l.session_token=p_session_token and l.expires_at>now()) then raise exception 'EDIT_LOCK_LOST'; end if;
    if p_expected_updated_at is null or current_stamp<>p_expected_updated_at then raise exception 'EXPENSE_CONFLICT'; end if;
    update expenses set expense_date=(p_expense->>'date')::date,amount=coalesce((p_expense->>'amount')::numeric,0),description=coalesce(p_expense->>'description',''),updated_at=clock_timestamp() where id=v_entity_id returning updated_at into saved_stamp;
  else
    entity_number:=next_document_number('AG',(p_expense->>'date')::date);
    insert into expenses(id,number,expense_date,amount,description,created_at,updated_at) values(v_entity_id,entity_number,(p_expense->>'date')::date,coalesce((p_expense->>'amount')::numeric,0),coalesce(p_expense->>'description',''),clock_timestamp(),clock_timestamp()) returning updated_at into saved_stamp;
  end if;
  revision_value:=erp_bump_revision_v1();
  return jsonb_build_object('revision',revision_value,'id',v_entity_id,'number',entity_number,'updatedAt',saved_stamp);
end $$;

alter function public.export_erp_backup() rename to export_erp_backup_v0068;
create function public.export_erp_backup()
returns jsonb language sql security invoker set search_path=public as $$
select public.export_erp_backup_v0068() || jsonb_build_object('expenses',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'number',e.number,'date',e.expense_date,'amount',e.amount,'description',e.description,'createdAt',e.created_at,'updatedAt',e.updated_at) order by e.expense_date,e.created_at) from expenses e where e.deleted_at is null),'[]'::jsonb));
$$;

grant execute on function public.save_expense_v1(jsonb,timestamptz,uuid),public.next_document_number(text,date),public.export_erp_backup() to authenticated;
revoke all on function public.save_expense_v1(jsonb,timestamptz,uuid),public.next_document_number(text,date),public.export_erp_backup() from anon;
notify pgrst,'reload schema';
