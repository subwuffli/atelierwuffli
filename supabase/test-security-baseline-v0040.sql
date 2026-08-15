-- Ausschliesslich zuerst im Testprojekt ausführen.
-- V0.0.40: Mitglieder-Allowlist, strengere RLS und Verbot physischer Löschungen.

create table if not exists public.erp_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  role text not null default 'user' check(role in ('admin','user','read_only')),
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp()
);

insert into public.erp_members(user_id,role)
select id,case when row_number() over(order by created_at)=1 then 'admin' else 'user' end from auth.users
on conflict(user_id) do nothing;

alter table public.erp_members enable row level security;
drop policy if exists erp_members_read_self on public.erp_members;
create policy erp_members_read_self on public.erp_members for select to authenticated using(user_id=auth.uid());
grant select on public.erp_members to authenticated;
revoke insert,update,delete on public.erp_members from authenticated,anon;

create or replace function public.is_erp_member_v1()
returns boolean language sql stable security definer set search_path=public as $$
select exists(select 1 from erp_members where user_id=auth.uid() and active);
$$;
create or replace function public.is_erp_admin_v1()
returns boolean language sql stable security definer set search_path=public as $$
select exists(select 1 from erp_members where user_id=auth.uid() and active and role='admin');
$$;
revoke all on function public.is_erp_member_v1() from public,anon;
revoke all on function public.is_erp_admin_v1() from public,anon;
grant execute on function public.is_erp_member_v1() to authenticated;
grant execute on function public.is_erp_admin_v1() to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['erp_meta','company_settings','customers','delivery_addresses','orders','order_items','invoices','invoice_items','receipts','expenses','document_counters','edit_locks'] loop
    execute format('drop policy if exists authenticated_all on public.%I',table_name);
    execute format('drop policy if exists erp_members_all on public.%I',table_name);
    execute format('create policy erp_members_all on public.%I for all to authenticated using (public.is_erp_member_v1()) with check (public.is_erp_member_v1())',table_name);
  end loop;
end $$;

drop policy if exists audit_log_authenticated_read on public.audit_log;
drop policy if exists audit_log_member_read on public.audit_log;
create policy audit_log_member_read on public.audit_log for select to authenticated using(public.is_erp_member_v1());

-- Normale Benutzer dürfen nie physisch löschen. Die App verwendet ausschliesslich Soft-Delete-RPCs.
revoke delete on public.customers,public.orders,public.invoices,public.receipts,public.expenses,public.company_settings,public.erp_meta,public.document_counters from authenticated;

create table if not exists public.security_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  user_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.security_events enable row level security;
drop policy if exists security_events_admin_read on public.security_events;
create policy security_events_admin_read on public.security_events for select to authenticated using(public.is_erp_admin_v1());
revoke insert,update,delete on public.security_events from authenticated,anon;
grant select on public.security_events to authenticated;

create or replace function public.get_security_status_v1()
returns jsonb language sql stable security invoker set search_path=public as $$
select jsonb_build_object(
  'member',public.is_erp_member_v1(),
  'admin',public.is_erp_admin_v1(),
  'role',(select role from erp_members where user_id=auth.uid() and active),
  'tenantId',(select tenant_id from erp_members where user_id=auth.uid() and active),
  'hardDeleteBlocked',true,
  'auditImmutable',true
);
$$;
grant execute on function public.get_security_status_v1() to authenticated;
revoke all on function public.get_security_status_v1() from anon;
notify pgrst, 'reload schema';
