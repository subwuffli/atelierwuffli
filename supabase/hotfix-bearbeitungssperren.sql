-- Einmal im Supabase SQL Editor ausführen.
create table if not exists public.edit_locks (
  entity_type text not null,
  entity_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_token uuid not null default gen_random_uuid(),
  expires_at timestamptz not null,
  primary key(entity_type, entity_id)
);
alter table public.edit_locks add column if not exists session_token uuid not null default gen_random_uuid();
alter table public.edit_locks enable row level security;
drop policy if exists authenticated_all on public.edit_locks;
create policy authenticated_all on public.edit_locks for all to authenticated using (true) with check (true);
grant select,insert,update,delete on public.edit_locks to authenticated;
revoke all on public.edit_locks from anon;

drop function if exists public.acquire_edit_lock(text,uuid);
drop function if exists public.release_edit_lock(text,uuid);

create or replace function public.acquire_edit_lock(p_entity_type text, p_entity_id uuid, p_session_token uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
declare acquired boolean;
begin
  delete from edit_locks where expires_at < now();
  insert into edit_locks(entity_type,entity_id,user_id,session_token,expires_at)
  values(p_entity_type,p_entity_id,auth.uid(),p_session_token,now()+interval '15 minutes')
  on conflict(entity_type,entity_id) do update set user_id=excluded.user_id,session_token=excluded.session_token,expires_at=excluded.expires_at
  where edit_locks.session_token=p_session_token or edit_locks.expires_at<now()
  returning true into acquired;
  return coalesce(acquired,false);
end $$;

create or replace function public.release_edit_lock(p_entity_type text, p_entity_id uuid, p_session_token uuid)
returns void language sql security invoker set search_path=public as $$
  delete from edit_locks where entity_type=p_entity_type and entity_id=p_entity_id and user_id=auth.uid() and session_token=p_session_token;
$$;
grant execute on function public.acquire_edit_lock(text,uuid,uuid) to authenticated;
grant execute on function public.release_edit_lock(text,uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
