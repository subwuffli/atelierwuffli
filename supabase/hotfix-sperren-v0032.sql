-- V0.0.32: Zuverlaessige, kurzlebige Bearbeitungssperren.
-- V2 bleibt fuer bereits geoeffnete Clients voruebergehend erhalten.

alter table public.edit_locks
  add column if not exists acquired_at timestamptz not null default now(),
  add column if not exists renewed_at timestamptz not null default now();

create or replace function public.acquire_edit_lock_v3(p_entity_type text, p_entity_id uuid, p_session_token uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
declare acquired boolean;
begin
  if auth.uid() is null then return false; end if;

  delete from edit_locks
  where entity_type=p_entity_type and entity_id=p_entity_id and expires_at<=now();

  insert into edit_locks(entity_type,entity_id,user_id,session_token,acquired_at,renewed_at,expires_at)
  values(p_entity_type,p_entity_id,auth.uid(),p_session_token,now(),now(),now()+interval '3 minutes')
  on conflict(entity_type,entity_id) do nothing;

  update edit_locks
  set renewed_at=now(),expires_at=now()+interval '3 minutes'
  where entity_type=p_entity_type and entity_id=p_entity_id
    and user_id=auth.uid() and session_token=p_session_token;

  select exists(
    select 1 from edit_locks
    where entity_type=p_entity_type and entity_id=p_entity_id
      and user_id=auth.uid() and session_token=p_session_token and expires_at>now()
  ) into acquired;
  return acquired;
end $$;

create or replace function public.owns_edit_lock_v3(p_entity_type text, p_entity_id uuid, p_session_token uuid)
returns boolean language sql stable security invoker set search_path=public as $$
  select exists(
    select 1 from edit_locks
    where entity_type=p_entity_type and entity_id=p_entity_id
      and user_id=auth.uid() and session_token=p_session_token and expires_at>now()
  );
$$;

create or replace function public.release_edit_lock_v3(p_entity_type text, p_entity_id uuid, p_session_token uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
declare removed_count integer;
begin
  delete from edit_locks
  where entity_type=p_entity_type and entity_id=p_entity_id
    and user_id=auth.uid() and session_token=p_session_token;
  get diagnostics removed_count = row_count;
  return removed_count>0;
end $$;

grant execute on function public.acquire_edit_lock_v3(text,uuid,uuid) to authenticated;
grant execute on function public.owns_edit_lock_v3(text,uuid,uuid) to authenticated;
grant execute on function public.release_edit_lock_v3(text,uuid,uuid) to authenticated;
revoke all on function public.acquire_edit_lock_v3(text,uuid,uuid) from anon;
revoke all on function public.owns_edit_lock_v3(text,uuid,uuid) from anon;
revoke all on function public.release_edit_lock_v3(text,uuid,uuid) from anon;

notify pgrst, 'reload schema';
