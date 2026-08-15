-- Ausschliesslich zuerst im Testprojekt ausführen.
-- V0.0.41: Interne Snapshots, Wiederherstellungstest, Monitoring und Fehlerprotokolle.

create table if not exists public.backup_snapshots (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default clock_timestamp(),
  created_by uuid, revision bigint not null, data jsonb not null, validation_status text not null default 'pending', validated_at timestamptz
);
create table if not exists public.app_error_log (
  id bigint generated always as identity primary key, created_at timestamptz not null default clock_timestamp(),
  user_id uuid, app_version text, message text not null, context jsonb not null default '{}'::jsonb
);
alter table public.backup_snapshots enable row level security;
alter table public.app_error_log enable row level security;
drop policy if exists backup_admin_read on public.backup_snapshots;
drop policy if exists errors_admin_read on public.app_error_log;
create policy backup_admin_read on public.backup_snapshots for select to authenticated using(public.is_erp_admin_v1());
create policy errors_admin_read on public.app_error_log for select to authenticated using(public.is_erp_admin_v1());
grant select on public.backup_snapshots,public.app_error_log to authenticated;
revoke insert,update,delete on public.backup_snapshots,public.app_error_log from authenticated,anon;

create or replace function public.create_backup_snapshot_v1()
returns jsonb language plpgsql security definer set search_path=public as $$
declare snapshot jsonb; snapshot_id uuid; current_revision bigint;
begin
  if not public.is_erp_admin_v1() then raise exception 'ADMIN_REQUIRED'; end if;
  snapshot:=public.export_erp_backup(); current_revision:=coalesce((snapshot->>'revision')::bigint,0);
  insert into backup_snapshots(created_by,revision,data) values(auth.uid(),current_revision,snapshot) returning id into snapshot_id;
  return jsonb_build_object('id',snapshot_id,'revision',current_revision,'createdAt',clock_timestamp());
end $$;

create or replace function public.test_latest_backup_v1()
returns jsonb language plpgsql security definer set search_path=public as $$
declare snapshot_id uuid; snapshot jsonb; valid boolean; checked_at timestamptz:=clock_timestamp();
begin
  if not public.is_erp_admin_v1() then raise exception 'ADMIN_REQUIRED'; end if;
  select id,data into snapshot_id,snapshot from backup_snapshots order by created_at desc limit 1;
  if snapshot_id is null then raise exception 'NO_BACKUP'; end if;
  valid:=snapshot ? 'settings' and jsonb_typeof(snapshot->'customers')='array' and jsonb_typeof(snapshot->'orders')='array' and jsonb_typeof(snapshot->'invoices')='array' and jsonb_typeof(snapshot->'expenses')='array';
  update backup_snapshots set validation_status=case when valid then 'valid' else 'invalid' end,validated_at=checked_at where id=snapshot_id;
  return jsonb_build_object('id',snapshot_id,'valid',valid,'checkedAt',checked_at,'customers',jsonb_array_length(coalesce(snapshot->'customers','[]'::jsonb)),'orders',jsonb_array_length(coalesce(snapshot->'orders','[]'::jsonb)),'invoices',jsonb_array_length(coalesce(snapshot->'invoices','[]'::jsonb)));
end $$;

create or replace function public.log_app_error_v1(p_version text,p_message text,p_context jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_erp_member_v1() then return; end if;
  if (select count(*) from app_error_log where user_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=20 then return; end if;
  insert into app_error_log(user_id,app_version,message,context) values(auth.uid(),left(coalesce(p_version,''),80),left(coalesce(p_message,'Unbekannter Fehler'),1000),coalesce(p_context,'{}'::jsonb));
end $$;

create or replace function public.get_operations_status_v1()
returns jsonb language sql stable security definer set search_path=public as $$
select case when public.is_erp_admin_v1() then jsonb_build_object(
  'database','online','revision',(select revision from erp_meta where id='main'),
  'lastBackup',(select created_at from backup_snapshots order by created_at desc limit 1),
  'lastBackupStatus',(select validation_status from backup_snapshots order by created_at desc limit 1),
  'errors24h',(select count(*) from app_error_log where created_at>clock_timestamp()-interval '24 hours'),
  'auditEntries',(select count(*) from audit_log)
) else jsonb_build_object('database','online','admin',false) end;
$$;

grant execute on function public.create_backup_snapshot_v1() to authenticated;
grant execute on function public.test_latest_backup_v1() to authenticated;
grant execute on function public.log_app_error_v1(text,text,jsonb) to authenticated;
grant execute on function public.get_operations_status_v1() to authenticated;
revoke all on function public.create_backup_snapshot_v1() from anon;
revoke all on function public.test_latest_backup_v1() from anon;
revoke all on function public.log_app_error_v1(text,text,jsonb) from anon;
revoke all on function public.get_operations_status_v1() from anon;
notify pgrst, 'reload schema';
