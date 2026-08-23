-- Ausschliesslich zuerst im Testprojekt ausführen.
-- V0.0.57: Metadaten fuer PDFs und hochgeladene Belege.
-- Die Dateien selbst liegen privat in Cloudflare R2, nie in Supabase Storage.

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
  delete_reason text
);

create index if not exists file_attachments_entity_idx on public.file_attachments(entity_type,entity_id,created_at desc);
create index if not exists file_attachments_deleted_at_idx on public.file_attachments(deleted_at);

alter table public.file_attachments enable row level security;
drop policy if exists file_attachments_member_read on public.file_attachments;
create policy file_attachments_member_read on public.file_attachments
  for select to authenticated using (public.is_erp_member_v1());

-- Nur die Edge Function schreibt Metadaten. Angemeldete Benutzer koennen nie
-- direkt Dateipfade oder fremde Eintraege manipulieren.
revoke insert,update,delete on public.file_attachments from authenticated,anon;
grant select on public.file_attachments to authenticated;
-- Die Edge Function verwendet service_role; nur die fuer Upload und Download
-- benoetigten Tabellenrechte werden explizit vergeben.
grant select on public.orders, public.invoices, public.receipts, public.expenses to service_role;
grant select,insert on public.file_attachments to service_role;

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

notify pgrst, 'reload schema';
