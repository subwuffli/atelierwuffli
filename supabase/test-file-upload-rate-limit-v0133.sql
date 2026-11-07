-- Ausschliesslich zuerst im Supabase-Testprojekt ausführen.
-- Erhöht das Upload-Limit auf 60 Dateien je Benutzer und voller Stunde.

drop function if exists public.consume_file_upload_quota_v1(uuid);

create function public.consume_file_upload_quota_v1(p_user_id uuid)
returns timestamptz language plpgsql security definer set search_path=public as $$
declare allowed boolean; window_started timestamptz:=date_trunc('hour',clock_timestamp());
begin
  insert into public.file_upload_rate_limits(user_id,window_started_at,upload_count)
  values(p_user_id,window_started,1)
  on conflict(user_id,window_started_at) do update
    set upload_count=public.file_upload_rate_limits.upload_count+1
    where public.file_upload_rate_limits.upload_count<60
  returning true into allowed;
  if allowed then return null; end if;
  return window_started+interval '1 hour';
end $$;

revoke all on function public.consume_file_upload_quota_v1(uuid) from public,anon,authenticated;
grant execute on function public.consume_file_upload_quota_v1(uuid) to service_role;

notify pgrst,'reload schema';
