-- Ausschliesslich zuerst im Supabase-Testprojekt ausführen.
-- Höchstens 20 Dateiuploads je Benutzer und voller Stunde.

create table if not exists public.file_upload_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  upload_count integer not null default 0 check (upload_count >= 0),
  primary key (user_id,window_started_at)
);

alter table public.file_upload_rate_limits enable row level security;
revoke all on public.file_upload_rate_limits from anon,authenticated;

create or replace function public.consume_file_upload_quota_v1(p_user_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare allowed boolean;
begin
  insert into public.file_upload_rate_limits(user_id,window_started_at,upload_count)
  values(p_user_id,date_trunc('hour',clock_timestamp()),1)
  on conflict(user_id,window_started_at) do update
    set upload_count=public.file_upload_rate_limits.upload_count+1
    where public.file_upload_rate_limits.upload_count<20
  returning true into allowed;
  return coalesce(allowed,false);
end $$;

revoke all on function public.consume_file_upload_quota_v1(uuid) from public,anon,authenticated;
grant execute on function public.consume_file_upload_quota_v1(uuid) to service_role;

notify pgrst,'reload schema';
